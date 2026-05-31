from tracker.legislative.adapters.granicus import GranicusAdapter, _looks_like_title


def test_looks_like_title_filters_cross_references():
    assert not _looks_like_title("4.")
    assert not _looks_like_title(", and")
    assert not _looks_like_title("E.")
    assert _looks_like_title("A BILL FOR AN ORDINANCE AMENDING CHAPTER 5A, KAUAI COUNTY CODE")
    assert _looks_like_title("RESOLUTION ESTABLISHING THE REAL PROPERTY TAX RATES FOR THE FISCAL YEAR")


def test_parse_agenda_extracts_titled_bills_only():
    adapter = GranicusAdapter("kauai", "kauai.granicus.com", [2], mode="html")
    agenda = (
        "BILLS FOR SECOND READING "
        "Bill 2995 A BILL FOR AN ORDINANCE AMENDING CHAPTER 5A, KAUAI COUNTY CODE 1987, "
        "RELATING TO REAL PROPERTY TAXES. "
        "Bill 2996 A BILL FOR AN ORDINANCE AMENDING CHAPTER 17 RELATING TO TRANSPORTATION AND BUSES. "
        "The council also discussed Bill 2995 and Bill 2996 during testimony."
    )
    recs = adapter._parse_agenda(agenda, "2026-05-27", "http://x/agenda")
    nums = {r["bill_number"]: r for r in recs}
    assert "Bill 2995" in nums and "Bill 2996" in nums
    assert "REAL PROPERTY TAXES" in nums["Bill 2995"]["title"]
    assert "TRANSPORTATION" in nums["Bill 2996"]["title"]
    # cross-reference mention ("discussed Bill 2995 and Bill 2996") must not
    # overwrite with junk — titles stay intact
    assert nums["Bill 2995"]["title"].startswith("A BILL FOR AN ORDINANCE")


def test_parse_agenda_skips_bare_number_mentions():
    adapter = GranicusAdapter("kauai", "kauai.granicus.com", [2], mode="html")
    agenda = "Minutes approved. Bill 2987, Bill 2988, and Bill 2990 were referred to committee."
    recs = adapter._parse_agenda(agenda, "2026-05-27", "http://x/agenda")
    assert recs == []  # no real titles → nothing extracted


def test_clean_agenda_title_strips_bleed():
    from tracker.legislative.adapters.granicus import _clean_agenda_title
    raw = ("A BILL FOR AN ORDINANCE AMENDING CHAPTER 5A, RELATING TO REAL PROPERTY "
           "TAX (Long- Term Affordable Rental Requirements) (Public Hearing held on "
           "May 20, 2026) 10. B. COMMITTEE OF THE WHOLE C. EXECUTIVE SESSION")
    out = _clean_agenda_title(raw)
    assert out.endswith("(Long-Term Affordable Rental Requirements)")  # hyphen rejoined, bleed gone
    assert "Public Hearing" not in out
    assert "COMMITTEE OF THE WHOLE" not in out
    assert "EXECUTIVE SESSION" not in out
