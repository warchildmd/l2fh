#!/usr/bin/env python3
"""PreToolUse hook: reject npm and npx commands run on the host.

Only the first word of each simple command is checked, so `docker run ... npm ci`
passes (its first word is docker) while `docker run ... && npm ci` does not. Text
that merely mentions npm, such as `grep npm file` or a commit message, also passes.

This is a guardrail against mistakes, not a sandbox. It does not look inside
double-quoted command substitutions or scripts that call npm.
"""
import json
import os
import re
import shlex
import sys

BLOCKED = {"npm", "npx"}
WRAPPERS = {"builtin", "command", "env", "exec", "nice", "nohup", "sudo", "time", "xargs"}
SHELLS = {"bash", "dash", "sh", "zsh"}
OPERATORS = set(";&|()<>\n")
SEPARATORS = set(";&|()\n")
HEREDOC = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?")


def strip_heredocs(command):
    """Drop heredoc bodies, which are data rather than commands."""
    kept, terminator = [], None
    for line in command.split("\n"):
        if terminator is not None:
            if line.strip() == terminator:
                terminator = None
            continue
        kept.append(line)
        match = HEREDOC.search(line)
        if match:
            terminator = match.group(1)
    return "\n".join(kept)


def split_commands(command):
    """Split a shell string into a list of simple commands, each a list of words."""
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|()<>\n")
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    lexer.commenters = ""

    commands, current = [], []
    for token in lexer:
        is_operator = set(token) <= OPERATORS
        if is_operator and set(token) & SEPARATORS and not set(token) & set("<>"):
            commands.append(current)
            current = []
        elif is_operator and "(" in token:
            commands.append(current)
            current = []
        else:
            current.append(token)
    commands.append(current)
    return [words for words in commands if words]


def runs_host_npm(command):
    try:
        commands = split_commands(strip_heredocs(command))
    except ValueError:
        return False  # Unbalanced quotes: the shell will reject this command itself.

    for words in commands:
        index = 0
        while index < len(words):
            word = words[index].lstrip("`")
            name = os.path.basename(word)
            if re.match(r"^\w+=", word) or word.startswith("-") or name in WRAPPERS:
                index += 1
                continue
            if name in BLOCKED:
                return True
            if name == "eval" and runs_host_npm(" ".join(words[index + 1:])):
                return True
            if name in SHELLS:
                for position, arg in enumerate(words[index + 1:-1], index + 1):
                    if re.match(r"^-\w*c\w*$", arg) and runs_host_npm(words[position + 1]):
                        return True
            break
    return False


def main():
    payload = json.load(sys.stdin)
    command = payload.get("tool_input", {}).get("command", "")
    if not runs_host_npm(command):
        return
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                "npm and npx must not run on the host in this repo. Run them in Docker "
                "instead, using the commands in CLAUDE.md."
            ),
        }
    }))


if __name__ == "__main__":
    main()
