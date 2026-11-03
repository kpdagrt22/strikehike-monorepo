from __future__ import annotations

import json
from pathlib import Path

from astro_finance.events.cli import main
from astro_finance.events.security import find_secret_patterns, redact_secrets
from conftest import FIXTURES


def test_redact_secrets_hides_query_values():
    text = "GET https://api.example/x?api_key=abc123&series=CPI"
    assert "abc123" not in redact_secrets(text)
    assert "api_key=REDACTED" in redact_secrets(text)


def test_redact_secrets_hides_bearer_tokens_and_private_keys():
    assert "abc.def" not in redact_secrets("Authorization: Bearer abc.def")
    private = "-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----"
    assert "secret" not in redact_secrets(private)


def test_redact_secrets_does_not_break_a_sha256_digest():
    digest = "a" * 64
    assert redact_secrets(digest) == digest


def test_redact_secrets_replaces_a_standalone_fred_key():
    key = "0123456789abcdef0123456789abcdef"
    assert key not in redact_secrets(f"key={key}")
    assert redact_secrets(key) == "REDACTED"


def test_redact_secrets_uses_the_environment_value(monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "my-very-secret-value")
    assert "my-very-secret-value" not in redact_secrets("boom my-very-secret-value")


def test_find_secret_patterns_reports_a_query_key():
    findings = find_secret_patterns("api_key=abc")
    assert findings


def test_find_secret_patterns_accepts_clean_text():
    assert find_secret_patterns("nothing to see here") == []


def _build(out: Path, *extra: str) -> int:
    return main(
        [
            "build",
            "--out",
            str(out),
            "--offline",
            str(FIXTURES / "offline"),
            "--today",
            "2026-11-03",
            *extra,
        ]
    )


def test_cli_build_validate_report_and_diff(tmp_path, capsys):
    out = tmp_path / "build"
    assert _build(out) == 0
    bundle = out / "bundle"
    assert (bundle / "manifest.json").exists()
    assert main(["validate", str(bundle)]) == 0
    assert main(["report", str(bundle)]) == 0
    assert main(["diff", str(bundle), str(bundle)]) == 0
    captured = capsys.readouterr()
    assert "Publishable" in captured.out or "publishable" in captured.out
    assert "added: 0" in captured.out


def test_cli_build_exits_two_when_a_gate_fails(tmp_path, capsys):
    out = tmp_path / "incomplete"
    assert _build(out, "--sources", "curated_upcoming") == 2
    bundle = out / "bundle"
    report = json.loads((bundle / "quality_report.json").read_text("utf-8"))
    assert report["publishable"] is False
    assert any(gate["status"] == "fail" for gate in report["gates"])
    assert main(["validate", str(bundle)]) == 2


def test_cli_build_exits_one_for_an_unknown_source(tmp_path):
    assert _build(tmp_path / "bad", "--sources", "not_a_source") == 1


def test_cli_build_exits_one_for_a_bad_date(tmp_path):
    assert main(
        [
            "build",
            "--out",
            str(tmp_path / "bad-date"),
            "--offline",
            str(FIXTURES / "offline"),
            "--today",
            "03/11/2026",
        ]
    ) == 1


def test_cli_usage_errors_exit_one(capsys):
    assert main(["nonsense"]) == 1
    assert main(["build"]) == 1


def test_cli_report_missing_bundle_exits_one(tmp_path):
    assert main(["report", str(tmp_path / "missing")]) == 1


def test_cli_diff_missing_bundle_exits_one(tmp_path):
    assert main(["diff", str(tmp_path / "missing"), str(tmp_path / "missing2")]) == 1
