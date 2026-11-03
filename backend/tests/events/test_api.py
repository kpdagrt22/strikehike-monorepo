from __future__ import annotations

import json
from datetime import time, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astro_finance.events.bundle import write_dataset
from astro_finance.events.models import EventStatus, Theme
from astro_finance.events.router import get_today, router
from astro_finance.events.store import current_bundle_dir
from conftest import TODAY, build_event


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_today] = lambda: TODAY
    return TestClient(app)


def _make_runtime(tmp_path: Path, events) -> Path:
    runtime = tmp_path / "runtime"
    bundle = runtime / "bundles" / "2026-11-03-test"
    artifact = write_dataset(bundle, events, today=TODAY)
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "bundle_version": "testbundle000001",
                "schema_version": 1,
                "created_at": "2026-11-03T00:00:00Z",
                "as_of": TODAY.isoformat(),
                "counts": {},
                "publishable": True,
                "files": {},
            }
        ),
        encoding="utf-8",
    )
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / "current").write_text("bundles/2026-11-03-test\n", encoding="utf-8")
    return runtime


def _events():
    return [
        build_event(
            event_id="finance:test:one",
            name="Finance one",
            theme=Theme.FINANCE,
            start_date=TODAY + timedelta(days=1),
        ),
        build_event(
            event_id="science:test:seven",
            name="Science seven",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=7),
        ),
        build_event(
            event_id="science:test:one",
            name="Science one",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=1),
            all_day=False,
            start_time=time(9, 0),
            timezone_name="UTC",
        ),
        build_event(
            event_id="science:test:two",
            name="Science two",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=1),
            all_day=False,
            start_time=time(10, 0),
            timezone_name="UTC",
        ),
        build_event(
            event_id="science:test:three",
            name="Science three",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=2),
        ),
        build_event(
            event_id="science:test:four",
            name="Science four",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=3),
        ),
        build_event(
            event_id="science:test:five",
            name="Science five",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=4),
        ),
        build_event(
            event_id="science:test:six",
            name="Science six",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=5),
        ),
        build_event(
            event_id="culture:test:one",
            name="Culture one",
            theme=Theme.CULTURE_RELIGION,
            start_date=TODAY + timedelta(days=10),
            status=EventStatus.TENTATIVE,
        ),
        build_event(
            event_id="politics:test:cancelled",
            name="Cancelled politics",
            theme=Theme.POLITICS,
            start_date=TODAY + timedelta(days=2),
            status=EventStatus.CANCELLED,
        ),
        build_event(
            event_id="natural-disasters:test:one",
            name="Unschedulable",
            theme=Theme.NATURAL_DISASTERS,
            start_date=TODAY + timedelta(days=3),
        ),
        build_event(
            event_id="science:test:past",
            name="Past",
            theme=Theme.SCIENCE,
            start_date=TODAY - timedelta(days=1),
        ),
        build_event(
            event_id="science:test:completed",
            name="Completed",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=2),
            status=EventStatus.COMPLETED,
        ),
        build_event(
            event_id="science:test:unverified",
            name="Unverified",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=2),
            status=EventStatus.UNVERIFIED,
        ),
    ]


def test_upcoming_returns_five_per_theme_and_totals(client, tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(_make_runtime(tmp_path, _events())))
    response = client.get("/api/v1/events/upcoming")
    assert response.status_code == 200
    assert response.headers["cache-control"] == (
        "public, s-maxage=3600, stale-while-revalidate=86400"
    )
    payload = response.json()
    assert payload["bundle_version"] == "testbundle000001"
    assert payload["as_of"] == TODAY.isoformat()
    assert set(payload["themes"]) == {theme.value for theme in Theme}

    science = payload["themes"]["Science"]
    assert science["schedulable"] is True
    assert science["total_available"] == 7
    assert len(science["events"]) == 5
    assert [event["event_id"] for event in science["events"][:3]] == [
        "science:test:one",
        "science:test:two",
        "science:test:three",
    ]


def test_upcoming_excludes_past_cancelled_completed_and_unverified(client, tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(_make_runtime(tmp_path, _events())))
    payload = client.get("/api/v1/events/upcoming").json()
    ids = {
        event["event_id"]
        for theme in payload["themes"].values()
        for event in theme["events"]
    }
    assert "science:test:past" not in ids
    assert "science:test:completed" not in ids
    assert "science:test:unverified" not in ids
    assert "politics:test:cancelled" not in ids


def test_natural_disasters_is_not_schedulable(client, tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(_make_runtime(tmp_path, _events())))
    payload = client.get("/api/v1/events/upcoming").json()
    assert payload["themes"]["Natural Disasters"]["schedulable"] is False
    assert payload["themes"]["Natural Disasters"]["total_available"] == 0
    assert payload["themes"]["Natural Disasters"]["events"] == []


def test_theme_filter_and_limit(client, tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(_make_runtime(tmp_path, _events())))
    payload = client.get(
        "/api/v1/events/upcoming?themes=Finance,Science&limit_per_theme=1"
    ).json()
    assert list(payload["themes"]) == ["Science", "Finance"]
    assert len(payload["themes"]["Science"]["events"]) == 1
    assert payload["themes"]["Science"]["total_available"] == 7
    assert payload["themes"]["Finance"]["total_available"] == 1


def test_horizon_excludes_later_events(client, tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(_make_runtime(tmp_path, _events())))
    payload = client.get(
        "/api/v1/events/upcoming?themes=Culture/Religion&horizon_days=5"
    ).json()
    assert payload["themes"]["Culture/Religion"]["total_available"] == 0
    assert payload["themes"]["Culture/Religion"]["events"] == []


def test_unknown_theme_and_out_of_range_params_are_422(client, tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(_make_runtime(tmp_path, _events())))
    assert client.get("/api/v1/events/upcoming?themes=Astrology").status_code == 422
    assert client.get("/api/v1/events/upcoming?limit_per_theme=0").status_code == 422
    assert client.get("/api/v1/events/upcoming?limit_per_theme=21").status_code == 422
    assert client.get("/api/v1/events/upcoming?horizon_days=0").status_code == 422
    assert client.get("/api/v1/events/upcoming?horizon_days=731").status_code == 422


def test_missing_bundle_returns_the_five_themes_and_a_message(client, tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(tmp_path / "empty"))
    payload = client.get("/api/v1/events/upcoming").json()
    assert payload["bundle_version"] is None
    assert "No active events bundle" in payload["message"]
    assert set(payload["themes"]) == {theme.value for theme in Theme}
    assert all(theme["events"] == [] for theme in payload["themes"].values())


def test_health_with_bundle(client, tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(_make_runtime(tmp_path, _events())))
    payload = client.get("/api/v1/events/health").json()
    assert payload["active_version"] == "testbundle000001"
    assert payload["created_at"] == "2026-11-03T00:00:00Z"
    assert payload["schema_version"] == 1
    assert payload["counts"]["total"] == len(_events())


def test_health_without_bundle(client, tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(tmp_path / "empty-health"))
    payload = client.get("/api/v1/events/health").json()
    assert payload["active_version"] is None
    assert payload["counts"]["total"] == 0
    assert "No active events bundle" in payload["message"]


def test_current_bundle_dir_resolves_relative_pointer(tmp_path):
    runtime = _make_runtime(tmp_path, _events())
    assert current_bundle_dir(runtime) == runtime / "bundles" / "2026-11-03-test"
