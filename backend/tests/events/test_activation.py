from __future__ import annotations

import hashlib
import json
import os
import tarfile
import time
from datetime import timedelta
from pathlib import Path

import pytest
import requests

from astro_finance.events.activate import (
    ActivationError,
    activate_bundle,
    activation_status,
    rollback_bundle,
)
from astro_finance.events.bundle import count_matrix, write_dataset
from astro_finance.events.cli import main
from astro_finance.events.models import Theme
from astro_finance.events.release import (
    _download,
    expected_rows,
    parse_sha256sums,
    safe_extract,
    verify_bundle_dir,
)
from astro_finance.events.store import current_bundle_dir
from conftest import NOW, TODAY, build_event

VERSION_A = "a" * 16
VERSION_B = "b" * 16
VERSION_C = "c" * 16


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _events(count: int = 3):
    return [
        build_event(
            event_id=f"science:test:activation-{index}",
            name=f"Activation event {index}",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=index + 1),
        )
        for index in range(count)
    ]


def _make_release(
    tmp_path: Path, version: str, events, *, publishable: bool = True
) -> Path:
    source = tmp_path / f"source-{version}"
    write_dataset(source, events, today=TODAY)
    manifest = {
        "bundle_version": version,
        "schema_version": 1,
        "created_at": NOW.isoformat().replace("+00:00", "Z"),
        "as_of": TODAY.isoformat(),
        "counts": count_matrix(events),
        "files": {
            "events.json": _sha256(source / "events.json"),
            "events.sqlite": _sha256(source / "events.sqlite"),
        },
        "publishable": publishable,
        "theme_metadata": {},
    }
    (source / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )

    release = tmp_path / f"release-{version}"
    release.mkdir()
    tarball = release / f"events-bundle-{version}.tar.gz"
    with tarfile.open(tarball, "w:gz") as archive:
        for path in sorted(source.iterdir()):
            archive.add(path, arcname=path.name)
    manifest_path = release / "manifest.json"
    manifest_path.write_bytes((source / "manifest.json").read_bytes())
    sums = (
        f"{_sha256(tarball)}  {tarball.name}\n"
        f"{_sha256(manifest_path)}  manifest.json\n"
    )
    (release / "SHA256SUMS").write_text(sums, encoding="utf-8")
    return release


def _runtime(tmp_path: Path) -> Path:
    return tmp_path / "runtime"


class _FakeResponse:
    def __init__(self, status_code: int, body: bytes = b"") -> None:
        self.status_code = status_code
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def iter_content(self, chunk_size: int = 1024 * 1024):
        for start in range(0, len(self._body), chunk_size):
            yield self._body[start : start + chunk_size]


def test_activate_writes_the_runtime_relative_pointer(tmp_path):
    release = _make_release(tmp_path, VERSION_A, _events())
    runtime = _runtime(tmp_path)
    result = activate_bundle(
        version=VERSION_A, runtime_dir=runtime, release_dir=release
    )
    assert result.version == VERSION_A
    assert (runtime / "current").read_text("utf-8") == f"bundles/{VERSION_A}\n"
    assert not (runtime / "previous").exists()
    assert current_bundle_dir(runtime) == runtime / "bundles" / VERSION_A
    status = activation_status(runtime)
    assert status["active_version"] == VERSION_A
    assert status["active_bundle"] == str(runtime / "bundles" / VERSION_A)
    assert status["previous_version"] is None


def test_activation_is_idempotent_for_the_same_version(tmp_path):
    release = _make_release(tmp_path, VERSION_A, _events())
    runtime = _runtime(tmp_path)
    activate_bundle(version=VERSION_A, runtime_dir=runtime, release_dir=release)
    second = activate_bundle(
        version=VERSION_A, runtime_dir=runtime, release_dir=release
    )
    assert second.version == VERSION_A
    assert (runtime / "current").read_text("utf-8") == f"bundles/{VERSION_A}\n"


def test_second_activation_records_previous_and_rollback_swaps(tmp_path):
    runtime = _runtime(tmp_path)
    release_a = _make_release(tmp_path, VERSION_A, _events())
    release_b = _make_release(tmp_path, VERSION_B, _events(4))
    activate_bundle(version=VERSION_A, runtime_dir=runtime, release_dir=release_a)
    activate_bundle(version=VERSION_B, runtime_dir=runtime, release_dir=release_b)
    assert (runtime / "current").read_text("utf-8") == f"bundles/{VERSION_B}\n"
    assert (runtime / "previous").read_text("utf-8") == f"bundles/{VERSION_A}\n"

    rolled = rollback_bundle(runtime)
    assert rolled.to_version == VERSION_A
    assert (runtime / "current").read_text("utf-8") == f"bundles/{VERSION_A}\n"
    assert (runtime / "previous").read_text("utf-8") == f"bundles/{VERSION_B}\n"
    assert current_bundle_dir(runtime) == runtime / "bundles" / VERSION_A


