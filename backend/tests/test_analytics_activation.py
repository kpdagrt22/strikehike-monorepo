from __future__ import annotations

from astro_finance.events.activate import prune_bundles


def test_bundle_pruning_never_touches_runtime_analytics(tmp_path):
    runtime = tmp_path / "runtime"
    analytics = runtime / "analytics" / "analytics.sqlite"
    analytics.parent.mkdir(parents=True)
    analytics.write_bytes(b"analytics")

    bundles = runtime / "bundles"
    bundles.mkdir(parents=True)
    for index in range(5):
        folder = bundles / f"bundle-{index}"
        folder.mkdir()
        (folder / "manifest.json").write_text("{}", encoding="utf-8")
        (folder / "events.sqlite").write_bytes(b"")

    removed = prune_bundles(runtime, active=bundles / "bundle-4")
    assert removed
    assert analytics.read_bytes() == b"analytics"
    assert (bundles / "bundle-4").is_dir()
    assert len(list(bundles.iterdir())) == 3
