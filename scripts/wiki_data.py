#!/usr/bin/env python3
"""Build public/<chronicle>/*.json from lineage2wiki.org monster pages.

Standard library only. Run it in Docker, see CLAUDE.md for the commands.

    fetch c2         Download pages into .cache/wiki/c2 (resumable). Run c2 first.
    fetch c1         Download the C1 pages that C2 pages link to.
    build            Parse the cache and write public/c1 and public/c2.
    check            Fail if C2/C1 ratios don't match the normalization rules.
    verify-c5 [N]    Parse N shipped C5 monsters and diff against public/c5.
    slim-c5          Minify public/c5 and drop fields the app doesn't read.

Why it looks like this:

- Monster pages used to embed `var monster = {...}`. Those blocks are now empty,
  so everything comes from the server-rendered HTML.
- The `monsterList` on the listing page is incomplete (it omits real, spawned
  monsters), so C2 IDs are found by sweeping ranges. The list is only used for
  fields the page doesn't show: acquire_exp_rate, type and skill levels.
- C2 URLs use old IDs (209). C1 URLs use modern IDs (20209) even though the C1
  listing says 209. The mapping isn't arithmetic, so C1 URLs are read from the
  chronicle links on each C2 page.
- The wiki's C2 data has server rates baked in. See normalize_c2().
"""
import collections
import html
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request

BASE = 'https://lineage2wiki.org'
USER_AGENT = 'l2fh-data-builder/1.0'
REQUEST_DELAY_SECONDS = 1.0
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'wiki')
PUBLIC = os.path.join(ROOT, 'public')

ADENA_ID = 57
C2_SWEEP = [range(1, 1000), range(5000, 6000), range(12000, 12401)]

# Rates baked into the wiki's C2 data, relative to C1. A ratio of 1 means the
# monster wasn't scaled (raid bosses).
C2_EXP_RATE = 40
C2_SP_RATE = 80
C2_ADENA_RATE = 250

# C2-only entries that aren't scaled, like the raid bosses that have a C1 page.
# They have no C1 counterpart to compare with and the wiki types them as warrior,
# so they're listed by hand: Baium, Archangel, Zaken, Doll Blader, Vale master.
C2_UNSCALED_IDS = {12372, 12373, 12374, 12376, 12377}

# Every monster field calculator.tsx reads, see RawMonster.
C5_MONSTER_FIELDS = (
    'npc_id', 'name', 'level', 'race', 'exp', 'acquire_sp', 'org_hp', 'org_mp',
    'str', 'int', 'dex', 'wit', 'con', 'men',
    'base_physical_attack', 'base_defend', 'base_magic_defend', 'base_magic_attack',
    'base_attack_speed', 'base_critical', 'physical_hit_modify',
    'ground_low', 'ground_high', 'acquire_exp_rate', 'locations', 'items', 'skills',
)

# Listing types that aren't farmable monsters.
MOB_TYPES = {'warrior', 'boss', 'treasure', 'zzoldagu', 'monrace'}


# ---------------------------------------------------------------- fetching


def cache_path(chronicle, name):
    return os.path.join(CACHE, chronicle, name)


def http_get(url):
    """Return (status, text). 404 is a normal answer, other failures retry."""
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.status, response.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return 404, ''
            if error.code not in (429, 500, 502, 503, 504):
                raise
            print(f'  {error.code} on {url}, backing off', flush=True)
        except (urllib.error.URLError, TimeoutError) as error:
            print(f'  {error} on {url}, backing off', flush=True)
        time.sleep(30 * (attempt + 1))
    raise SystemExit(f'Giving up on {url}. Rerun to resume.')


def fetch_page(chronicle, monster_id):
    """Download one monster page unless cached. Returns True if it hit the site."""
    page = cache_path(chronicle, f'{monster_id}.html')
    missing = cache_path(chronicle, f'{monster_id}.404')
    if os.path.exists(page) or os.path.exists(missing):
        return False
    status, text = http_get(f'{BASE}/{chronicle}/monster/{monster_id}/')
    if status == 404:
        open(missing, 'w').close()
    else:
        with open(page, 'w', encoding='utf-8') as f:
            f.write(text)
    return True


