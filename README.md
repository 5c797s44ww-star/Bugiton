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

The upload accepts raw CSV or Excel files downloaded from Fingrid, unmodified
— one or several at once, in essentially any layout: Fingrid's native
multi-dataset export (`datasetId, startTime, endTime, value` rows stacked
together), a tidy single sheet with named columns, or a multi-sheet workbook.
Production and capacity data can be uploaded as **separate files** (each new
upload merges into whatever's already been matched, rather than replacing
it), and each of the four series is identified independently by column
header, sheet name, unit, Fingrid dataset ID, and Finnish or English naming
(`src/lib/discovery/`):

- Wind production forecast (Fingrid datasets 245/246)
- Solar production forecast (247/248)
- Wind available/installed capacity (268)
- Solar available/installed capacity (267)

**Independent time resolutions.** Production and capacity need not share a
resolution *or* timestamps at all — e.g. 15-minute wind/solar production
against hourly capacity is a normal case, handled automatically. Each
production reading is normalized against the capacity applicable at its own
exact timestamp (a forward-filled step function, so a capacity change mid-
year — or even mid-hour — takes effect exactly where it should) *before* any
aggregation to hourly; only the resulting capacity-factor values are then
averaged up to hourly. Doing it in that order matters whenever capacity isn't
constant across the readings being combined — averaging production first and
dividing by one capacity value afterwards would silently give a different
(wrong) answer. The result is always converted into the canonical,
source-agnostic format the optimizer actually consumes:
`{ timestamp, wind_CF, solar_CF }` — see `src/lib/discovery/buildRecords.ts`
for the ingestion side and `src/lib/optimizer.ts` for the (untouched, source-
unaware) optimization engine.

**Timezone/DST.** Fingrid's own API timestamps carry an explicit UTC offset
and are trusted as-is; a naive timestamp with no timezone marker (as Excel
date cells and many hand-exported CSVs have) is interpreted as Finnish local
time and converted correctly across DST transitions
(`src/lib/discovery/timezone.ts`, via `Intl` — no timezone-database
dependency needed).

Nothing is guessed silently: a "Data detected" panel shows what was matched
and its confidence, production and capacity resolutions, the covered period,
and a data-quality score; it lets you override the pick via dropdown when
more than one column could match, and blocks running the optimizer until all
four series are identified — naming exactly what's still missing otherwise.
Data-quality checks (missing/duplicate timestamps, zero or missing capacity,
production exceeding capacity, impossible values) run both at each series'
own native resolution, before aggregation can smooth anything over, and again
on the final hourly view.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — type-check and build for production
- `npm test` — run the optimizer unit tests (vitest)
- `npm run lint` — lint with oxlint
