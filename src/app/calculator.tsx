import {Card, CardContent, CardHeader} from "@/components/ui/card";
import {Progress} from "@/components/ui/progress";
import {Label} from "@/components/ui/label";
import {Input} from "@/components/ui/input";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Checkbox} from "@/components/ui/checkbox";
import {useEffect, useRef, useState} from "react";
import {Item, Monster, Skill, Location} from "@/app/types";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";


function useDebounced<T>(value: T, delay = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function Calculator() {

  const [loadLabel, setLoadLabel] = useState('');
  const [loadPct, setLoadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);



  // Databases
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [monstersById, setMonstersById] = useState<Record<number, Monster>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [itemsById, setItemsById] = useState<Record<number, Item>>({});
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsById, setLocationsById] = useState<Record<number, Location>>({});
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsById, setSkillsById] = useState<Record<number, Skill>>({});

  // Inputs
  const [matk, setMatk] = useState<number>(140);
  const [skillPower, setSkillPower] = useState<number>(26);
  const [shot, setShot] = useState<'none' | 'ss' | 'bss'>('none');
  const [element, setElement] = useState<string>('none');
  const [ssPrice, setSsPrice] = useState<number>(24);
  const [bssPrice, setBssPrice] = useState<number>(52);

  // Selection
  const [query, setQuery] = useState('');
  const debQuery = useDebounced(query, 150);
  const [selectedNpc, setSelectedNpc] = useState<Monster | null>(null);
  const [openList, setOpenList] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Suggestion inputs
  const [suggestedMaxHits, setSuggestedMaxHits] = useState<number>(1);
  const [suggestedOptimisation, setSuggestedOptimisation] = useState<string>('exp');
  const [suggestedHerbs, setSuggestedHerbs] = useState<boolean>(true);
  const [suggestedMinLevel, setSuggestedMinLevel] = useState<number>(1);
  const [suggestedMaxLevel, setSuggestedMaxLevel] = useState<number>(80);

  const [suggestedLoading, setSuggestedLoading] = useState(false);

  // Active set
  type ActiveEntry = { monster_id: string; rate: number };
  const [active, setActive] = useState<ActiveEntry[]>([]);
  const [totalMonsters, setTotalMonsters] = useState<number>(100);


  // Loader: staged with streaming if available
  useEffect(() => {
    let cancelled = false;

    async function fetchWithProgress(url: string, onStage: (s: string) => void, base: number, span: number): Promise<any> {
      onStage(`Fetching ${url}...`);
      try {
        const res = await fetch(url, {cache: 'force-cache'});
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const len = Number(res.headers.get('Content-Length') || '0');
        if (res.body && len > 0 && 'getReader' in res.body) {
          const reader = (res.body as ReadableStream).getReader();
          const chunks: BlobPart[] = [];
          let received = 0;
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(
                value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
              );
              received += value.length;
              if (!cancelled) setLoadPct(base + (received / len) * span * 0.7);
            }
          }
          const merged = new Blob(chunks);
          onStage('Parsing JSON...');
          const text = await merged.text();
          const data = JSON.parse(text);
          if (!cancelled) setLoadPct(base + span * 0.98);
          return data;
        } else {
          onStage('Downloading...');
          const data = await res.json();
          if (!cancelled) setLoadPct(base + span * 0.98);
          return data;
        }
      } catch (e: any) {
        throw e;
      }
    }

    (async () => {
      try {
        setError(null);
        setLoadPct(2);
        setLoadLabel('Initializing...');
        const [monstersData, itemsData, locationsData, skillsData] = await Promise.all([
          fetchWithProgress('/c5/monsters_data.json', (s) => setLoadLabel(s), 2, 48),
          fetchWithProgress('/c5/items_data.json', (s) => setLoadLabel(s), 52, 46),
          fetchWithProgress('/c5/locations_data.json', (s) => setLoadLabel(s), 52, 46),
          fetchWithProgress('/c5/skills_data.json', (s) => setLoadLabel(s), 52, 46),
        ]);
        if (cancelled) return;
        setLoadLabel('Indexing items...');
        const itemsList: Item[] = Array.isArray(itemsData) ? itemsData : Object.values(itemsData || {});
        const monstersList: Monster[] = Array.isArray(monstersData) ? monstersData : Object.values(monstersData || {});
        const locationsList: Location[] = Array.isArray(locationsData) ? locationsData : Object.values(locationsData || {});
        const skillsList: Skill[] = Array.isArray(skillsData) ? skillsData : Object.values(skillsData || {});

        const itemMap: Record<number, Item> = {};
        for (const it of itemsList) itemMap[it.item_id] = it as Item;
        const monsterMap: Record<number, Monster> = {};
        for (const it of monstersList) monsterMap[it.npc_id] = it as Monster;
        const locationMap: Record<number, Location> = {};
        for (const it of locationsList) locationMap[it.id] = it as Location;
        const skillMap: Record<number, Skill> = {};
        for (const it of skillsList) skillMap[it.skill_id] = it as Skill;

        setItems(itemsList);
        setMonsters(monstersList);
        setLocations(locationsList);
        setSkills(skillsList);

        setItemsById(itemMap);
        setMonstersById(monsterMap);
        setLocationsById(locationMap);
        setSkillsById(skillMap);
        setLoadPct(100);
        setLoadLabel('Ready');
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load databases');
          setLoadLabel('Error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);


  return (
    <div
      className="min-h-screen bg-gradient-to-b from-white to-neutral-100 dark:from-black dark:to-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">L2 Mage Farm Helper</h1>
          <div className="text-xs text-neutral-500">shadcn/ui • Next.js</div>
        </header>

        {!monsters || !items || !locations || !skills ? (
          <Card className="max-w-3xl mx-auto">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="size-3 animate-ping rounded-full bg-indigo-500/70"/>
                <div>
                  <div className="text-sm font-medium">Loading databases</div>
                  <div className="text-xs text-neutral-500">{loadLabel || 'Preparing...'}</div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Progress
                  value={loadPct}
                  aria-label={loadPct < 100 ? 'Loading data' : 'Completed loading'}
                />
                <div className="text-xs text-neutral-500">We are fetching databases from CDN, parsing large JSON
                  files, and indexing. This may take a few seconds.
                </div>
                {error && <div className="text-sm text-red-600">{error}</div>}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-2 space-y-4">

              <Card>
                <CardHeader>
                  <div className="text-sm font-semibold">Magic Setup</div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className={"flex flex-col gap-2"}>
                      <Label htmlFor="matk">M. Atk</Label>
                      <Input id="matk" type="number" value={matk}
                             onChange={(e) => setMatk(parseFloat(e.target.value || '0'))}/>
                    </div>
                    <div className={"flex flex-col gap-2"}>
                      <Label htmlFor="sp">Skill Power</Label>
                      <Input id="sp" type="number" value={skillPower}
                             onChange={(e) => setSkillPower(parseFloat(e.target.value || '0'))}/>
                    </div>
                    <div className="sm:col-span-1">
                      <Label>Shot</Label>
                      <div className="mt-2">
                        <Select
                          defaultValue="none"
                          onValueChange={(value: "none" | "ss" | "bss") => setShot(value)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select shot type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="ss">Spiritshots</SelectItem>
                            <SelectItem value="bss">Blessed spiritshots</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="sm:col-span-1">
                      <Label>Element</Label>
                      <div className="mt-2">
                        <Select
                          defaultValue="none"
                          onValueChange={(value: string) => setElement(value)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select magic element" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="fire">Fire</SelectItem>
                            <SelectItem value="water">Water</SelectItem>
                            <SelectItem value="dark">Dark</SelectItem>
                            <SelectItem value="wind">Wind</SelectItem>
                            <SelectItem value="holy">Holy</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className={"flex flex-col gap-2"}>
                      <Label htmlFor="ssPrice">SS hit price</Label>
                      <Input id="ssPrice" type="number" value={ssPrice}
                             onChange={(e) => setSsPrice(parseFloat(e.target.value || '0'))}/>
                    </div>
                    <div className={"flex flex-col gap-2"}>
                      <Label htmlFor="bssPrice">BSS hit price</Label>
                      <Input id="bssPrice" type="number" value={bssPrice}
                             onChange={(e) => setBssPrice(parseFloat(e.target.value || '0'))}/>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Search NPC</div>
                    <div className="text-xs text-neutral-500">{npcs?.length?.toLocaleString()} NPCs</div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="relative">
                    <Input
                      ref={inputRef as any}
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setOpenList(true);
                      }}
                      onFocus={() => setOpenList(true)}
                      placeholder="Type NPC name..."
                    />
                    {openList && (
                      <div
                        className="absolute z-10 mt-2 max-h-80 w-full overflow-auto rounded-md border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-lg">
                        {filteredNpcs.length === 0 ? (
                          <div className="p-3 text-sm text-neutral-500">No results</div>
                        ) : (
                          filteredNpcs.map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => {
                                setSelectedNpc(n);
                                setQuery(n.name);
                                setOpenList(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${selectedNpc?.id === n.id ? 'bg-neutral-100 dark:bg-neutral-800' : ''}`}
                            >
                              <div className="flex items-center justify-between">
                                <span>{n.name}</span>
                                <span className="text-xs text-neutral-500">Lv {n.level || '-'}</span>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">NPC Details</div>
                    {selectedNpc && (
                      <button
                        onClick={addSelectedToSet}
                        className="text-xs rounded-md border border-black/10 dark:border-white/10 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        type="button"
                      >
                        Add to Active Set
                      </button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {!selectedNpc ? (
                    <div className="text-sm text-neutral-500">Pick an NPC to see details</div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <div className="text-lg font-medium">{selectedNpc.name} <small><a target="_blank"
                                                                                          href={`https://lineage2wiki.org/interlude/monster/` + selectedNpc.id}>wiki</a></small>
                        </div>
                        <div className="text-xs text-neutral-500">Lv {selectedNpc.level || '-'} •
                          ID {selectedNpc.id}</div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-neutral-500 text-xs">HP</div>
                          <div className="font-medium">{currentStats?.hp?.toLocaleString()}</div>
                        </div>
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-neutral-500 text-xs">M.Def</div>
                          <div className="font-medium">{currentStats?.mdef?.toLocaleString()}</div>
                        </div>
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-neutral-500 text-xs">Damage</div>
                          <div className="font-medium">{currentStats?.dmg?.toFixed(0)}</div>
                        </div>
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-neutral-500 text-xs">Hits to kill</div>
                          <div className="font-medium">{isFinite(hitsPerKill) ? hitsPerKill : '∞'}</div>
                        </div>
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-neutral-500 text-xs">Exp</div>
                          <div className="font-medium">{selectedNpc.acquire.exp}</div>
                        </div>
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-neutral-500 text-xs">SP</div>
                          <div className="font-medium">{selectedNpc.acquire.sp}</div>
                        </div>
                      </div>
                      <div className="rounded-md border border-black/5 dark:border-white/5">
                        <div
                          className="px-3 py-2 text-xs font-medium border-b border-black/5 dark:border-white/5">Drops
                        </div>
                        <div className="divide-y divide-black/5 dark:divide-white/5">
                          {selectedDrops.length === 0 ? (
                            <div className="p-3 text-sm text-neutral-500">No drops data</div>
                          ) : (
                            selectedDrops.map((d, i) => (
                              <div key={i} className="px-3 py-2 text-sm flex items-center justify-between">
                                <div className="flex flex-col">
                                  <span>{d.name}</span>
                                  <span className="text-xs text-neutral-500">Qty {d.min}-{d.max}</span>
                                </div>
                                <div className="text-xs text-neutral-600 dark:text-neutral-300">
                                  {(d.pGroup * 100).toFixed(3)}% × {(d.pItem * 100).toFixed(3)}%
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-neutral-500">Per kill shot cost: {perKillShotCost.toFixed(0)} adena
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Suggested NPCs</div>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="herbs"
                        checked={suggestedHerbs}
                        onCheckedChange={(checked) => setSuggestedHerbs(checked === true)}
                      />
                      <Label htmlFor="herbs">With herbs</Label>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className={"flex flex-col gap-2"}>
                      <Label htmlFor="maxHits">Max hits</Label>
                      <Input id="maxHits" type="number" value={suggestedMaxHits}
                             onChange={(e) => setSuggestedMaxHits(parseFloat(e.target.value || '1'))}/>
                    </div>
                    <div className={"flex flex-col gap-2"}>
                      <Label htmlFor="matk">Optimise for</Label>
                      <Select value={suggestedOptimisation} onValueChange={setSuggestedOptimisation}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select an option"/>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="exp">Exp</SelectItem>
                          <SelectItem value="adena">Adena</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div className={"flex flex-col gap-2"}>
                      <Label htmlFor="minLevel">Min level</Label>
                      <Input id="minLevel" type="number" value={suggestedMinLevel}
                             onChange={(e) => setSuggestedMinLevel(parseFloat(e.target.value || '1'))}/>
                    </div>
                    <div className={"flex flex-col gap-2"}>
                      <Label htmlFor="maxLevel">Max level</Label>
                      <Input id="maxLevel" type="number" value={suggestedMaxLevel}
                             onChange={(e) => setSuggestedMaxLevel(parseFloat(e.target.value || '1'))}/>
                    </div>
                  </div>

                  {suggestedLoading ? (
                    'Loading...'
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3">
                      {suggestedMonsters.map((m) => (
                        <div
                          key={m.monster.id}
                          className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                              <div className="text-sm font-semibold">{m.monster.name} <small><a target="_blank"
                                                                                                href={`https://lineage2wiki.org/interlude/monster/` + m.monster.id}>wiki</a></small>
                              </div>
                              <div className="text-xs text-neutral-500 mt-1">
                                Level {m.monster.level || '-'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-neutral-500">Adena/Hit</div>
                              <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                                {m.adenaPerHit.toFixed(2)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-neutral-500">Exp/Hit</div>
                              <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                                {m.expPerHit.toFixed(2)}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                              <div className="text-xs text-neutral-500">HP</div>
                              <div className="text-sm font-medium">{m.hp.toLocaleString()}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                              <div className="text-xs text-neutral-500">M.Def</div>
                              <div className="text-sm font-medium">{m.mdef.toLocaleString()}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                              <div className="text-xs text-neutral-500">Hits to Kill</div>
                              <div className="text-sm font-medium">{m.hits}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                              <div className="text-xs text-neutral-500">Damage</div>
                              <div className="text-sm font-medium">{m.dmg.toFixed(0)}</div>
                            </div>
                          </div>

                          <div
                            className="mt-3 pt-3 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
                            <div className="text-xs text-neutral-500">
                              Total Exp: <span
                              className="font-medium text-neutral-900 dark:text-neutral-100">{m.exp.toLocaleString()}</span>
                            </div>
                            <div className="text-xs text-neutral-500">
                              Total Adena: <span
                              className="font-medium text-neutral-900 dark:text-neutral-100">{m.adena.toFixed(0).toLocaleString()}</span>
                            </div>
                            <button
                              onClick={() => {
                                setActive((prev) => {
                                  if (prev.some((p) => p.id === m.monster.id)) return prev;
                                  const remain = Math.max(0, 100 - prev.reduce((a, b) => a + b.rate, 0));
                                  return [...prev, {id: m.monster.id, name: m.monster.name, rate: remain}];
                                });
                              }}
                              disabled={active.some((p) => p.id === m.monster.id)}
                              className="text-xs rounded-md border border-black/10 dark:border-white/10 px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {active.some((p) => p.id === m.monster.id) ? 'Added' : 'Add to Set'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">Active Set</div>
                    <div className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
                      <Label htmlFor="totalMonsters" className="text-xs">Total monsters</Label>
                      <Input id="totalMonsters" type="number" value={totalMonsters}
                             onChange={(e) => setTotalMonsters(parseFloat(e.target.value || '0'))}
                             className="w-24 h-8"/>
                      <div className="text-neutral-500">• Total Rate: {totalRate}%</div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {active.length === 0 ? (
                    <div className="text-sm text-neutral-500">No NPCs yet. Add one from the details panel.</div>
                  ) : (
                    <div className="space-y-2">
                      {active.map((a) => (
                        <div key={a.id} className="flex items-center gap-2">
                          <div className="flex-1 truncate" title={a.name}>{a.name}</div>
                          <Input
                            type="number"
                            value={a.rate}
                            onChange={(e) => updateRate(a.id, parseFloat(e.target.value || '0'))}
                            className="w-20"
                          />
                          <span className="text-xs text-neutral-500">%</span>
                          <button
                            onClick={() => removeFromSet(a.id)}
                            className="text-xs rounded-md border border-black/10 dark:border-white/10 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      {totalRate !== 100 && (
                        <div className="text-xs text-amber-600">Warning: total rate should sum to 100%.</div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="text-sm font-semibold">Aggregated Stats</div>
                </CardHeader>
                <CardContent>
                  {!setAggregates ? (
                    <div className="text-sm text-neutral-500">Nothing to show yet.</div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <div className="grid grid-cols-1 gap-3">
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-xs text-neutral-500">Gross Adena for set</div>
                          <div
                            className="text-lg font-medium">{Math.round(setAggregates.grossAdenaForSet).toLocaleString()}</div>
                        </div>
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-xs text-neutral-500">Shot cost for set</div>
                          <div
                            className="text-lg font-medium">{Math.round(setAggregates.shotCostForSet).toLocaleString()}</div>
                        </div>
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-xs text-neutral-500">Net Adena for set (gross - shots)</div>
                          <div
                            className={`text-lg font-medium ${setAggregates.netAdenaForSet < 0 ? 'text-red-600' : ''}`}>{Math.round(setAggregates.netAdenaForSet).toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-xs text-neutral-500">Adena per monster (gross)</div>
                          <div className="font-medium">{setAggregates.adenaPerKill.toFixed(3)}</div>
                        </div>
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-xs text-neutral-500">Shot cost per monster</div>
                          <div className="font-medium">{setAggregates.shotCostPerKill.toFixed(3)}</div>
                        </div>
                        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                          <div className="text-xs text-neutral-500">Adena per monster (net)</div>
                          <div
                            className={`font-medium ${setAggregates.netAdenaPerKill < 0 ? 'text-red-600' : ''}`}>{setAggregates.netAdenaPerKill.toFixed(3)}</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium mb-1">Drops for set — expected quantities only</div>
                        <div className="space-y-1 max-h-64 overflow-auto">
                          {setAggregates.itemsList.length === 0 ? (
                            <div className="text-xs text-neutral-500">No items</div>
                          ) : (
                            setAggregates.itemsList.map((p) => (
                              <div key={p.id} className="flex items-center gap-2">
                                <div className="flex-1 truncate" title={p.name}>{p.name}</div>
                                <div className="w-40 text-right text-xs" title={`${p.qtyForSet.toFixed(3)} total`}>
                                  {p.qtyForSet.toFixed(3)} qty
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}