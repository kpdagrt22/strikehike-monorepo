# r/dataisbeautiful — StrikeHike

Draft only. Nothing here is posted by this repository; see `checklist.md`.

## Title ([OC], 130 characters)

```
[OC] I tested Mercury retrograde, the full moon and eclipses against 99 years of the S&P 500 — none showed a meaningful difference
```

## Image

`img/oc-chart.png` (1600 × 1000). Three panels, one per claim: the mean return
per window for each year of the daily record, plus the window count, the mean
per window, the matched-window mean, the permutation p-value, and the verdict.

## Comment (source, tools, method)

Source: my own site, StrikeHike — https://strikehike.com/tested

Data: daily S&P 500 (Yahoo `^GSPC`) from 30 Dec 1927, chained to the Cowles
monthly index (NBER `M1125AUSM343NNBR`) before that, giving a 1871–2026 record.
Astronomy: Skyfield with the DE406 ephemeris.

Method: for each claim I take its windows — Mercury retrograde periods (about 22
days each), full-moon days and eclipse days (7 days each) — and measure the S&P
return over each whole window, from the first session's close to the last
session's close. Each event window is compared with the nearest non-overlapping
window of the same length, using a permutation test (2,000 draws, seed 20261111).

Results:

| Claim | Window length | Mean return per window | Mean return, matched windows | p-value |
| --- | --- | --- | --- | --- |
| Mercury retrograde | ~22 days | +0.48% | +0.29% | 0.62 |
| Full moon | 7 days | +0.08% | +0.09% | 0.91 |
| Eclipses | 7 days | +0.12% | −0.07% | 0.25 |

None clears the bar, so all three read "no meaningful difference in this record".

Tools: Python and pandas for the analysis, the site's own Next.js charts for the
image.

The weekly roundup carries the same record forward: the Regime reading, the dates
ahead and the sky events, with an email you can subscribe to. Every published
roundup is fingerprinted into an append-only public ledger:
https://strikehike.com/ledger

Caveat: descriptive historical research, not investment advice and not a
forecast. The method, the windows and every number — including the null results —
are on the page.
