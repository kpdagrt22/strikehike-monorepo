"""Canonical JSON and hashes shared with the Node verifier.

Rules: keys sorted, no whitespace, UTF-8, every number written as a string.
Integers stay bare (``"seq": "1"``); floats use one fixed decimal
(``"core_index": "15.8"``). The hash excludes the ``hash`` field itself.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


class CanonicalError(ValueError):
    pass


def _string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def canonical_json(value: Any) -> str:
    if isinstance(value, str):
        return _string(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, int):
        return _string(str(value))
    if isinstance(value, float):
        return _string(f"{value:.1f}")
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        parts = []
        for key in sorted(value):
            if not isinstance(key, str):
                raise CanonicalError("object keys must be strings")
            parts.append(f"{_string(key)}:{canonical_json(value[key])}")
        return "{" + ",".join(parts) + "}"
    raise CanonicalError(f"unsupported value: {type(value).__name__}")


def ledger_hash(entry: dict[str, Any]) -> str:
    payload = {key: value for key, value in entry.items() if key != "hash"}
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()
