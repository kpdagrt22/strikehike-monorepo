"""Structured JSON logging with an execution id and secret redaction."""

from __future__ import annotations

import json
import sys
from datetime import date, datetime
from typing import Any, TextIO

from .models import iso_utc, sha256_hex
from .security import redact_secrets

_LEVELS = {"debug": 10, "info": 20, "warning": 30, "error": 40}


def make_execution_id(
    now: datetime, today: date, source_ids: tuple[str, ...] | list[str]
) -> str:
    """Deterministic id: the same run inputs produce the same filename."""

    material = "|".join((iso_utc(now), today.isoformat(), ",".join(sorted(source_ids))))
    return "run-" + sha256_hex(material)[:12]


class StructuredLogger:
    """One JSON object per line, always including ``execution_id``."""

    def __init__(
        self,
        execution_id: str,
        *,
        stream: TextIO | None = None,
        min_level: str = "info",
    ) -> None:
        self.execution_id = execution_id
        self.stream = stream if stream is not None else sys.stderr
        self.min_level = _LEVELS.get(min_level, 20)

    def _write(self, level: str, message: str, fields: dict[str, Any]) -> None:
        if _LEVELS[level] < self.min_level:
            return
        payload: dict[str, Any] = {
            "ts": iso_utc(datetime.now().astimezone()),
            "level": level,
            "execution_id": self.execution_id,
            "message": str(message),
        }
        payload.update(fields)
        line = redact_secrets(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
        )
        self.stream.write(line + "\n")
        self.stream.flush()

    def debug(self, message: str, **fields: Any) -> None:
        self._write("debug", message, fields)

    def info(self, message: str, **fields: Any) -> None:
        self._write("info", message, fields)

    def warning(self, message: str, **fields: Any) -> None:
        self._write("warning", message, fields)

    def error(self, message: str, **fields: Any) -> None:
        self._write("error", message, fields)

    def exception(self, message: str, **fields: Any) -> None:
        self._write("error", message, fields)
