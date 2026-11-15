"""The dispatch shape of digest-send.yml: the preview address never reaches a log.

The repository is public, so workflow inputs and logs are public. The preview
address comes from a repository secret and is only expanded into the remote
command, never echoed.
"""

from __future__ import annotations

import re
from pathlib import Path

WORKFLOW = (
    Path(__file__).resolve().parents[2]
    / ".github"
    / "workflows"
    / "digest-send.yml"
)


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
