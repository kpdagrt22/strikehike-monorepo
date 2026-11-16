"""The events-weekly publish step: idempotent per version, never partial.

scripts/publish_events_release.sh runs against a fake ``gh`` that keeps its
releases in a temporary directory, so these tests need bash but no network.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
import tarfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "publish_events_release.sh"
VERSION = "0123456789abcdef"

pytestmark = pytest.mark.skipif(
    os.name == "nt" or shutil.which("bash") is None or shutil.which("sha256sum") is None,
    reason="the publish script runs on the Linux runner",
)

FAKE_GH = r"""#!/usr/bin/env bash
state="$FAKE_GH_STATE"
mkdir -p "$state/releases" "$state/uploads"
echo "$*" >> "$state/calls.log"
if [ "$1 $2" = "release view" ]; then
  if [ -f "$state/releases/$3" ]; then
    cat "$state/releases/$3"
    exit 0
  fi
  echo "release not found" >&2
  exit 1
fi
if [ "$1 $2" = "release create" ]; then
  tag="$3"
  shift 3
  names=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --title|--notes) shift 2 ;;
      *)
        [ -f "$1" ] || { echo "missing asset $1" >&2; exit 1; }
        cp "$1" "$state/uploads/"
        names+=("$(basename "$1")")
        shift
        ;;
    esac
  done
  (IFS=,; printf 'false\t%s\n' "${names[*]}") > "$state/releases/$tag"
  exit 0
fi
echo "unexpected gh call: $*" >&2
exit 2
"""


@pytest.fixture
def fake_gh(tmp_path: Path) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    gh = bin_dir / "gh"
    gh.write_text(FAKE_GH, encoding="utf-8", newline="\n")
    gh.chmod(gh.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return tmp_path / "gh-state"


def _bundle(tmp_path: Path, *, version: str = VERSION, publishable=True) -> Path:
    bundle = tmp_path / "events-bundle" / "bundle"
    bundle.mkdir(parents=True)
    (bundle / "events.json").write_text('{"events": []}\n', encoding="utf-8")
    (bundle / "manifest.json").write_text(
        json.dumps({"bundle_version": version, "publishable": publishable}),
        encoding="utf-8",
    )
    return bundle


def _publish(tmp_path: Path, state: Path, bundle: Path, version: str = VERSION):
    env = {
        **os.environ,
        "PATH": f"{tmp_path / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}",
        "FAKE_GH_STATE": str(state),
        "VERSION": version,
        "BUNDLE_DIR": str(bundle),
        "WORK_DIR": str(tmp_path / "work"),
    }
    return subprocess.run(
        ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, check=False
    )


def _creates(state: Path) -> list[str]:
    log = state / "calls.log"
    if not log.exists():
        return []
    return [
        line
        for line in log.read_text("utf-8").splitlines()
        if line.startswith("release create")
    ]


def test_first_publish_creates_the_release_with_three_verified_assets(tmp_path, fake_gh):
    bundle = _bundle(tmp_path)
    result = _publish(tmp_path, fake_gh, bundle)
    assert result.returncode == 0, result.stderr
    assert f"Published events-bundle-{VERSION}." in result.stdout
    assert len(_creates(fake_gh)) == 1

    uploads = fake_gh / "uploads"
    tarball = uploads / f"events-bundle-{VERSION}.tar.gz"
    assert sorted(path.name for path in uploads.iterdir()) == sorted(
        [tarball.name, "manifest.json", "SHA256SUMS"]
    )
    sums = dict(
        reversed(line.split("  ", 1))
        for line in (uploads / "SHA256SUMS").read_text("utf-8").splitlines()
    )
    for name in (tarball.name, "manifest.json"):
        assert sums[name] == hashlib.sha256((uploads / name).read_bytes()).hexdigest()
    with tarfile.open(tarball) as archive:
        assert {"./manifest.json", "./events.json"} <= set(archive.getnames())


def test_a_second_publish_of_the_same_week_skips_without_creating(tmp_path, fake_gh):
    bundle = _bundle(tmp_path)
    assert _publish(tmp_path, fake_gh, bundle).returncode == 0
    second = _publish(tmp_path, fake_gh, bundle)
    assert second.returncode == 0, second.stderr
    assert "already exists with all three assets; skipping" in second.stdout
    assert len(_creates(fake_gh)) == 1


@pytest.mark.parametrize(
    "existing",
    [
        f"true\tevents-bundle-{VERSION}.tar.gz,manifest.json,SHA256SUMS\n",
        "false\tmanifest.json\n",
    ],
    ids=["draft", "missing-assets"],
)
def test_a_partial_release_fails_instead_of_being_skipped(tmp_path, fake_gh, existing):
    (fake_gh / "releases").mkdir(parents=True)
    (fake_gh / "releases" / f"events-bundle-{VERSION}").write_text(
        existing, encoding="utf-8"
    )
    result = _publish(tmp_path, fake_gh, _bundle(tmp_path))
    assert result.returncode == 1
    assert "exists but is incomplete" in result.stdout
    assert _creates(fake_gh) == []


@pytest.mark.parametrize(
    "manifest_version, publishable, message",
    [
        (VERSION, False, "not publishable"),
        ("fedcba9876543210", True, "is not '0123456789abcdef'"),
    ],
    ids=["unpublishable", "version-mismatch"],
)
def test_the_script_refuses_a_manifest_the_gates_did_not_pass(
    tmp_path, fake_gh, manifest_version, publishable, message
):
    bundle = _bundle(tmp_path, version=manifest_version, publishable=publishable)
    result = _publish(tmp_path, fake_gh, bundle)
    assert result.returncode != 0
    assert message in result.stderr
    assert not (fake_gh / "calls.log").exists()