def fetch_listing(chronicle):
    path = cache_path(chronicle, 'listing.html')
    if not os.path.exists(path):
        _, text = http_get(f'{BASE}/{chronicle}/monster/')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)


def fetch_all(chronicle, ids):
    ids = list(ids)
    fetched = 0
    for index, monster_id in enumerate(ids, 1):
        if fetch_page(chronicle, monster_id):
            fetched += 1
            time.sleep(REQUEST_DELAY_SECONDS)
        if index % 100 == 0:
            print(f'{chronicle}: {index}/{len(ids)} ({fetched} downloaded)', flush=True)
    print(f'{chronicle}: done, {fetched} downloaded', flush=True)


def cached_ids(chronicle):
    folder = os.path.join(CACHE, chronicle)
    names = os.listdir(folder) if os.path.isdir(folder) else []
    return sorted(int(n[:-5]) for n in names if re.fullmatch(r'\d+\.html', n))


def c1_id_from_c2_page(text):
    match = re.search(r'/c1/monster/(\d+)/', text)
    return int(match.group(1)) if match else None


def read_page(chronicle, monster_id):
    with open(cache_path(chronicle, f'{monster_id}.html'), encoding='utf-8', errors='replace') as f:
        return f.read()


def cmd_fetch(chronicle):
    os.makedirs(os.path.join(CACHE, chronicle), exist_ok=True)
    fetch_listing(chronicle)
    if chronicle == 'c2':
        fetch_all('c2', [i for sweep in C2_SWEEP for i in sweep])
    elif chronicle == 'c1':
        pages = [read_page('c2', i) for i in cached_ids('c2')]
        if not pages:
            raise SystemExit('No C2 pages cached. Run "fetch c2" first.')
        fetch_all('c1', sorted({i for i in map(c1_id_from_c2_page, pages) if i}))
    else:
        raise SystemExit('fetch takes c1 or c2')


# ----------------------------------------------------------------- parsing


def strip_tags(fragment):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', fragment))).strip()


def to_number(text):
    match = re.search(r'-?\d[\d,]*(?:\.\d+)?', text or '')
    return float(match.group(0).replace(',', '')) if match else None


def stat(body, label):
    """Value of a stat row: <div class="txt_monster_3 ...">Label:</div><div ...>value</div>."""
    match = re.search(
        r'txt_monster_3[^"]*">\s*' + re.escape(label) + r'\s*</div>\s*<div[^>]*>(.*?)</div>',
        body,
        re.S,
    )
    return strip_tags(match.group(1)) if match else None


def parse_quantity(text):
    parts = [to_number(p) for p in text.split(' - ')]
    if None in parts or not parts:
        return None
    return (int(parts[0]), int(parts[-1]))


def parse_rows(section, chronicle, spoil):
    rows = []
    for match in re.finditer(r'<div class="(?:drops|spoils?|herbs?)_row[^"]*">', section):
        chunk = section[match.end():]
        following = re.search(r'<div class="(?:drops|spoils?|herbs?)_row[^"]*">', chunk)
        chunk = chunk[:following.start()] if following else chunk
        link = re.search(r'href="/%s/item/(\d+)/[^"]*"[^>]*>(.*?)</a>' % chronicle, chunk, re.S)
        cells = [strip_tags(c) for c in re.findall(r'<div class="txt_table_6[^"]*">(.*?)</div>', chunk, re.S)]
        icon = re.search(r'item_icons/([\w.-]+?)\.png', chunk)
        if not link or len(cells) < 2:
            continue
        quantity = parse_quantity(cells[1])
        chance = to_number(cells[0])
        if quantity is None or chance is None:
            raise ValueError(f'Unparsable drop row: {cells}')
        rows.append({
            'item_id': int(link.group(1)),
            'name': strip_tags(link.group(2)),
            'min': quantity[0],
            'max': quantity[1],
            'chance': chance,
            'spoil': spoil,
            'type_label': cells[2] if len(cells) > 2 else '',
            'icon': icon.group(1) if icon else '',
        })
    return rows


