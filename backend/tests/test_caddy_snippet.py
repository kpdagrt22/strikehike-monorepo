from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts" / "caddy_snippet.py"

spec = importlib.util.spec_from_file_location("caddy_snippet", HELPER)
assert spec is not None and spec.loader is not None
caddy_snippet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caddy_snippet)


def test_extract_block_keeps_markers_and_content():
    source = (
        "# StrikeHike\n"
        "strikehike.com { reverse_proxy frontend:3000 }\n"
        "\n"
        "# BEGIN THISISKP.IN\n"
        "thisiskp.in {\n"
        "\treverse_proxy 172.17.0.1:4321\n"
        "}\n"
        "# END THISISKP.IN\n"
        "\n"
        "# tail\n"
    )
    block = caddy_snippet.extract_block(source)
    assert block == (
        "# BEGIN THISISKP.IN\n"
        "thisiskp.in {\n"
        "\treverse_proxy 172.17.0.1:4321\n"
        "}\n"
        "# END THISISKP.IN\n"
    )
    assert "StrikeHike" not in block
    assert "# tail" not in block


def test_extract_block_returns_none_without_markers():
    assert caddy_snippet.extract_block("strikehike.com { }\n") is None


def test_extract_block_rejects_a_missing_end_marker():
    with pytest.raises(ValueError, match="BEGIN marker without END"):
        caddy_snippet.extract_block("# BEGIN THISISKP.IN\nthisiskp.in { }\n")
