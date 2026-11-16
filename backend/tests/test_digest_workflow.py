"""The dispatch shape of digest-send.yml: the preview address never reaches a log.

The repository is public, so workflow inputs and logs are public. The preview
address comes from a repository secret and is only expanded into the remote
command, never echoed.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
WORKFLOW = WORKFLOWS / "digest-send.yml"
DRAFT = WORKFLOWS / "roundup-draft.yml"
CI = WORKFLOWS / "deploy-lightsail.yml"


def _text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def test_preview_input_defaults_to_false():
    text = _text()
    assert "\n      preview:\n" in text
    block = "\n".join(text.split("\n      preview:\n", 1)[1].splitlines()[:4])
    assert "default: false" in block
    assert "type: boolean" in block


def test_preview_address_comes_from_the_secret_and_is_never_echoed():
    text = _text()
    assert "DIGEST_PREVIEW_TO: ${{ secrets.DIGEST_PREVIEW_TO }}" in text
    assert '--to "$DIGEST_PREVIEW_TO"' in text
    for line in text.splitlines():
        if line.strip().startswith("echo") and "$DIGEST_PREVIEW_TO" in line:
            raise AssertionError(f"address echoed: {line}")
    assert 'if [ -z "${DIGEST_PREVIEW_TO:-}" ]' in text


def test_preview_skips_the_autosend_gate_and_has_a_nonce():
    text = _text()
    assert '--preview-nonce "${DIGEST_PREVIEW_NONCE:-manual}"' in text
    assert (
        "DIGEST_PREVIEW_NONCE: ${{ github.run_id }}-${{ github.run_attempt }}"
        in text
    )
    # The gate lives only in the scheduled branch.
    gate = text.index('if [ "$AUTOSEND" != "1" ]')
    preview_branch = text.index('if [ "$DIGEST_PREVIEW" = "true" ]')
    assert gate < preview_branch


def test_no_script_stop_key():
    text = _text()
    assert re.search(r"^\s*script_stop:", text, re.MULTILINE) is None


def test_dispatch_inputs_carry_no_address():
    # Inputs show on the public run page; the address is never one of them.
    text = _text()
    inputs = text.split("    inputs:\n", 1)[1].split("\npermissions:", 1)[0]
    names = re.findall(r"^      ([a-z_]+):\s*$", inputs, re.MULTILINE)
    assert names == ["week", "dry_run", "preview"]
    # DIGEST_PREVIEW_TO is assigned exactly once, from the secret.
    assert re.findall(r"^\s*DIGEST_PREVIEW_TO:\s*(.+)$", text, re.MULTILINE) == [
        "${{ secrets.DIGEST_PREVIEW_TO }}"
    ]
    # Tracing would print the expanded --to argument into the log.
    assert re.search(r"set -[a-z]*x|xtrace", text) is None
    assert re.search(r"^\s*debug:\s*true", text, re.MULTILINE) is None


def test_approval_is_checked_before_any_preview_or_real_send():
    text = _text()
    precheck = text.index('if [ "$DIGEST_DRY_RUN" = "false" ]; then')
    fetch = text.index("fetch_roundup(week)")
    preview = text.index('if [ "$DIGEST_PREVIEW" = "true" ]; then')
    real_send = text.index('FLAG="--send"')
    assert precheck < fetch < preview < real_send
    # A preview is never a dry run, so the approval check always runs first.
    assert re.search(
        r'if \[ "\$preview" = "true" \]; then\n(?:\s*#.*\n)*\s*dry_run="false"\n\s*fi\n',
        text,
    )


def test_saturday_draft_never_allows_a_stale_reading():
    text = DRAFT.read_text(encoding="utf-8")
    assert 'npm run roundup:draft -- --week "$WEEK"' in text
    assert "--allow-stale" not in text


def test_ci_runs_the_send_safety_tests():
    ci = CI.read_text(encoding="utf-8")
    for name in (
        "tests/test_digest.py",
        "tests/test_digest_send_safety.py",
        "tests/test_digest_workflow.py",
    ):
        assert f"            {name} \\" in ci, name
    package = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    assert "scripts/roundup-draft.test.mjs" in package["scripts"]["test:unit"]