def parse_tabs(body, chronicle):
    """Split drop tables by tab, because `spoil` is only known from the tab."""
    starts = []
    for tab in ('drops', 'spoils', 'herbs', 'quests'):
        positions = [m.start() for m in re.finditer(re.escape(f"isShowingTab('{tab}')"), body)]
        if positions:
            # The first hit is the tab button, the last one is the tab's content.
            starts.append((positions[-1], tab))
    starts.sort()
    rows = []
    for index, (start, tab) in enumerate(starts):
        end = starts[index + 1][0] if index + 1 < len(starts) else len(body)
        if tab != 'quests':
            parsed = parse_rows(body[start:end], chronicle, 1 if tab == 'spoils' else 0)
            for row in parsed:
                row['tab'] = tab
            rows.extend(parsed)
    return rows


def parse_page(text, chronicle):
    body = re.sub(r'<script.*?</script>|<style.*?</style>', '', text, flags=re.S)
    title = re.search(r'txt_monster_3[^"]*">\s*NPC:\s*</div>\s*<div[^>]*>(.*?)<span', body, re.S)
    locations = {}
    for location_id, slug, label in re.findall(
        r'href="/%s/location/(\d+)/([^"/]*)/?"[^>]*>(.*?)</a>' % chronicle, body, re.S
    ):
        name = strip_tags(label) or slug.replace('-', ' ').title()
        locations.setdefault(int(location_id), name)
    skills = {}
    for skill_id, name in re.findall(r'alt="(\d+), ([^"]+)"', body):
        skills.setdefault(int(skill_id), html.unescape(name))
    return {
        'name': strip_tags(title.group(1)) if title else '',
        'level': to_number(stat(body, 'Level:')),
        'hp': to_number(stat(body, 'HP:')),
        'mp': to_number(stat(body, 'MP:')),
        'exp': to_number(stat(body, 'Exp:')),
        'sp': to_number(stat(body, 'Sp:')),
        'mdef': to_number(stat(body, 'M.Def.:')),
        'race': (stat(body, 'Race:') or '').lower(),
        'men': to_number(re.search(r'MEN\s*</div>\s*<div[^>]*>\s*(\d+)', body).group(1))
        if re.search(r'MEN\s*</div>\s*<div[^>]*>\s*(\d+)', body) else None,
        'locations': locations,
        'skills': skills,
        'drops': parse_tabs(body, chronicle),
    }


def load_listing(chronicle):
    """Return ({npc_id: row}, {skill_id: name}) from the embedded lists."""
    with open(cache_path(chronicle, 'listing.html'), encoding='utf-8', errors='replace') as f:
        text = f.read()
    decoder = json.JSONDecoder()
    rows, _ = decoder.raw_decode(text[re.search(r'var\s+monsterList\s*=\s*', text).end():])
    skills, _ = decoder.raw_decode(text[re.search(r'var\s+skillsList\s*=\s*', text).end():])
    return {int(r['npc_id']): r for r in rows}, {int(s['skill_id']): s['name'] for s in skills}


# ---------------------------------------------------------------- building


def parse_skill_string(value):
    """'4045:1,4009:2' -> [(4045, 1), (4009, 2)]."""
    pairs = []
    for entry in (value or '').split(','):
        if ':' in entry:
            skill_id, level = entry.split(':')
            pairs.append((int(skill_id), int(level)))
    return pairs


def load_chronicle(chronicle, listing_id):
    """Parse all cached pages. listing_id maps a page ID to its listing row ID."""
    listing, skill_names = load_listing(chronicle)
    monsters = {}
    for page_id in cached_ids(chronicle):
        page = parse_page(read_page(chronicle, page_id), chronicle)
        row = listing.get(listing_id(page_id))
        monsters[page_id] = {'page': page, 'row': row}
    return monsters, skill_names


def is_mob(entry):
    row, page = entry['row'], entry['page']
    if row:
        return row.get('type') in MOB_TYPES
    # Unlisted pages have no type. Many are monsters that never spawn: they have
    # EXP but nothing to farm, and would top the EXP ranking if kept.
    return bool(page['locations']) or bool(page['drops'])