def test_rollback_without_a_previous_bundle_fails(tmp_path):
    runtime = _runtime(tmp_path)
    with pytest.raises(ActivationError, match="no previous"):
        rollback_bundle(runtime)


def test_corrupted_tarball_is_rejected_and_previous_stays_active(tmp_path):
    runtime = _runtime(tmp_path)
    release_a = _make_release(tmp_path, VERSION_A, _events())
    release_b = _make_release(tmp_path, VERSION_B, _events(4))
    activate_bundle(version=VERSION_A, runtime_dir=runtime, release_dir=release_a)
    tarball = release_b / f"events-bundle-{VERSION_B}.tar.gz"
    data = bytearray(tarball.read_bytes())
    data[-1] ^= 0xFF
    tarball.write_bytes(bytes(data))
    with pytest.raises(ActivationError, match="checksum mismatch"):
        activate_bundle(version=VERSION_B, runtime_dir=runtime, release_dir=release_b)
    assert current_bundle_dir(runtime) == runtime / "bundles" / VERSION_A
    assert not (runtime / "current.tmp").exists()


def test_checksum_mismatch_is_rejected(tmp_path):
    runtime = _runtime(tmp_path)
    release = _make_release(tmp_path, VERSION_A, _events())
    (release / "SHA256SUMS").write_text(
        f"{'0' * 64}  events-bundle-{VERSION_A}.tar.gz\n", encoding="utf-8"
    )
    with pytest.raises(ActivationError, match="does not list|checksum"):
        activate_bundle(version=VERSION_A, runtime_dir=runtime, release_dir=release)
    assert not (runtime / "current").exists()


def test_non_publishable_bundle_is_refused(tmp_path):
    runtime = _runtime(tmp_path)
    release = _make_release(
        tmp_path, VERSION_A, _events(), publishable=False
    )
    with pytest.raises(ActivationError, match="non-publishable"):
        activate_bundle(version=VERSION_A, runtime_dir=runtime, release_dir=release)
    assert not (runtime / "current").exists()


def test_a_half_extracted_tmp_folder_is_replaced(tmp_path):
    runtime = _runtime(tmp_path)
    release = _make_release(tmp_path, VERSION_A, _events())
    half = runtime / "bundles" / f"{VERSION_A}.tmp"
    half.mkdir(parents=True)
    (half / "junk").write_text("partial", encoding="utf-8")
    result = activate_bundle(
        version=VERSION_A, runtime_dir=runtime, release_dir=release
    )
    assert result.version == VERSION_A
    assert not half.exists()
    assert (runtime / "bundles" / VERSION_A / "manifest.json").exists()


def test_pointer_failure_restores_the_previous_bundle(tmp_path, monkeypatch):
    runtime = _runtime(tmp_path)
    release_a = _make_release(tmp_path, VERSION_A, _events())
    release_b = _make_release(tmp_path, VERSION_B, _events(4))
    activate_bundle(version=VERSION_A, runtime_dir=runtime, release_dir=release_a)

    def explode(*args, **kwargs):
        raise RuntimeError("self-check injected failure")

    monkeypatch.setattr("astro_finance.events.activate.event_counts", explode)
    with pytest.raises(ActivationError, match="self-check"):
        activate_bundle(version=VERSION_B, runtime_dir=runtime, release_dir=release_b)
    assert (runtime / "current").read_text("utf-8") == f"bundles/{VERSION_A}\n"
    assert not (runtime / "current.tmp").exists()
    assert current_bundle_dir(runtime) == runtime / "bundles" / VERSION_A
    assert not (runtime / "bundles" / VERSION_B).exists()


def test_activation_prunes_to_the_three_newest_bundles(tmp_path):
    runtime = _runtime(tmp_path)
    bundles = runtime / "bundles"
    bundles.mkdir(parents=True)
    old_versions = ["old-1", "old-2", "old-3", "old-4"]
    base = time.time() - 10_000
    for index, version in enumerate(old_versions):
        path = bundles / version
        path.mkdir()
        os.utime(path, (base + index, base + index))
    release = _make_release(tmp_path, VERSION_C, _events())
    activate_bundle(version=VERSION_C, runtime_dir=runtime, release_dir=release)
    remaining = sorted(path.name for path in bundles.iterdir() if path.is_dir())
    assert VERSION_C in remaining
    assert len(remaining) == 3
    assert "old-1" not in remaining
    assert "old-2" not in remaining


