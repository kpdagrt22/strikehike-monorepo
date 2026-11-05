# Curated upcoming events

This directory is the only hand-maintained source of upcoming events.  Three
files exist so that an entry lands next to its theme:

| File | Themes accepted |
|---|---|
| `politics.toml` | `Politics` |
| `culture_religion.toml` | `Culture/Religion` |
| `finance.toml` | `Finance` (non-US central banks and similar official dates) |

`curated_upcoming` in `../sources.toml` declares all three themes.  An entry
whose theme is not declared there is rejected, and so is an entry without a
`source_url`.

## Schema

```toml
[[events]]
theme = "Finance"                 # required, one of the three above
name = "RBI Monetary Policy Committee decision"   # required
date = "2026-12-04"               # required, YYYY-MM-DD
external_id = "rbi-mpc-2026-12"   # optional; stable per occurrence
source_url = "https://www.rbi.org.in/..."         # required, https, official
verified_on = "2026-11-03"        # required, the day you opened source_url
status = "scheduled"              # scheduled | tentative | cancelled
description = "Optional."          # optional, plain language
time = "10:00"                    # optional; requires timezone
timezone = "Asia/Kolkata"         # IANA zone; required when time is set
```

Rules enforced by the loader and validation stage:

- `source_url` must be an absolute **https** URL on the official election
  authority, government, central bank, church or organiser page.  A news
  article, Wikipedia page or prediction site is not an official source.
- `verified_on` must be a real date and must not be in the future.
- An entry with a `time` must also have an IANA `timezone`.  Without a `time`
  the event is all-day.  The bundle builder applies the confirmed times for
  the `fomc-`, `boe-mpc-` and `ecb-gc-` decisions; see
  `src/astro_finance/events/release_times.py` for the agency citations.
- A recurring title (for example a central-bank decision that happens several
  times a year) should carry an `external_id` that is stable per occurrence,
  such as `boe-mpc-2026-11`.  Without one, identity is
  `theme + source + slug(name) + start year`, which intentionally keeps a
  rescheduled event's identity but collides when the same title recurs in one
  year.
- The date must fall inside `[today, today + 400 days]` when the bundle is
  built; entries outside that window are rejected with a reason in
  `rejects.json`.
- Never pad a theme to five events.  Two verified events are better than five
  with three invented ones.

## Verified entries currently shipped

`finance.toml` contains Bank of England and European Central Bank monetary
policy decision dates read from their official calendars on 2026-11-03.
`politics.toml` and `culture_religion.toml` intentionally contain only
commented examples: no Politics or non-Easter Culture/Religion date was
verified on an official page for 2026-2027.

## Checking the result

After adding an entry, run a dry build and read the reject list:

```bash
cd backend
PYTHONPATH="src;." C:/Python314/python.exe -m astro_finance.events build \
  --out C:/temp/events-demo --offline tests/events/fixtures/offline --today 2026-11-03
```

Unsupported or incomplete entries appear in `C:/temp/events-demo/rejects.json`
with their reasons; nothing is silently dropped.
