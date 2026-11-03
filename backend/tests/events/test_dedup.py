from __future__ import annotations

from datetime import time, timedelta

from astro_finance.events.dedup import deduplicate
from astro_finance.events.models import (
    EventKind,
    Reliability,
    Theme,
    Verification,
)
from conftest import TODAY, build_event


def test_dedup_prefers_higher_source_reliability():
    high = build_event(
        event_id="science:high:event-2026",
        source_id="high",
        name="Same event",
        start_date=TODAY + timedelta(days=10),
    )
    low = build_event(
        event_id="science:low:event-2026",
        source_id="low",
        name="Same event",
        start_date=TODAY + timedelta(days=10),
        verification=Verification.UNVERIFIED,
    )
    result = deduplicate(
        [low, high],
        {"high": Reliability.HIGH, "low": Reliability.LOW},
    )
    assert [event.source_id for event in result.events] == ["high"]
    assert result.duplicates == 1
    assert result.dropped[0].source_id == "low"


def test_dedup_breaks_a_reliability_tie_by_verification():
    verified = build_event(
        event_id="science:one:event-2026",
        source_id="one",
        name="Same event",
        verification=Verification.VERIFIED,
    )
    curated = build_event(
        event_id="science:two:event-2026",
        source_id="two",
        name="Same event",
        verification=Verification.CURATED,
    )
    result = deduplicate(
        [curated, verified],
        {"one": Reliability.HIGH, "two": Reliability.HIGH},
    )
    assert [event.verification for event in result.events] == [Verification.VERIFIED]


def test_dedup_allows_one_day_for_all_day_events():
    first = build_event(
        event_id="science:one:event-2026",
        source_id="one",
        name="Same event",
        start_date=TODAY + timedelta(days=10),
    )
    second = build_event(
        event_id="science:two:event-2026",
        source_id="two",
        name="Same event",
        start_date=TODAY + timedelta(days=11),
        verification=Verification.CURATED,
    )
    result = deduplicate(
        [first, second],
        {"one": Reliability.HIGH, "two": Reliability.MEDIUM},
    )
    assert len(result.events) == 1
    assert result.events[0].start_date == first.start_date


def test_dedup_does_not_use_the_window_for_timed_events():
    first = build_event(
        event_id="science:one:event-2026",
        source_id="one",
        name="Same event",
        start_date=TODAY + timedelta(days=10),
        all_day=False,
        start_time=time(9, 0),
        timezone_name="UTC",
    )
    second = build_event(
        event_id="science:two:event-2026",
        source_id="two",
        name="Same event",
        start_date=TODAY + timedelta(days=11),
        all_day=False,
        start_time=time(9, 0),
        timezone_name="UTC",
    )
    result = deduplicate(
        [first, second],
        {"one": Reliability.HIGH, "two": Reliability.HIGH},
    )
    assert len(result.events) == 2


def test_dedup_keeps_historical_over_upcoming():
    historical = build_event(
        event_id="culture-religion:hist:event-2022",
        source_id="hist",
        name="Same event",
        theme=Theme.CULTURE_RELIGION,
        kind=EventKind.HISTORICAL,
        start_date=TODAY - timedelta(days=500),
    )
    upcoming = build_event(
        event_id="culture-religion:cur:event-2022",
        source_id="cur",
        name="Same event",
        theme=Theme.CULTURE_RELIGION,
        start_date=TODAY - timedelta(days=500),
        verification=Verification.VERIFIED,
    )
    result = deduplicate(
        [upcoming, historical],
        {"hist": Reliability.HIGH, "cur": Reliability.HIGH},
    )
    assert len(result.events) == 1
    assert result.events[0].kind is EventKind.HISTORICAL


def test_dedup_does_not_merge_different_themes():
    science = build_event(
        event_id="science:one:event-2026",
        source_id="one",
        name="Same event",
        theme=Theme.SCIENCE,
    )
    finance = build_event(
        event_id="finance:two:event-2026",
        source_id="two",
        name="Same event",
        theme=Theme.FINANCE,
    )
    result = deduplicate(
        [science, finance],
        {"one": Reliability.HIGH, "two": Reliability.HIGH},
    )
    assert len(result.events) == 2


def test_dedup_counts_multiple_dropped_records():
    winner = build_event(
        event_id="science:a:event-2026", source_id="a", name="Same event"
    )
    losers = [
        build_event(
            event_id=f"science:{name}:event-2026",
            source_id=name,
            name="Same event",
            verification=Verification.UNVERIFIED,
        )
        for name in ("b", "c")
    ]
    result = deduplicate(
        [winner, *losers],
        {"a": Reliability.HIGH, "b": Reliability.LOW, "c": Reliability.LOW},
    )
    assert result.duplicates == 2
    assert len(result.events) == 1


def test_dedup_drops_a_duplicate_event_id_even_with_different_names():
    first = build_event(
        event_id="science:same:event-2026", source_id="a", name="First"
    )
    second = build_event(
        event_id="science:same:event-2026", source_id="b", name="Second"
    )
    result = deduplicate(
        [first, second],
        {"a": Reliability.HIGH, "b": Reliability.HIGH},
    )
    assert len(result.events) == 1
    assert result.duplicates == 1