def test_status_with_no_bundle_is_empty(tmp_path):
    status = activation_status(_runtime(tmp_path))
    assert status["active_version"] is None
    assert status["previous_version"] is None
    assert status["bundles"] == []


def test_sha256sums_parser_and_row_count(tmp_path):
    sums = tmp_path / "SHA256SUMS"
    sums.write_text(
        f"{'a' * 64}  events-bundle-x.tar.gz\n{'b' * 64}  manifest.json\n",
        encoding="utf-8",
    )
    assert parse_sha256sums(sums) == {
        "events-bundle-x.tar.gz": "a" * 64,
        "manifest.json": "b" * 64,
    }
    counts = {"Science": {"upcoming": {"scheduled": 2, "tentative": 1}}}
    assert expected_rows(counts) == 3
    with pytest.raises(ActivationError):
        expected_rows({"Science": {"upcoming": {"scheduled": -1}}})


def test_verify_bundle_dir_rejects_a_changed_file(tmp_path):
    version = VERSION_A
    release = _make_release(tmp_path, version, _events())
    runtime = _runtime(tmp_path)
    activate_bundle(version=version, runtime_dir=runtime, release_dir=release)
    bundle = runtime / "bundles" / version
    (bundle / "events.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ActivationError, match="checksum"):
        verify_bundle_dir(bundle, version)


def test_tar_path_traversal_is_rejected(tmp_path):
    import io

    tarball = tmp_path / "evil.tar.gz"
    with tarfile.open(tarball, "w:gz") as archive:
        info = tarfile.TarInfo("../escape.json")
        data = b"{}"
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
    destination = tmp_path / "extract"
    with pytest.raises(ActivationError, match="unsafe|escapes"):
        safe_extract(tarball, destination)
    assert not (tmp_path / "escape.json").exists()


def test_cli_activate_status_and_rollback(tmp_path, capsys):
    runtime = _runtime(tmp_path)
    release_a = _make_release(tmp_path, VERSION_A, _events())
    release_b = _make_release(tmp_path, VERSION_B, _events(4))
    assert main(
        [
            "activate",
            "--version",
            VERSION_A,
            "--runtime-dir",
            str(runtime),
            "--release-dir",
            str(release_a),
        ]
    ) == 0
    assert main(
        [
            "activate",
            "--version",
            VERSION_B,
            "--runtime-dir",
            str(runtime),
            "--release-dir",
            str(release_b),
        ]
    ) == 0
    capsys.readouterr()
    assert main(["status", "--runtime-dir", str(runtime), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["active_version"] == VERSION_B
    assert payload["previous_version"] == VERSION_A
    assert main(["rollback", "--runtime-dir", str(runtime)]) == 0
    assert current_bundle_dir(runtime) == runtime / "bundles" / VERSION_A


def test_cli_rollback_without_history_exits_one(tmp_path):
    assert main(["rollback", "--runtime-dir", str(_runtime(tmp_path))]) == 1


def test_failed_rollback_keeps_the_current_bundle_active(tmp_path):
    runtime = _runtime(tmp_path)
    release_a = _make_release(tmp_path, VERSION_A, _events())
    release_b = _make_release(tmp_path, VERSION_B, _events(4))
    activate_bundle(version=VERSION_A, runtime_dir=runtime, release_dir=release_a)
    activate_bundle(version=VERSION_B, runtime_dir=runtime, release_dir=release_b)
    (runtime / "bundles" / VERSION_A / "events.json").write_text(
        "{}", encoding="utf-8"
    )
    with pytest.raises(ActivationError, match="checksum"):
        rollback_bundle(runtime)
    assert (runtime / "current").read_text("utf-8") == f"bundles/{VERSION_B}\n"
    assert current_bundle_dir(runtime) == runtime / "bundles" / VERSION_B


def test_activation_retries_504_twice_then_succeeds(
    tmp_path, monkeypatch, caplog
):
    runtime = _runtime(tmp_path)
    release = _make_release(tmp_path, VERSION_A, _events())
    tarball_name = f"events-bundle-{VERSION_A}.tar.gz"
    tarball_tries = 0
    calls: list[str] = []
    sleeps: list[int] = []

    def fake_get(url, **kwargs):
        nonlocal tarball_tries
        name = url.rsplit("/", 1)[-1]
        calls.append(name)
        if name == tarball_name:
            tarball_tries += 1
            if tarball_tries <= 2:
                return _FakeResponse(504)
        return _FakeResponse(200, (release / name).read_bytes())

    monkeypatch.setattr("astro_finance.events.release.requests.get", fake_get)
    monkeypatch.setattr("astro_finance.events.release.time.sleep", sleeps.append)
    with caplog.at_level("WARNING", logger="astro_finance.events.release"):
        result = activate_bundle(version=VERSION_A, runtime_dir=runtime)

    assert result.version == VERSION_A
    assert current_bundle_dir(runtime) == runtime / "bundles" / VERSION_A
    assert tarball_tries == 3
    assert len(calls) == 5  # tarball, tarball, tarball, manifest, SHA256SUMS
    assert sleeps == [5, 15]
    assert "HTTP 504" in caplog.text
    assert tarball_name in caplog.text
    assert "attempt 1/4" in caplog.text
    assert "attempt 2/4" in caplog.text
    assert "https://" not in caplog.text


def test_activation_does_not_retry_http_404(tmp_path, monkeypatch):
    runtime = _runtime(tmp_path)
    calls: list[str] = []
    sleeps: list[int] = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return _FakeResponse(404)

    monkeypatch.setattr("astro_finance.events.release.requests.get", fake_get)
    monkeypatch.setattr("astro_finance.events.release.time.sleep", sleeps.append)

    with pytest.raises(ActivationError, match="HTTP 404"):
        activate_bundle(version=VERSION_A, runtime_dir=runtime)

    assert len(calls) == 1
    assert sleeps == []
    assert not (runtime / "current").exists()


def test_four_503s_fail_and_keep_the_previous_pointer(
    tmp_path, monkeypatch, caplog
):
    runtime = _runtime(tmp_path)
    release_a = _make_release(tmp_path, VERSION_A, _events())
    activate_bundle(version=VERSION_A, runtime_dir=runtime, release_dir=release_a)
    calls: list[str] = []
    sleeps: list[int] = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return _FakeResponse(503)

    monkeypatch.setattr("astro_finance.events.release.requests.get", fake_get)
    monkeypatch.setattr("astro_finance.events.release.time.sleep", sleeps.append)
    with caplog.at_level("WARNING", logger="astro_finance.events.release"):
        with pytest.raises(
            ActivationError, match="HTTP 503 after 4 attempts"
        ):
            activate_bundle(version=VERSION_B, runtime_dir=runtime)

    assert len(calls) == 4
    assert sleeps == [5, 15, 30]
    assert (runtime / "current").read_text("utf-8") == f"bundles/{VERSION_A}\n"
    assert current_bundle_dir(runtime) == runtime / "bundles" / VERSION_A
    assert not (runtime / "bundles" / VERSION_B).exists()
    assert "attempt 1/4" in caplog.text
    assert "attempt 3/4" in caplog.text
    assert "HTTP 503" in caplog.text


@pytest.mark.parametrize(
    "failure",
    [
        429,
        requests.ConnectionError("connection reset"),
        requests.Timeout("timed out"),
    ],
)
def test_download_retries_429_connections_and_timeouts(
    tmp_path, monkeypatch, failure
):
    destination = tmp_path / "asset.bin"
    calls: list[str] = []
    sleeps: list[int] = []

    def fake_get(url, **kwargs):
        calls.append(url)
        if len(calls) == 1:
            if isinstance(failure, int):
                return _FakeResponse(failure)
            raise failure
        return _FakeResponse(200, b"payload")

    monkeypatch.setattr("astro_finance.events.release.requests.get", fake_get)
    monkeypatch.setattr("astro_finance.events.release.time.sleep", sleeps.append)

    _download("https://example.test/asset", destination)

    assert destination.read_bytes() == b"payload"
    assert len(calls) == 2
    assert sleeps == [5]


def test_retry_then_checksum_mismatch_still_fails(tmp_path, monkeypatch):
    runtime = _runtime(tmp_path)
    release = _make_release(tmp_path, VERSION_A, _events())
    tarball_name = f"events-bundle-{VERSION_A}.tar.gz"
    tarball_tries = 0
    sleeps: list[int] = []

    def fake_get(url, **kwargs):
        nonlocal tarball_tries
        name = url.rsplit("/", 1)[-1]
        if name == tarball_name:
            tarball_tries += 1
            if tarball_tries == 1:
                return _FakeResponse(504)
            body = bytearray((release / name).read_bytes())
            body[-1] ^= 0xFF
            return _FakeResponse(200, bytes(body))
        return _FakeResponse(200, (release / name).read_bytes())

    monkeypatch.setattr("astro_finance.events.release.requests.get", fake_get)
    monkeypatch.setattr("astro_finance.events.release.time.sleep", sleeps.append)

    with pytest.raises(ActivationError, match="checksum mismatch"):
        activate_bundle(version=VERSION_A, runtime_dir=runtime)

    assert tarball_tries == 2
    assert sleeps == [5]
    assert not (runtime / "current").exists()
