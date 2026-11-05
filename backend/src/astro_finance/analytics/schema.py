"""The shared event contract and its validator.

The JSON file beside this module is a byte-identical copy of the frontend
schema. The backend loads its own copy at runtime because the Docker build
contexts are separate.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).with_name("schema.json")


class ValidationError(ValueError):
    """A batch or event does not match the contract."""


class PayloadTooLarge(ValidationError):
    """The request body exceeds the contract's byte cap."""


@lru_cache(maxsize=1)
def load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _depth(value: Any, level: int = 0) -> int:
    if isinstance(value, dict):
        return max((_depth(item, level + 1) for item in value.values()), default=level)
    if isinstance(value, list):
        return max((_depth(item, level + 1) for item in value), default=level)
    return level


def _check_string(value: Any, rule: dict[str, Any]) -> str:
    if not isinstance(value, str):
        raise ValidationError("expected a string")
    if len(value) > int(rule.get("max", 64)):
        raise ValidationError("string is too long")
    pattern = rule.get("pattern")
    if pattern and not re.fullmatch(str(pattern), value):
        raise ValidationError("string does not match its pattern")
    return value


def _check_prop(value: Any, rule: dict[str, Any]) -> Any:
    kind = rule.get("type")
    if kind == "enum":
        if value not in rule.get("values", []):
            raise ValidationError("value is not in the enum")
        return value
    if kind == "int":
        if not _is_int(value):
            raise ValidationError("expected an integer")
        if "values" in rule and value not in rule["values"]:
            raise ValidationError("integer is not in the allowed set")
        if "min" in rule and value < int(rule["min"]):
            raise ValidationError("integer is too small")
        if "max" in rule and value > int(rule["max"]):
            raise ValidationError("integer is too large")
        return value
    if kind == "string":
        return _check_string(value, rule)
    if kind == "array":
        if not isinstance(value, list) or len(value) > int(rule.get("max", 25)):
            raise ValidationError("array is too long")
        return [_check_prop(item, rule["items"]) for item in value]
    raise ValidationError("unknown property type")


def _check_event(raw: Any, schema: dict[str, Any]) -> tuple[dict[str, Any], int]:
    if not isinstance(raw, dict):
        raise ValidationError("event is not an object")
    name = raw.get("n")
    definition = schema["events"].get(name)
    if not isinstance(name, str) or definition is None:
        raise ValidationError("unknown event name")
    timestamp = raw.get("t")
    if not _is_int(timestamp) or timestamp <= 0:
        raise ValidationError("invalid client timestamp")
    pv = raw.get("pv")
    if not isinstance(pv, str) or not re.fullmatch(schema["ids"]["pv"], pv):
        raise ValidationError("invalid page-view id")
    path = raw.get("p")
    if path not in schema["paths"]:
        raise ValidationError("path is not in the template allow-list")

    props = raw.get("pr", {})
    if props is None:
        props = {}
    if not isinstance(props, dict):
        raise ValidationError("props is not an object")
    allowed = definition["properties"]
    clean: dict[str, Any] = {}
    stripped = 0
    for key, value in props.items():
        rule = allowed.get(key)
        if rule is None:
            stripped += 1
            continue
        clean[key] = _check_prop(value, rule)
    for key in definition.get("required", []):
        if key not in clean:
            raise ValidationError(f"missing required property {key}")
    if len(json.dumps(clean, separators=(",", ":")).encode("utf-8")) > int(
        schema["limits"]["max_props_bytes"]
    ):
        raise ValidationError("props is too large")
    return {
        "name": name,
        "client_ts": timestamp,
        "pv_id": pv,
        "path": path,
        "props": clean,
    }, stripped


def _check_vis(raw: Any, schema: dict[str, Any]) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > int(schema["limits"]["max_vis"]):
        raise ValidationError("vis is not a valid array")
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValidationError("vis item is not an object")
        pv = item.get("pv")
        ms = item.get("ms")
        if not isinstance(pv, str) or not re.fullmatch(schema["ids"]["pv"], pv):
            raise ValidationError("invalid vis page-view id")
        if not _is_int(ms) or not 0 <= ms <= 1_800_000:
            raise ValidationError("invalid visible time")
        row: dict[str, Any] = {"pv": pv, "ms": ms}
        for key in ("lcp", "inp", "cls"):
            value = item.get(key)
            if value is not None:
                if not _is_int(value) or value < 0:
                    raise ValidationError("invalid RUM value")
                row[key] = value
        out.append(row)
    return out


def validate_batch(
    payload: Any, body_bytes: int | None = None
) -> tuple[dict[str, Any], list[dict[str, Any]], int, list[dict[str, Any]]]:
    schema = load_schema()
    limits = schema["limits"]
    if body_bytes is not None and body_bytes > int(limits["max_body_bytes"]):
        raise PayloadTooLarge("body is too large")
    if not isinstance(payload, dict):
        raise ValidationError("body is not an object")
    if _depth(payload) > int(limits["max_depth"]):
        raise ValidationError("payload is nested too deeply")
    if payload.get("v") != 1:
        raise ValidationError("unknown schema version")
    for key in ("aid", "sid"):
        value = payload.get(key)
        if not isinstance(value, str) or not re.fullmatch(schema["ids"][key], value):
            raise ValidationError(f"invalid {key}")
    for key in ("new", "eph"):
        if payload.get(key) not in (0, 1):
            raise ValidationError(f"invalid {key}")
    ctx = payload.get("ctx")
    if not isinstance(ctx, dict):
        raise ValidationError("ctx is not an object")
    if not _is_int(ctx.get("vw")) or ctx["vw"] < 0 or ctx["vw"] > 10_000:
        raise ValidationError("invalid viewport")
    for key, cap in (("tz", 64), ("app", 7)):
        value = ctx.get(key)
        if not isinstance(value, str) or len(value) > cap:
            raise ValidationError(f"invalid ctx.{key}")
    exp = payload.get("exp") or []
    if not isinstance(exp, list) or len(exp) > 3 or any(
        not isinstance(item, str) or len(item) > 64 for item in exp
    ):
        raise ValidationError("invalid experiment assignments")

    events = payload.get("ev")
    if not isinstance(events, list) or len(events) > int(limits["max_events"]):
        raise ValidationError("invalid event list")
    checked: list[dict[str, Any]] = []
    stripped = 0
    invalid = 0
    # One malformed event is dropped and counted; it does not cost the rest of
    # the batch (a landing page view, its referrer and UTMs).
    for event in events:
        try:
            checked_event, removed = _check_event(event, schema)
        except ValidationError:
            invalid += 1
            continue
        checked.append(checked_event)
        stripped += removed
    vis = _check_vis(payload.get("vis"), schema)
    envelope = {
        "aid": payload["aid"],
        "sid": payload["sid"],
        "new": int(payload["new"]),
        "eph": int(payload["eph"]),
        "vw": ctx["vw"],
        "tz": ctx["tz"],
        "app": ctx["app"],
        "exp": exp,
    }
    return envelope, checked, stripped, vis, invalid
