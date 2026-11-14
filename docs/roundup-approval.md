# Roundup approval

The weekly roundup is a published record, so approving it has two parts: the
roundup file and its ledger line. Both are committed together.

1. Draft the week:

   ```bash
   cd frontend
   npm run roundup:draft -- --week 2026-W48
   ```

2. Review `frontend/content/roundups/2026-W48.json`. Check the Regime line, the
   dates, the sky events and the wording.

3. Commit the unapproved draft, so the approval helper has a clean base:

   ```bash
   git add frontend/content/roundups/2026-W48.json
   git commit -m "Draft 2026-W48 for approval"
   ```

4. Approve with the helper. It flips only the `"approved": false` byte range to
   `true`, appends the ledger line, verifies the chain, and prints the new line
   and the LF-normalised sha256:

   ```bash
   cd frontend
   npm run roundup:approve -- --week 2026-W48
   ```

   The Python equivalent is:

   ```bash
   cd backend
   python -m astro_finance.ledger approve --week 2026-W48
   ```

   The helper refuses when the week is already approved, the roundup file has
   any other change against `HEAD`, the roundup is not committed, or the ledger
   has uncommitted changes. It never commits.

5. Verify the hash and commit both files:

   ```bash
   curl -s https://strikehike.com/this-week/2026-W48/roundup.json | sha256sum
   git add frontend/content/roundups/2026-W48.json \
     frontend/content/ledger/ledger.jsonl
   git commit -m "Publish 2026-W48 roundup + ledger line"
   ```

   The `sha256sum` must equal `roundup_sha256` in the new ledger line.

6. Deploy. The `/ledger` page and `/ledger.jsonl` read the committed file.

## Monday auto-send

`digest-send.yml` has a Monday 01:30 UTC (07:00 IST) schedule. It is off unless
the repository variable `DIGEST_AUTOSEND` is set to `1`. The runner computes the
current ISO week in Asia/Kolkata and refuses to send if that week is not
approved. Manual dispatch still defaults to a dry run. This repository never sets
the variable; set it in GitHub repository settings when you want the Monday
send. The sender's per-subscriber send rows make a rerun a no-op.

## Corrections

Never edit an existing line. Append a correction that points at the line it
corrects:

```bash
python -m astro_finance.ledger append --week 2026-W47 \
  --correction-of 2 \
  --reason "The label was corrected after a typo."
```

The correction records the current approved reading and roundup hash, its own
publication time, and `prev_hash`. The old line stays byte-for-byte unchanged.

## Checks

- `python -m astro_finance.ledger verify` recomputes every line hash and every
  `prev_hash` link. The backend test job runs it.
- The backend tests also fail if an approved roundup has no ledger line.
- The pull-request check fails if `frontend/content/ledger/ledger.jsonl` changes
  in any way other than appending lines to the end.
- The genesis line is 2026-W46. Its `published_at` is
  `2026-11-12T11:07:41Z`, the UTC committer time of the P14 merge commit
  `509f0a4`. Earlier weeks are not backfilled.
