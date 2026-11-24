# Token Radar

A token launch radar: it reads a frozen DefiLlama snapshot (758 protocols, 2026-11-14), ranks the
protocols that record no token by what a launch would be worth, and shows each one with the steps
to farm it.

## The model (radar-3-farm)

Implied value = TVL × category multiple × growth × maturity.

- **Category multiple**: for each category, the median market-cap / TVL of the protocols in that
  category that already trade, taken from the same snapshot. Categories with fewer than 4 traded
  names fall back to the all-market median. Clamped to 0.05 – 1.00.
- **Growth**: the protocol's 7-day TVL change, clamped to −60% … +120%, at half weight.
- **Maturity**: 0.60 + min(age, 1095 days) / 1095 × 0.40; unknown age scores as 365 days.
- **Farm plans**: each protocol gets seven steps with a cost and a time, derived from its own
  category, chains, TVL and age. The weekly qualifying action is written for the category's
  own activity (a swap and LP move for a DEX, a borrow-and-repay for a lender, a harvest for
  a yield farm), and the claim step tells the farmer to check that protocol's own points
  program, quests or leaderboard.

No protocol name is special-cased. The board ranks all 198 rankable pre-token protocols: the 40
on the watchlist plus every other pre-token protocol that is not an exchange or a versioned pool.
Live-token protocols are kept apart and shown with the market's own values.

## The dashboard

A static dark-theme page: a sortable, filterable board (search, category, chain, watchlist-only),
a detail view per protocol with the model broken down factor by factor, a live-token comparison,
the calibration table, and a sandbox that re-ranks the board under different assumptions.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22, standard library only. Two runs write the same bytes.

## Badges

[![m](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?ref=zhc1s3ge)
[![m](https://make.fun/badge/token-radar-01/yangyunkun318/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01?ref=zhc1s3ge)
[![m](https://make.fun/badge/token-radar-01/yangyunkun318/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?ref=zhc1s3ge)