def exp_rate(entry):
    row, page = entry['row'], entry['page']
    if row and row.get('acquire_exp_rate') is not None:
        return float(row['acquire_exp_rate'])
    level = page['level'] or 1
    return (page['exp'] or 0) / (level * level)


def sp_value(entry):
    row, page = entry['row'], entry['page']
    if row and row.get('acquire_sp') is not None:
        return float(row['acquire_sp'])
    return page['sp'] or 0


def adena_max(entry):
    for drop in entry['page']['drops']:
        if drop['item_id'] == ADENA_ID and not drop['spoil']:
            return drop['max']
    return None


def nearest(ratio, rate):
    """The rule a ratio belongs to, or None if it matches neither."""
    for candidate in (rate, 1):
        if abs(ratio / candidate - 1) < 0.02:
            return candidate
    return None


def c2_to_c1_ids(c2):
    pairs = {}
    for page_id in c2:
        c1_id = c1_id_from_c2_page(read_page('c2', page_id))
        if c1_id:
            pairs[page_id] = c1_id
    return pairs


def rate_for(value, reference, rate):
    """Rate to divide a C2 value by. Falls back to the chronicle's rate."""
    if value and reference:
        return nearest(value / reference, rate) or rate
    return rate


def normalize_c2(c2, c1, pairs):
    """Attach x1 values to every C2 entry.

    C2 mobs with a C1 counterpart use the ratio to it (EXP x40 or x1, and so on).
    C2-only mobs use the common rate. Item chances stay as they are: they differ
    from C1 by no single factor, so there's nothing to divide by.
    """
    for page_id, entry in c2.items():
        if page_id in C2_UNSCALED_IDS:
            entry.update(exp_divisor=1, sp_divisor=1, adena_divisor=1)
            continue
        other = c1.get(pairs.get(page_id))
        entry['exp_divisor'] = rate_for(exp_rate(entry), exp_rate(other) if other else 0, C2_EXP_RATE)
        entry['sp_divisor'] = rate_for(sp_value(entry), sp_value(other) if other else 0, C2_SP_RATE)
        entry['adena_divisor'] = rate_for(adena_max(entry), adena_max(other) if other else 0, C2_ADENA_RATE)


def item_kind(row, known_items):
    """(item_type, etcitem_type). Prefers C5's metadata, item IDs are shared."""
    known = known_items.get(str(row['item_id']))
    if known:
        return known.get('item_type'), known.get('etcitem_type')
    if row['tab'] == 'herbs':
        return 'etcitem', 'potion'
    if row['icon'].startswith('weapon_'):
        return 'weapon', 'none'
    if row['icon'].startswith(('armor_', 'accessary_', 'accessory_', 'shield_')):
        return 'armor', 'none'
    if row['type_label'].lower() == 'asset':
        return 'asset', 'none'
    return 'etcitem', row['type_label'].lower() or 'none'


def write_json(chronicle, name, data):
    folder = os.path.join(PUBLIC, chronicle)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'), ensure_ascii=False)


