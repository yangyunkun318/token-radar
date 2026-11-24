// Token radar model: implied launch value, calibrated on the snapshot itself.
//
// Every number the board shows comes from the sealed snapshot and nothing else.
// Traded protocols set the price: for each category, the median market-cap / TVL
// of the protocols in that category that already have a token. A category with
// fewer than four traded names borrows the whole market's median instead, and
// every multiple is clamped so a single outlier cannot price a whole category.
//
//   multiple     = median(mcap / tvl) over the category's traded names
//                  (fewer than 4: the all-market median; clamped to [0.05, 1.00])
//   growth       = 7-day TVL change, clamped to [-60, +120] per cent, half weight
//   maturity     = 0.60 + min(age, 1095d) / 1095d * 0.40   (unknown age: 365d)
//   implied      = max(1, round(tvl * multiple * (1 + growth/100 * 0.5) * maturity))
//
// No name is ever special-cased. The calibration table the dashboard prints is
// computed here at run time, and every farm plan is derived from the protocol's
// own category, chains, TVL and age.

/** One row of the sealed snapshot: a protocol and its figures. */
export interface SnapshotProtocol {
  name: string;
  tvl_usd: number;
  slug: string;
  mcap_usd: number | null;
  category: string | null;
  change_7d: number | null;
  chains: Array<string>;
  listed_at: string | null;
  symbol: string | null;
  gecko_id: string | null;
}

/** The sealed snapshot document, whole. */
export interface Snapshot {
  floor_usd: number;
  source: string;
  as_of: string;
  watchlist: string[];
  protocols: Array<SnapshotProtocol>;
}

/** Tunables: printed by the dashboard, varied by the sandbox. */
export interface ModelConstants {
  growth_cap: number;
  growth_floor: number;
  growth_weight: number;
  maturity_days: number;
  maturity_floor: number;
  maturity_range: number;
  min_category_n: number;
  multiple_max: number;
  multiple_min: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5, growth_floor: -60, growth_cap: 120,
  maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095,
  unknown_age_days: 365, multiple_min: 0.05, multiple_max: 1.0,
  min_category_n: 4,
};

/** The model label the dashboard and the rules quote. */
export const MODEL_VERSION = 'radar-3-farm';

/** How many live-token protocols the dashboard's live view carries. */
export const LIVE_ROWS = 24;

/** One calibration line: how a category's multiple was set. */
export interface CalibrationRow {
  n: number;
  category: string;
  used_multiple: number;
  median_multiple: number;
  fallback: boolean;
}

/** One farm step: the action, its time, its cost. */
export interface FarmStep {
  text: string;
  time: string;
  cost: string;
}

/** One row of the ranked board, as board.json carries it. */
export interface BoardRow {
  name: string;
  rank: number;
  tvl_usd: number;
  slug: string;
  mcap_usd: number | null;
  category: string | null;
  change_7d: number | null;
  listed_at: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  gecko_id: string | null;
  age_days: number | null;
  implied_value_usd: number;
  farm_steps: Array<string>;
  model: {
    growth_pct: number;
    maturity_multiplier: number;
    age_days: number | null;
    category_multiple: number;
    growth_multiplier: number;
  };
}

/** The dashboard's compact row, with its farm plan. */
export interface RadarRow {
  name: string;
  tvl_usd: number;
  rank: number;
  slug: string;
  change_7d: number | null;
  category: string | null;
  listed_at: string | null;
  implied_value_usd: number;
  age_days: number | null;
  watchlist: boolean;
  farm_steps: Array<string>;
  maturity_multiplier: number;
  growth_multiplier: number;
  category_multiple: number;
  growth_pct: number;
  chains: Array<string>;
}

/** A protocol that already trades, shown at the market's value, never a model's. */
export interface LiveRow {
  name: string;
  tvl_usd: number;
  slug: string;
  mcap_usd: number | null;
  category: string | null;
  change_7d: number | null;
  multiple: number | null;
  chains: Array<string>;
}

