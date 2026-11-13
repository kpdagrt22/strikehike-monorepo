"""Culture/Religion calculations and the curated-entry schema.

References used here:
* Hong Kong Observatory, Gregorian-Lunar Calendar Conversion Table:
  https://www.hko.gov.hk/en/gts/time/conversion.htm
* Hebcal, Hebrew calendar and holiday dates:
  https://www.hebcal.com/
* Government of India, DoPT Office Memorandum, holidays for 2027:
  https://documents.doptcirculars.nic.in/D2/D02est/Holiday%20list%202027Cj0HU.PDF
* Umm al-Qura calendar, Saudi Arabia:
  https://www.ummulqura.org.sa/
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from astro_finance.events.models import SourceKind, Theme
from astro_finance.events.sources import curated
from astro_finance.events.sources.culture import (
    chinese_new_year,
    christmas,
    extract,
    orthodox_easter,
    passover,
    rosh_hashanah,
    western_easter,
)
from conftest import NOW, TODAY, build_source

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "events"

HKO_CHINESE_NEW_YEAR = {
    2000: "2000-02-05",
    2001: "2001-01-24",
    2002: "2002-02-12",
    2003: "2003-02-01",
    2004: "2004-01-22",
    2005: "2005-02-09",
    2006: "2006-01-29",
    2007: "2007-02-18",
    2008: "2008-02-07",
    2009: "2009-01-26",
    2010: "2010-02-14",
    2011: "2011-02-03",
    2012: "2012-01-23",
    2013: "2013-02-10",
    2014: "2014-01-31",
    2015: "2015-02-19",
    2016: "2016-02-08",
    2017: "2017-01-28",
    2018: "2018-02-16",
    2019: "2019-02-05",
    2020: "2020-01-25",
    2021: "2021-02-12",
    2022: "2022-02-01",
    2023: "2023-01-22",
    2024: "2024-02-10",
    2025: "2025-01-29",
    2026: "2026-02-17",
    2027: "2027-02-06",
    2028: "2028-01-26",
    2029: "2029-02-13",
    2030: "2030-02-03",
    2031: "2031-01-23",
    2032: "2032-02-11",
    2033: "2033-01-31",
    2034: "2034-02-19",
    2035: "2035-02-08",
}

HEBCAL_DATES = {
    2000: ("2000-09-30", "2000-04-20"),
    2001: ("2001-09-18", "2001-04-08"),
    2002: ("2002-09-07", "2002-03-28"),
    2003: ("2003-09-27", "2003-04-17"),
    2004: ("2004-09-16", "2004-04-06"),
    2005: ("2005-10-04", "2005-04-24"),
    2006: ("2006-09-23", "2006-04-13"),
    2007: ("2007-09-13", "2007-04-03"),
    2008: ("2008-09-30", "2008-04-20"),
    2009: ("2009-09-19", "2009-04-09"),
    2010: ("2010-09-09", "2010-03-30"),
    2011: ("2011-09-29", "2011-04-19"),
    2012: ("2012-09-17", "2012-04-07"),
    2013: ("2013-09-05", "2013-03-26"),
    2014: ("2014-09-25", "2014-04-15"),
    2015: ("2015-09-14", "2015-04-04"),
    2016: ("2016-10-03", "2016-04-23"),
    2017: ("2017-09-21", "2017-04-11"),
    2018: ("2018-09-10", "2018-03-31"),
    2019: ("2019-09-30", "2019-04-20"),
    2020: ("2020-09-19", "2020-04-09"),
    2021: ("2021-09-07", "2021-03-28"),
    2022: ("2022-09-26", "2022-04-16"),
    2023: ("2023-09-16", "2023-04-06"),
    2024: ("2024-10-03", "2024-04-23"),
    2025: ("2025-09-23", "2025-04-13"),
    2026: ("2026-09-12", "2026-04-02"),
    2027: ("2027-10-02", "2027-04-22"),
    2028: ("2028-09-21", "2028-04-11"),
    2029: ("2029-09-10", "2029-03-31"),
    2030: ("2030-09-28", "2030-04-18"),
    2031: ("2031-09-18", "2031-04-08"),
    2032: ("2032-09-06", "2032-03-27"),
    2033: ("2033-09-24", "2033-04-14"),
    2034: ("2034-09-14", "2034-04-04"),
    2035: ("2035-10-04", "2035-04-24"),
}


def test_chinese_new_year_matches_hko_2000_to_2035():
    for year, expected in HKO_CHINESE_NEW_YEAR.items():
        assert chinese_new_year(year).isoformat() == expected, year


def test_rosh_hashanah_and_passover_match_hebcal_2000_to_2035():
    for year, (rosh, pesach) in HEBCAL_DATES.items():
        assert rosh_hashanah(year).isoformat() == rosh, year
        assert passover(year).isoformat() == pesach, year


def test_easter_and_christmas_are_fixed():
    assert western_easter(2027) == date(2027, 3, 28)
    assert orthodox_easter(2027) == date(2027, 5, 2)
    assert christmas(2026) == date(2026, 12, 25)
    assert christmas(2027) == date(2027, 12, 25)


def test_computed_culture_extract_always_carries_upcoming_dates():
    source = build_source(
        source_id="culture_computed",
        themes=(Theme.CULTURE_RELIGION,),
        kind=SourceKind.COMPUTED,
        url="https://www.churchofengland.org/",
    )
    extraction = extract(source, today=TODAY, now=NOW)
    names = {record.name for record in extraction.records}
    assert "Christmas 2026" in names
    assert "Chinese New Year 2027" in names
    assert "Rosh Hashanah 2027" in names
    assert "Passover 2027" in names
    assert "Western Easter 2027" in names
    assert "Orthodox Easter 2027" in names
    for record in extraction.records:
        assert record.theme == "Culture/Religion"
        assert record.verification == "computed"
        assert record.all_day is True
        assert TODAY <= date.fromisoformat(record.start_date) <= TODAY.replace(
            year=TODAY.year + 1
        )


def test_curated_culture_entries_are_official_and_not_extrapolated():
    source = build_source(
        source_id="curated_upcoming",
        themes=(Theme.CULTURE_RELIGION,),
        kind=SourceKind.CURATED,
        url="https://github.com/kpdagrt22/strikehike-monorepo/tree/main/backend/data/events/curated",
    )
    extraction = curated.extract(
        source, today=date(2026, 11, 13), now=NOW, data_dir=DATA_DIR
    )
    assert {record.name for record in extraction.records} == {
        "Holi 2027",
        "Diwali 2027",
        "Eid al-Fitr 2027",
        "Eid al-Adha 2027",
    }
    assert {record.start_date[:4] for record in extraction.records} == {"2027"}
    for record in extraction.records:
        assert record.verification == "curated"
        assert record.source_url.startswith("https://")
        assert record.all_day is True
        assert record.status == "scheduled"
    eid = {
        record.name: record.description
        for record in extraction.records
        if record.name.startswith("Eid")
    }
    assert eid == {
        "Eid al-Fitr 2027": "expected date; may shift by a day with moon sighting",
        "Eid al-Adha 2027": "expected date; may shift by a day with moon sighting",
    }


def test_curated_entry_without_source_url_is_rejected(tmp_path):
    directory = tmp_path / "curated"
    directory.mkdir()
    (directory / "bad.toml").write_text(
        '[[events]]\ntheme = "Culture/Religion"\nname = "Bad entry"\n'
        'date = "2027-01-01"\nverified_on = "2026-11-13"\nstatus = "scheduled"\n',
        encoding="utf-8",
    )
    source = build_source(
        source_id="curated_upcoming",
        themes=(Theme.CULTURE_RELIGION,),
        kind=SourceKind.CURATED,
    )
    extraction = curated.extract(
        source, today=date(2026, 11, 13), now=NOW, data_dir=tmp_path
    )
    assert extraction.records == ()
    assert extraction.rejects
    assert "source_url" in extraction.rejects[0].reasons[0]
