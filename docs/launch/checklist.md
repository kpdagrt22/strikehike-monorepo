# Launch checklist

Draft only. This file is a plan to run by hand; nothing in the repository posts,
deploys or merges anything. The launch is the 9–15 Nov 2026 roundup going live
with the `/about` page, Politics hidden (D-12) and the stress floors removed
(D-17). Everything here is run after the release is on `main` and deployed.

The launch material for each channel is in this folder:

| Channel | Draft | Image |
| --- | --- | --- |
| Hacker News | `show-hn.md` | `img/oc-chart.png` |
| r/dataisbeautiful | `reddit-dataisbeautiful.md` | `img/oc-chart.png` |
| LinkedIn | `linkedin.md` | `img/linkedin-1200x1500.png` |
| X | `x-thread.md` | `img/x-1200x675.png` |
| (any) demo clip | — | `img/demo.webm` (27 s, sound on) |

Clock note: the launch week is on US Eastern Standard Time (UTC−5) and India
Standard Time (UTC+5:30). **IST = ET + 10 h 30 m**, so the US morning reaches
India in the Indian evening. Every time below is IST.

## The night before

- [ ] Confirm the release is on `main` and the deploy run finished green:
      the **Deploy monorepo to Lightsail** job ran its probes
      (`backend`, `events`, `chrono`, `atlas`, `home`, `regime`, `upcoming page`,
      `thisiskp`).
- [ ] Run the QA crawler against production:
      `node scripts/launch-check.mjs https://strikehike.com` from `frontend/`.
      It must pass: 13 sitemap pages return 200, every title, description,
      canonical and `og:image` is present, `/calendar/politics.ics`,
      `/upcoming/politics` and `/upcoming/natural-disasters` all 404, and no page
      ships more than 1 MB of JavaScript.
- [ ] Run it again if the deploy re-ran. A 503 on `/calendar/all.ics` before the
      events bundle is active is the one known transient; re-run.
- [ ] Open one page on a phone over mobile data (not office Wi-Fi): the home
      orrery, the corona gauge and the sound control.
- [ ] Check the five things a visitor lands on: the home orrery, `/this-week`
      (the new roundup), `/about`, `/upcoming` (no Politics chip), `/tested`.
- [ ] Have `img/demo.webm` and each card ready to attach; re-read the drafts once
      for typos and remove nothing that is checkable on the site.
- [ ] Set aside two clear hours for the first-six-hours watch (below).

## Posting order and times (IST, to land in the US morning)

Post on a Tuesday, Wednesday or Thursday. Do **not** post on a US holiday or a
Friday afternoon US time. Space the channels out; do not fire everything at once.

| # | When (IST) | Where | Lands at (US ET) | Draft |
| --- | --- | --- | --- | --- |
| 1 | 18:30 | Hacker News, Show HN | ~08:00 ET | `show-hn.md` |
| 2 | 20:00 | r/dataisbeautiful | ~09:30 ET | `reddit-dataisbeautiful.md` |
| 3 | 20:30 | X thread | ~10:00 ET | `x-thread.md` |
| 4 | 21:00 | LinkedIn | ~10:30 ET | `linkedin.md` |

- **18:30 IST (08:00 ET) — Show HN.** Title and the first comment from
  `show-hn.md`. The first comment is the post's pitch; paste it immediately
  after submitting so it is there before the first readers. Attach
  `img/oc-chart.png` only if the thread asks for the picture; Show HN threads
  read better as text.
- **20:00 IST (09:30 ET) — r/dataisbeautiful.** Post the `[OC]` title, attach
  `img/oc-chart.png`, then the source/tools comment from
  `reddit-dataisbeautiful.md` straight away.
- **20:30 IST (10:00 ET) — X.** Post the seven posts as one thread, in order,
  with `img/x-1200x675.png` on post 1 and `img/demo.webm` on post 2 (or post 6).
- **21:00 IST (10:30 ET) — LinkedIn.** The post text from `linkedin.md` with
  `img/linkedin-1200x1500.png`.

If a channel is going badly (buried, no replies), do not repost the same day. Let
it sit and use the next channel's slot; the drafts are short enough to lift the
strongest comment from one and use it in another.

## The first six hours

Watch these, in this order, and reply where a reply is warranted (see below).

- [ ] **Submission is up.** Each post is public and the links resolve
      (`https://strikehike.com`, `/tested`, `/this-week/2026-W46`).
- [ ] **Site is up.** Load `/` and `/tested` on a phone; the Javscript budget
      that `launch-check` measured must not have grown. If the site is slow or
      down, stop posting and treat it as an incident, not a launch.
- [ ] **The one number people repeat.** If a number is quoted back at you,
      check it against the page before agreeing. The tested figures (Mercury
      retrograde 0.48 % vs 0.29 %, p = 0.62; full moon 0.08 % vs 0.09 %,
      p = 0.91; eclipses 0.12 % vs −0.07 %, p = 0.25) and the roundup's
      Core Index line are the ones most likely to be misread.
- [ ] **Politics.** If someone asks where Politics went, the answer is D-12:
      the theme has no verified source yet, so it is not shown while it would be
      a guess. It is not deleted; the model and the older events still exist.
- [ ] **Method questions.** Point to the page's own *Method & limits* note
      first; `/about` and `/disclaimer` cover the data sources.
- [ ] **Abuse or spam.** Ignore; do not argue. One factual reply at most.
- [ ] **Feedback worth keeping.** Copy it into an issue or a note; do not
      promise a change on the thread.

## Replying

- **Do reply** to a specific method question, a data-source question, a "you got
  X wrong, here is the number" comment, or a correction you can verify.
- **Do reply** to anyone who says they could not load the page (ask browser,
  confirm from your side, then answer).
- **Do not** reply to "the market will crash", bait, or opinions on astrology as
  a subject. Do not defend the project; state what the page shows and move on.
- **Keep replies short and checkable.** One or two sentences, one link at most,
  and no claim the site does not already make.
- **Never** turn a reply into advice, a level, an allocation, or anything about
  what comes next. The house wording is "descriptive historical research, not
  investment advice, and not a forecast."

## If something breaks: roll back

The site deploys from `main` through **Deploy monorepo to Lightsail**
(`.github/workflows/deploy-lightsail.yml`). It already keeps the previous images:
before it builds a new stack it tags the running containers as
`strikehike-rollback-backend:rollback` and
`strikehike-rollback-frontend:rollback`, and if the new stack or any probe fails
it brings the tagged images back automatically.

- [ ] **A probe failed on deploy.** Do nothing: the workflow already restored the
      previous images and failed the job. Read the log, fix forward, push again.
- [ ] **The site broke after the deploy was green.** Re-run the same workflow
      with **Run workflow** and its `rehearse_rollback` input if you want to
      prove the restore path; for the real thing, on the Lightsail host restore
      the tagged images with the Compose override the workflow writes
      (`strikehike-rollback-backend:rollback`,
      `strikehike-rollback-frontend:rollback`), then bring the stack up.
- [ ] **Only the events bundle is wrong** (a date is missing or wrong). Roll the
      bundle back without touching the site:
      `python -m astro_finance.events rollback` in the backend container.
- [ ] After any rollback, re-run `launch-check` against production before
      resuming the launch.

## After the launch

- [ ] Collect the questions that came up more than once; they are the next
      FAQ or `/about` tweak.
- [ ] Note which card and which opening line did the work; keep the winners in
      this folder for the next roundup.
- [ ] Leave the drafts as they are: this folder is a record of what was posted,
      not a live channel.
