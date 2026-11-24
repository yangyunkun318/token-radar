# Token Radar

A radar for token launches: it takes a frozen DefiLlama snapshot (758 protocols, 2026-11-14),
scores every protocol that records no token by what its launch would be worth, and hands each
one a seven-step plan for farming it.

## The model (radar-3-farm)

Implied value = TVL × category multiple × growth × maturity.

- **Category multiple**: the median market-cap / TVL, per category, of the protocols in that
  category that already trade, read from the same snapshot. A category with fewer than 4
  traded names uses the all-market median instead. Clamped to 0.05 – 1.00.
- **Growth**: a protocol's 7-day TVL change, clamped to −60% … +120%, counted at half weight.
- **Maturity**: 0.60 + min(age, 1095 days) / 1095 × 0.40; a protocol with no listing date is
  scored as 365 days old.
- **Farm plans**: seven steps per protocol, each with a cost and a time, built from the
  protocol's own category, chains, TVL and age. The weekly qualifying action fits the
  category's own activity — a swap plus an LP move for a DEX, a borrow-and-repay for a
  lender, a harvest for a yield farm — and the claim step points the farmer at that
  protocol's own points program, quests or leaderboard.

No protocol is special-cased by name. The board holds all 198 rankable pre-token protocols:
the 40 on the watchlist plus every other pre-token protocol that is neither an exchange nor
a versioned pool. Protocols that already trade are kept separate and shown at the market's
own values.

## The dashboard

A static dark page: a board you can sort and filter (search, category, chain, watchlist-only),
a per-protocol detail view that breaks the model down factor by factor, a live-token
comparison, the calibration table, and a sandbox that re-ranks the board under different
assumptions.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Runs on Node 22 with the standard library only; running it twice writes identical bytes.

## Make.fun badges

[![m](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?ref=zhc1s3ge)
<!-- rank badge -->
[![m](https://make.fun/badge/token-radar-01/yangyunkun318/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01?ref=zhc1s3ge)
<!-- reward badge -->
[![m](https://make.fun/badge/token-radar-01/yangyunkun318/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?ref=zhc1s3ge)
