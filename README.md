# Renewable Overbuild Optimizer

An interactive, browser-based calculator that optimizes how much wind and solar
capacity a data center needs to cover a target share of its electricity
consumption, given a flexible hourly load and a target average utilization.

Answers: *"How much wind and solar capacity is required to cover X% of a data
center's electricity consumption when the data center can adapt its power
consumption to renewable generation within a defined flexibility band, while
maintaining a defined average utilization?"*

No storage is assumed and hour-by-hour renewable coverage is not guaranteed —
the tool optimizes *annual* renewable coverage via a flexible load.

## How it works

- **DC flexibility** sets how far the hourly data center load may deviate from
  the target utilization, as a band `[util×(1−f), util×(1+f)]`.
- For a fixed wind/solar mix, an inner water-filling pass distributes load
  within that band to maximize renewable energy actually consumed while
  keeping the average load exactly at the target utilization.
- An outer scan over wind/solar mix ratios bisects on total capacity to find
  the smallest overbuild (or cheapest, if cost inputs are given) that reaches
  the renewable coverage target.
- Everything runs client-side in the browser (see `src/lib/optimizer.ts`).

## Using it

1. `npm install`
2. `npm run dev`
3. Use the synthetic demo dataset out of the box, or upload your own Fingrid
   data (see below).

## Data upload & automatic discovery

The upload accepts CSV or Excel files in essentially any layout — Fingrid's
native multi-dataset export (`datasetId, startTime, endTime, value` rows
stacked together), a tidy single sheet with named columns, or a multi-sheet
workbook. It automatically finds and matches:

- Wind production forecast (Fingrid datasets 245/246)
- Solar production forecast (247/248)
- Wind available/installed capacity (268)
- Solar available/installed capacity (267)

matched by column header, sheet name, unit, Fingrid dataset ID, and Finnish or
English naming (`src/lib/discovery/`). Sub-hourly data is detected and
aggregated to hourly — averaged for MW power values, summed for MWh energy —
and time-varying capacity is joined to production by timestamp (forward-filled
as a step function) rather than using one constant for the whole period.

Nothing is guessed silently: a "Data detected" panel shows what was matched
and its confidence, lets you override the pick via dropdown when more than
one column could match, and blocks running the optimizer until all four
series are identified.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — type-check and build for production
- `npm test` — run the optimizer unit tests (vitest)
- `npm run lint` — lint with oxlint
