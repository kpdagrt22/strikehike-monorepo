# Roundup approval

The weekly roundup is a published record, so approving it has two parts: the
roundup file and its ledger line. Both are committed together.

1. Draft the week:

   ```bash
   cd frontend
   npm run roundup:draft -- --week 2026-W47
   ```

2. Review `frontend/content/roundups/2026-W47.json`. Check the Regime line, the
   dates, the sky events and the wording. Set `"approved": true` only after that
   review.

3. Append the ledger line. Run from `backend/` with the backend environment
   pointing at the frontend's content route (the same route the sender uses):

   ```bash
   cd backend
   DIGEST_CONTENT_URL=http://127.0.0.1:3000 \
     python -m astro_finance.ledger append --week 2026-W47
   ```

   This reads the approved roundup, hashes the exact JSON served at
   `/this-week/2026-W47/data.json`, and appends one line to
   `frontend/content/ledger/ledger.jsonl`. It refuses an unapproved week, a week
   that already has a line, or a ledger whose chain does not verify.

4. Verify the chain and commit both files:

   ```bash
   python -m astro_finance.ledger verify
   git add frontend/content/roundups/2026-W47.json \
     frontend/content/ledger/ledger.jsonl
   ```

5. Deploy. The `/ledger` page and `/ledger.jsonl` read the committed file.

## Corrections

Never edit an existing line. Append a correction that points at the line it
corrects:

```bash
python -m astro_finance.ledger append --week 2026-W47 \
  --correction-of 3 \
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