def write_chronicle(chronicle, entries, skill_names, known_items):
    monsters, items, locations, skills = {}, {}, {}, {}
    for page_id, entry in entries.items():
        if not is_mob(entry):
            continue
        page, row = entry['page'], entry['row'] or {}
        exp_divisor = entry.get('exp_divisor', 1)
        adena_divisor = entry.get('adena_divisor', 1)

        drops = []
        for drop in page['drops']:
            item_type, etcitem_type = item_kind(drop, known_items)
            items.setdefault(drop['item_id'], {
                'item_id': drop['item_id'],
                'name': drop['name'],
                'item_type': item_type,
                'etcitem_type': etcitem_type,
            })
            divisor = adena_divisor if drop['item_id'] == ADENA_ID else 1
            drops.append({
                'item_id': drop['item_id'],
                'min': round(drop['min'] / divisor),
                'max': round(drop['max'] / divisor),
                'chance': drop['chance'],
                'spoil': drop['spoil'],
            })

        monster_skills = parse_skill_string(row.get('skills')) or [(i, 1) for i in page['skills']]
        for skill_id, level in monster_skills:
            name = page['skills'].get(skill_id) or skill_names.get(skill_id) or f'Skill {skill_id}'
            skills.setdefault(skill_id, {'skill_id': skill_id, 'name': name, 'level': level})

        for location_id, name in page['locations'].items():
            locations.setdefault(location_id, {'id': location_id, 'name': name})

        monsters[page_id] = {
            'npc_id': page_id,
            'name': page['name'],
            'level': int(page['level'] or 0),
            'race': row.get('race') or page['race'],
            'type': row.get('type', ''),
            'org_hp': page['hp'],
            'org_mp': page['mp'],
            'men': page['men'],
            'mdef': page['mdef'],
            'acquire_exp_rate': round(exp_rate(entry) / exp_divisor, 4),
            'acquire_sp': round(sp_value(entry) / entry.get('sp_divisor', 1), 4),
            'locations': sorted(page['locations']),
            'skills': [{'skill_id': s, 'level': level} for s, level in monster_skills],
            'items': drops,
        }

    write_json(chronicle, 'monsters_data.json', monsters)
    write_json(chronicle, 'items_data.json', items)
    write_json(chronicle, 'locations_data.json', locations)
    write_json(chronicle, 'skills_data.json', skills)
    print(f'{chronicle}: {len(monsters)} monsters, {len(items)} items, '
          f'{len(locations)} locations, {len(skills)} skills')


def load_both():
    c2, c2_skills = load_chronicle('c2', lambda page_id: page_id)
    pairs = c2_to_c1_ids(c2)
    reverse = {c1_id: c2_id for c2_id, c1_id in pairs.items()}
    # The C1 listing uses the old IDs, like C2, while its pages use modern ones.
    c1, c1_skills = load_chronicle('c1', lambda page_id: reverse.get(page_id, -1))
    return c1, c1_skills, c2, c2_skills, pairs


def cmd_build():
    c1, c1_skills, c2, c2_skills, pairs = load_both()
    normalize_c2(c2, c1, pairs)
    with open(os.path.join(PUBLIC, 'c5', 'items_data.json'), encoding='utf-8') as f:
        known_items = json.load(f)
    write_chronicle('c1', c1, c1_skills, known_items)
    write_chronicle('c2', c2, c2_skills, known_items)


# ---------------------------------------------------------------- checking


def cmd_check():
    c1, _, c2, _, pairs = load_both()
    failures = 0
    histograms = {name: collections.Counter() for name in ('exp', 'sp', 'adena')}
    rules = {'exp': (exp_rate, C2_EXP_RATE), 'sp': (sp_value, C2_SP_RATE), 'adena': (adena_max, C2_ADENA_RATE)}
    unexpected = []
    for c2_id, c1_id in pairs.items():
        entry, other = c2[c2_id], c1.get(c1_id)
        if not other or not is_mob(entry):
            continue
        for name, (value_of, rate) in rules.items():
            value, reference = value_of(entry), value_of(other)
            if not value or not reference:
                continue
            ratio = value / reference
            histograms[name][round(ratio, 1)] += 1
            if nearest(ratio, rate) is None:
                unexpected.append((name, c2_id, entry['page']['name'], value, reference, round(ratio, 3)))
    for name, histogram in histograms.items():
        print(name, 'ratio C2/C1:', histogram.most_common(12))
    print('unexpected ratios:', len(unexpected))
    for line in unexpected[:40]:
        print('  ', line)
    failures += len(unexpected)

    for chronicle, entries in (('c1', c1), ('c2', c2)):
        mobs = {k: v for k, v in entries.items() if is_mob(v)}
        print(f'{chronicle}: pages {len(entries)}, mobs {len(mobs)}, '
              f'unlisted mobs {sum(1 for v in mobs.values() if not v["row"])}, '
              f'herb rows {sum(1 for v in mobs.values() for d in v["page"]["drops"] if d["tab"] == "herbs")}, '
              f'without M.Def {sum(1 for v in mobs.values() if v["page"]["mdef"] is None)}, '
              f'without name {sum(1 for v in mobs.values() if not v["page"]["name"])}')
    only_c2 = [(k, v['page']['name'], v['page']['level']) for k, v in c2.items() if k not in pairs and is_mob(v)]
    print('C2 mobs with no C1 page:', len(only_c2), only_c2[:30])
    if failures:
        raise SystemExit(f'{failures} unexpected ratios. Review before shipping.')


