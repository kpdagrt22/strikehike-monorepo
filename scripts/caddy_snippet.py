"""Extract thisiskp's marked Caddy block without changing it."""

from __future__ import annotations

import sys
from pathlib import Path

BEGIN = "# BEGIN THISISKP.IN"
END = "# END THISISKP.IN"


def extract_block(text: str) -> str | None:
    """Return the marked block, markers included, or None when absent.

    The bytes between the markers are preserved exactly. A malformed block
    fails instead of silently writing a partial snippet.
    """
    start = text.find(BEGIN)
    if start < 0:
        return None
    end = text.find(END, start)
    if end < 0:
        raise ValueError("thisiskp Caddy block has a BEGIN marker without END")
    end += len(END)
    return text[start:end].rstrip("\n") + "\n"


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        print("usage: caddy_snippet.py <Caddyfile>", file=sys.stderr)
        return 2
    try:
        # newline="" and a binary write keep the block's line endings exact.
        with Path(args[0]).open(encoding="utf-8", newline="") as handle:
            block = extract_block(handle.read())
    except (OSError, ValueError) as exc:
        print(f"caddy snippet extraction failed: {exc}", file=sys.stderr)
        return 1
    if block is None:
        return 2
    sys.stdout.buffer.write(block.encode("utf-8"))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
