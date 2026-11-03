"""One-off verifier for the FRED release ids in ``sources.toml``.

Run manually with a real key:

    FRED_API_KEY=... python -m astro_finance.events.verify_fred_releases

It calls ``fred/releases`` (not ``releases/dates``) and checks that every id
and name in the registry still exist.  The key is read from the environment and
redacted from errors; it is never written to disk.
"""

from __future__ import annotations

import os
import sys
from typing import Any

import requests

from .registry import ReleaseSpec, load_registry
from .security import redact_secrets
from .text import normalize_text

RELEASES_ENDPOINT = "https://api.stlouisfed.org/fred/releases"
TIMEOUT_SECONDS = 20
MAX_PAGES = 5
PAGE_SIZE = 1000


class VerificationError(RuntimeError):
    pass


def fetch_releases(
    api_key: str,
    *,
    session: requests.Session | None = None,
) -> list[dict[str, Any]]:
    client = session or requests.Session()
    rows: list[dict[str, Any]] = []
    offset = 0
    total: int | None = None
    for _ in range(MAX_PAGES):
        try:
            response = client.get(
                RELEASES_ENDPOINT,
                params={
                    "api_key": api_key,
                    "file_type": "json",
                    "limit": PAGE_SIZE,
                    "offset": offset,
                },
                timeout=TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            raise VerificationError(
                redact_secrets(f"FRED request failed: {exc}", [api_key])
            ) from exc
        if response.status_code != 200:
            raise VerificationError(
                redact_secrets(
                    f"FRED returned HTTP {response.status_code}: {response.text[:200]}",
                    [api_key],
                )
            )
        payload = response.json()
        batch = payload.get("releases", [])
        if not isinstance(batch, list):
            raise VerificationError("FRED response has no releases list")
        if total is None:
            total = int(payload.get("count", len(batch)))
            if total > MAX_PAGES * PAGE_SIZE:
                raise VerificationError("FRED releases need more than the page budget")
        rows.extend(item for item in batch if isinstance(item, dict))
        offset += len(batch)
        if not batch or offset >= (total or 0):
            break
    return rows


def verify(releases: tuple[ReleaseSpec, ...], rows: list[dict[str, Any]]) -> list[str]:
    by_id = {int(row.get("id", -1)): row for row in rows}
    problems: list[str] = []
    for release in releases:
        row = by_id.get(release.release_id)
        if row is None:
            problems.append(f"{release.release_id}: not found")
            continue
        actual = normalize_text(row.get("name", ""))
        if actual.casefold() != release.name.casefold():
            problems.append(
                f"{release.release_id}: expected {release.name!r}, found {actual!r}"
            )
    return problems


def main(argv: list[str] | None = None) -> int:
    del argv
    api_key = os.environ.get("FRED_API_KEY", "").strip()
    if not api_key:
        print("FRED_API_KEY is not set", file=sys.stderr)
        return 1
    registry = load_registry()
    source = registry.by_id().get("fred_release_dates")
    if source is None:
        print("fred_release_dates is not in sources.toml", file=sys.stderr)
        return 1
    try:
        rows = fetch_releases(api_key)
    except VerificationError as exc:
        print(redact_secrets(exc, [api_key]), file=sys.stderr)
        return 1
    problems = verify(source.releases, rows)
    for release in source.releases:
        print(f"{release.release_id}\t{release.name}\tverified_on={release.verified_on}")
    if problems:
        for problem in problems:
            print(f"mismatch: {problem}", file=sys.stderr)
        return 1
    print(f"ok: {len(source.releases)} release ids and names match")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