def calc_mdef(level, men, base_magic_defend):
    """calcMdef from src/lib/formulas.tsx, to prove the page's M.Def is the same value."""
    men_bonus = int(1.01 ** (men + 0.06) * 100 + 0.5) / 100
    return men_bonus * (89 + level) / 100 * base_magic_defend


def cmd_verify_c5(count):
    with open(os.path.join(PUBLIC, 'c5', 'monsters_data.json'), encoding='utf-8') as f:
        shipped = json.load(f)
    os.makedirs(os.path.join(CACHE, 'c5'), exist_ok=True)
    rng = random.Random(5)
    with_drops = sorted(k for k, v in shipped.items() if v['items'] and v['locations'])
    sample = rng.sample(with_drops, count)
    problems = []
    checked_rows = 0
    for monster_id in sample:
        if fetch_page('c5', monster_id):
            time.sleep(REQUEST_DELAY_SECONDS)
        if not os.path.exists(cache_path('c5', f'{monster_id}.html')):
            problems.append((monster_id, 'page is gone'))
            continue
        page = parse_page(read_page('c5', monster_id), 'c5')
        record = shipped[monster_id]
        want = sorted(
            (int(i['item_id']), int(i['min']), int(i['max']), int(i['spoil']), float(i['chance']))
            for i in record['items']
        )
        got = sorted((d['item_id'], d['min'], d['max'], d['spoil'], d['chance']) for d in page['drops'])
        checked_rows += len(want)
        # The page shows 4 decimals, so chances may differ by rounding only.
        same = len(want) == len(got) and all(
            a[:4] == b[:4] and abs(a[4] - b[4]) <= 0.00011 for a, b in zip(want, got)
        )
        if not same:
            problems.append((monster_id, 'drops', want, got))
        expected_mdef = calc_mdef(int(record['level']), int(record['men']), float(record['base_magic_defend']))
        if abs(expected_mdef - page['mdef']) > 1:
            problems.append((monster_id, 'mdef', expected_mdef, page['mdef']))
        if sorted(int(i) for i in record['locations']) != sorted(page['locations']):
            problems.append((monster_id, 'locations', record['locations'], sorted(page['locations'])))
        if int(record['level']) != page['level'] or float(record['org_hp']) != page['hp']:
            problems.append((monster_id, 'stats', record['level'], record['org_hp'], page['level'], page['hp']))
        if float(record['men']) != page['men']:
            problems.append((monster_id, 'men', record['men'], page['men']))
    print(f'verified {len(sample)} monsters, {checked_rows} drop rows, {len(problems)} problems')
    for problem in problems[:30]:
        print('  ', problem)
    if problems:
        raise SystemExit(1)


def keep_fields(record, fields):
    return {field: record[field] for field in fields if field in record}


def cmd_slim_c5():
    """Rewrite public/c5 in place. Key order is kept: it decides sort ties in the app."""
    fields = {
        'monsters_data.json': C5_MONSTER_FIELDS,
        'items_data.json': ('item_id', 'id', 'name', 'item_type', 'etcitem_type', 'weapon_type'),
        'locations_data.json': ('id', 'name'),
        'skills_data.json': ('skill_id', 'id', 'name', 'level'),
    }
    for name, kept in fields.items():
        with open(os.path.join(PUBLIC, 'c5', name), encoding='utf-8') as f:
            data = json.load(f)
        write_json('c5', name, {key: keep_fields(record, kept) for key, record in data.items()})
        print(name, os.path.getsize(os.path.join(PUBLIC, 'c5', name)))


def main():
    args = sys.argv[1:]
    if len(args) == 2 and args[0] == 'fetch':
        cmd_fetch(args[1])
    elif args == ['build']:
        cmd_build()
    elif args == ['check']:
        cmd_check()
    elif args == ['slim-c5']:
        cmd_slim_c5()
    elif args and args[0] == 'verify-c5':
        cmd_verify_c5(int(args[1]) if len(args) > 1 else 50)
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main()