/** Everything the dashboard renders, in one object. */
export interface RadarData {
  source: string;
  model: ModelConstants;
  floor_usd: number;
  as_of: string;
  model_version: string;
  board_size: number;
  live_size: number;
  watchlist_size: number;
  early_size: number;
  overall_median_multiple: number;
  calibration: Array<CalibrationRow>;
  rows: Array<RadarRow>;
  live: Array<LiveRow>;
}

/** Thrown when the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message); // Error captures the message; the name marks the kind below.
    this.name = this.constructor.name;
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** `value` when it is a finite number, `fallback` otherwise. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle value of a non-empty list (the average of the middle two when even). */
function midpoint(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when a date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** A protocol records no token at all: no market cap, no Gecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that are a wrapped, staked or bridged form of a token that already trades. */
const OFF_BOARD_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a wrapped / staked / staking word anywhere in it. */
const WRAPPED_NAME = /\b(wrapped|staked|staking)\b/i;

/** A name that starts with an exchange's name. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A name ending in a release marker is a versioned pool of another protocol. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Whether the board may rank this protocol: pre-token, and not a wrapped,
 * staked or bridged product of a token that already trades. The rule mirrors
 * the watchlist's own definition. WBTC is Bitcoin on Ethereum and Binance
 * staked ETH is ETH in a staking product; neither is a protocol still waiting
 * on a launch of its own, and ranking them first would rank nothing.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !OFF_BOARD_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED_NAME.test(p.name) &&
    !WRAPPED_NAME.test(p.name) &&
    !EXCHANGE_NAME.test(p.name)
  );
}

/**
 * Calibrate from the snapshot's traded protocols. Ratios are grouped by
 * category in one pass; each category's median is used when at least
 * `min_category_n` traded names set it, otherwise the all-market median.
 * Every multiple is clamped into [multiple_min, multiple_max].
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, number>; overall: number; table: CalibrationRow[] } {
  const byCategoryRatios = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    const key = p.category ?? 'Uncategorized';
    const bucket = byCategoryRatios.get(key);
    if (bucket === undefined) byCategoryRatios.set(key, [ratio]);
    else bucket.push(ratio);
  }
  const overall = midpoint(allRatios);
  const categoryMultiples = new Map<string, number>();
  const calibrationRows: CalibrationRow[] = [];
  const orderedCategories = [...new Set(snapshot.protocols.map((p) => p.category ?? 'Uncategorized'))].sort();
  for (const category of orderedCategories) {
    const ratios = byCategoryRatios.get(category) ?? [];
    const fallback = ratios.length < model.min_category_n;
    const raw = fallback ? overall : midpoint(ratios);
    const used = Math.min(model.multiple_max, Math.max(model.multiple_min, raw));
    categoryMultiples.set(category, used);
    calibrationRows.push({ category, n: ratios.length, median_multiple: round4(raw), used_multiple: round4(used), fallback });
  }
  return { byCategory: categoryMultiples, overall, table: calibrationRows };
}

/** One protocol's score under `tuning`: its three multipliers and implied value. */
export function impliedValue(
  entry: SnapshotProtocol,
  at: string,
  multiple: number,
  tuning: ModelConstants,
): { age: number | null; growthMult: number; growthPct: number; implied: number; maturityMult: number } {
  const age = ageDays(at, entry.listed_at);
  const growthPct = Math.min(tuning.growth_cap, Math.max(tuning.growth_floor, numOr(entry.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * tuning.growth_weight;
  const scoredAge = age ?? tuning.unknown_age_days;
  const clampedAge = Math.min(Math.max(scoredAge, 0), tuning.maturity_days);
  const maturityMult = tuning.maturity_floor + (clampedAge / tuning.maturity_days) * tuning.maturity_range;
  const implied = Math.max(1, Math.round(entry.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, sized from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  const bands: Array<[number, number]> = [[5_000_000_000, 250], [1_000_000_000, 150], [100_000_000, 100]];
  for (const [floor, amount] of bands) {
    if (p.tvl_usd >= floor) return amount;
  }
  return 50;
}

/** How long to hold: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  const bands: Array<[number, number]> = [[180, 60], [365, 45]];
  if (age === null) return 30;
  for (const [limit, days] of bands) {
    if (age < limit) return days;
  }
  return 30;
}

/**
 * One category's playbook: the keywords that select it (checked in table
 * order, first match wins), the setup action and the weekly qualifying action,
 * each written in that category's own activity so no two categories share a
 * plan. The strings are the plan; only the capital, name and chain vary.
 */
interface CategoryPlay {
  keys: string[];
  setup: (capital: number, name: string, chain: string) => string;
  weekly: string;
}

const CATEGORY_PLAYS: CategoryPlay[] = [
  {
    keys: ['lend', 'cdp', 'collateral'],
    setup: (capital, name, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
    weekly: 'Each week, borrow a small amount against the supplied collateral and repay it within the week, so the wallet shows borrow activity as well as supply.',
  },
  {
    keys: ['dex'],
    setup: (capital, name, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
    weekly: 'Each week, swap through the pool and add or remove a small amount of liquidity, so the wallet shows both swap and LP activity.',
  },
  {
    keys: ['yield', 'leveraged farm', 'farm'],
    setup: (capital, name, chain) => `Deposit $${capital} into ${name}'s main yield position on ${chain} and keep it open.`,
    weekly: 'Each week, claim or compound the yield once, so the wallet shows a harvest transaction.',
  },
  {
    keys: ['bridge'],
    setup: (capital, name, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
    weekly: 'Each week, bridge a small amount to a different destination chain and use it in that chain’s app.',
  },
  {
    keys: ['staking', 'restak'],
    setup: (capital, name) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
    weekly: 'Each week, delegate or re-delegate a small amount and check the rewards page for new quests.',
  },
  {
    keys: ['perpetual', 'derivative', 'options'],
    setup: (capital, name) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
    weekly: 'Each week, open and close one small hedged position and keep the margin above the liquidation line.',
  },
  {
    keys: ['prediction'],
    setup: (capital, name) => `Fund $${capital} and place one market position on ${name}.`,
    weekly: 'Each week, settle one market position and place a new one.',
  },
  {
    keys: ['curator', 'allocator', 'manager'],
    setup: (capital, name, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
    weekly: 'Each week, check the vault’s allocation report and move a small amount if the vault rebalanced.',
  },
  {
    keys: ['stable'],
    setup: (capital, name, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
    weekly: 'Each week, mint or redeem a small amount of the stable asset and hold it through the week.',
  },
  {
    keys: ['rwa'],
    setup: (capital, name, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
    weekly: 'Each week, check the distribution schedule and hold the asset through one distribution.',
  },
  {
    keys: ['insurance'],
    setup: (capital, name, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
    weekly: 'Each week, check the cover’s expiry and renew it before it lapses.',
  },
  {
    keys: ['launchpad'],
    setup: (capital, name, chain) => `Commit $${capital} of USDC to the next ${name} sale on ${chain} and hold the allocation.`,
    weekly: 'Each week, check the sale calendar and join the next sale’s allowlist when it opens.',
  },
  {
    keys: ['basis'],
    setup: (capital, name, chain) => `Deposit $${capital} of USDC into ${name}'s basis position on ${chain} and keep it open.`,
    weekly: 'Each week, check the funding rate and top up the basis position if it drifted.',
  },
  {
    keys: ['synthetic'],
    setup: (capital, name, chain) => `Mint $${capital} of the synthetic asset through ${name} on ${chain} and hold it.`,
    weekly: 'Each week, check the peg and mint or redeem a small amount to keep the position active.',
  },
];

/** The playbook for a category, or the generic deposit playbook when none matches. */
function playFor(p: SnapshotProtocol): CategoryPlay {
  const c = (p.category ?? '').toLowerCase();
  for (const play of CATEGORY_PLAYS) {
    if (play.keys.some((k) => c.includes(k))) return play;
  }
  return {
    keys: [],
    setup: (capital, name, chain) => `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
  };
}

/** The second step's action: the same position on a second chain, or a swap in the app. */
function secondStepFor(p: SnapshotProtocol, capital: number): string {
  const half = Math.max(25, Math.floor(capital / 2));
  if (p.chains.length > 1) {
    return `Repeat the same position with $${half} on ${p.chains[1]!} so the wallet is active on two chains the protocol counts.`;
  }
  return `Swap $${half} of USDC for the chain's gas token inside ${p.name}'s own app so the wallet also has a swap on record.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time,
 * derived from the protocol's own record (category, chains, TVL, age) and
 * never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const play = playFor(p);
  const half = Math.max(25, Math.floor(capital / 2));
  const gasBudget = capital >= 150 ? 8 : 4;
  return [
    {
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
    },
    { cost: `$${capital} of capital and about $${gasBudget} of gas`, time: '15 minutes to set up', text: play.setup(capital, p.name, chain) },
    { cost: `about $${half} of capital and $2 of gas`, time: '10 minutes', text: secondStepFor(p, capital) },
    { cost: 'about $2 of gas a week', time: '10 minutes a week', text: play.weekly },
    {
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
    },
    {
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Check its docs and announcements for a points program, quests or a leaderboard, and finish any listed quest that fits this position.`,
    },
    {
      cost: 'nothing but the log',
      time: '5 minutes to log, 15 to unwind',
      text: `Write the wallet, the dates and every transaction in a farm log, then unwind in the reverse order you entered.`,
    },
  ];
}

/** One step as a single string: action, then cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  const joined = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (joined.length > 600) return `${joined.slice(0, 596)}...`;
  if (joined.length < 20) return `${joined} Hold the position and check the protocol's own page.`;
  return joined;
}

/** The board: every watchlist slug, then every other rankable pre-token protocol, strongest first. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { byCategory } = calibrate(snapshot, model);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const found = bySlug.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  // The early radar: every other rankable pre-token protocol, below the floor or
  // above it but off the watchlist. No cap: the whole rankable universe the snapshot holds.
  for (const candidate of snapshot.protocols) {
    if (!chosen.has(candidate.slug) && isRankable(candidate)) chosen.set(candidate.slug, candidate);
  }
  const ranked = [...chosen.values()].map((entry) => {
    const multiple = byCategory.get(entry.category ?? 'Uncategorized') ?? MODEL.multiple_min;
    const score = impliedValue(entry, snapshot.as_of, multiple, model);
    return { p: entry, multiple, ...score };
  });
  ranked.sort((left, right) => right.implied - left.implied || (left.p.slug < right.p.slug ? -1 : left.p.slug > right.p.slug ? 1 : 0));
  return ranked.map((hit, i) => ({
    rank: i + 1,
    slug: hit.p.slug,
    name: hit.p.name,
    category: hit.p.category,
    chains: hit.p.chains,
    tvl_usd: hit.p.tvl_usd,
    change_7d: hit.p.change_7d,
    mcap_usd: hit.p.mcap_usd,
    listed_at: hit.p.listed_at,
    gecko_id: hit.p.gecko_id,
    symbol: hit.p.symbol,
    token_status: 'pre-token',
    age_days: hit.age,
    implied_value_usd: hit.implied,
    model: {
      category_multiple: round4(hit.multiple),
      growth_pct: hit.growthPct,
      growth_multiplier: round4(hit.growthMult),
      maturity_multiplier: round4(hit.maturityMult),
      age_days: hit.age,
    },
    farm_steps: farmSteps(hit.p, hit.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const traded = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  traded.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return traded.slice(0, LIVE_ROWS).map((entry) => ({
    slug: entry.slug,
    name: entry.name,
    category: entry.category,
    chains: entry.chains,
    tvl_usd: entry.tvl_usd,
    mcap_usd: entry.mcap_usd,
    change_7d: entry.change_7d,
    multiple: entry.mcap_usd !== null && entry.tvl_usd > 0 ? round4(entry.mcap_usd / entry.tvl_usd) : null,
  }));
}

/** A board row, cut down to the dashboard's compact form. */
export function radarRow(boardRow: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: boardRow.rank,
    slug: boardRow.slug,
    name: boardRow.name,
    category: boardRow.category,
    chains: boardRow.chains,
    tvl_usd: boardRow.tvl_usd,
    change_7d: boardRow.change_7d,
    listed_at: boardRow.listed_at,
    age_days: boardRow.age_days,
    implied_value_usd: boardRow.implied_value_usd,
    category_multiple: boardRow.model.category_multiple,
    growth_pct: boardRow.model.growth_pct,
    growth_multiplier: boardRow.model.growth_multiplier,
    maturity_multiplier: boardRow.model.maturity_multiplier,
    watchlist: watchlist.has(boardRow.slug),
    farm_steps: boardRow.farm_steps,
  };
}

/** The dashboard's whole dataset, built from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const tradedRows = liveRows(snapshot);
  const { overall, table: calibrationRows } = calibrate(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const data: RadarData = {
    as_of: snapshot.as_of, // the snapshot's date
    source: snapshot.source, // where the snapshot came from
    floor_usd: snapshot.floor_usd, // the TVL floor for the board
    model, // tunables, as printed
    model_version: MODEL_VERSION, // radar-3-farm
    watchlist_size: snapshot.watchlist.length, // slugs on the watchlist
    board_size: board.length, // rows ranked
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: tradedRows.length,
    overall_median_multiple: round4(overall),
    calibration: calibrationRows,
    rows: board.map((row) => radarRow(row, watchlist)),
    live: tradedRows,
  };
  return { board, radar: data };
}

/** One required string field of a JSON object, or a SnapshotError naming it. */
function requiredString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw new SnapshotError(`snapshot.json has no ${key}`);
  return v;
}

/** One optional string field: the string, or null. */
function optionalString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** One optional finite number field: the number, or null. */
function optionalNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new SnapshotError('snapshot.json is not a JSON object');
  const doc = parsed as Record<string, unknown>;
  const asOf = requiredString(doc, 'as_of');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapshotError('snapshot.json has no as_of date');
  const source = requiredString(doc, 'source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = doc.protocols.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new SnapshotError(`snapshot.json's protocol ${idx} is not an object`);
    const rec = item as Record<string, unknown>;
    if (typeof rec.slug !== 'string' || typeof rec.name !== 'string' || typeof rec.tvl_usd !== 'number' || !Number.isFinite(rec.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${idx} lacks a slug, a name or a TVL`);
    }
    return {
      slug: rec.slug,
      name: rec.name,
      category: optionalString(rec.category),
      chains: Array.isArray(rec.chains) ? rec.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: rec.tvl_usd,
      change_7d: optionalNumber(rec.change_7d),
      mcap_usd: optionalNumber(rec.mcap_usd),
      listed_at: optionalString(rec.listed_at),
      gecko_id: optionalString(rec.gecko_id),
      symbol: optionalString(rec.symbol),
    };
  });
  return { as_of: asOf, source, floor_usd: doc.floor_usd as number, protocols, watchlist: doc.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const onBoard = new Set(board.map((row) => row.slug));
  const absent = snapshot.watchlist.filter((s) => !onBoard.has(s));
  if (absent.length > 0) return `the board misses ${absent.length} watchlist slug${absent.length === 1 ? '' : 's'}: ${absent.slice(0, 5).join(', ')}`;
  const rankOrder = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let i = 0; i < rankOrder.length; i++) if (rankOrder[i] !== i + 1) return `rank ${i + 1} is ${rankOrder[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  const firstValue = board[0]!.implied_value_usd;
  const lastValue = board[board.length - 1]!.implied_value_usd;
  if (board.length >= 2 && firstValue === lastValue) {
    return `all ${board.length} rows share the same implied value $${firstValue}: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(data: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(data) + ';\n';
}
