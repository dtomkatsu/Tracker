from tracker.legislative.classify import classify


def test_tax_classification():
    c = classify("RELATING TO REAL PROPERTY TAXATION.")
    assert "tax" in c.subjects


def test_transportation_classification():
    c = classify(
        "Relating to electric bicycles and bikeways on Oahu."
    )
    assert "transportation" in c.subjects


def test_affordable_housing_classification():
    c = classify(
        "Amending the comprehensive zoning ordinance to allow accessory dwelling units."
    )
    assert "affordable_housing" in c.subjects


def test_food_security_classification():
    c = classify(
        "Establishing a food bank coordination committee.",
        raw_subject="Hunger and nutrition policy",
    )
    assert "food_security" in c.subjects


def test_multi_label():
    c = classify(
        "BILL relating to TOD zoning near rail transit stations and inclusionary affordable housing."
    )
    assert "affordable_housing" in c.subjects
    assert "transportation" in c.subjects


def test_land_use_bills_tagged_housing():
    # Land-use / planning bills whose titles never say "housing" are the common
    # miss; the broadened keyword set should now catch them.
    for title in (
        "PROPOSING AN AMENDMENT TO CHAPTER 21 (THE LAND USE ORDINANCE).",
        "PROPOSING AN AMENDMENT TO CHAPTER 22 (THE SUBDIVISION ORDINANCE).",
        "RELATING TO SIGN STANDARDS FOR APARTMENT AND APARTMENT MIXED-USE DISTRICTS.",
        "ADOPTS THE COUNTY OF HAWAII GENERAL PLAN 2045.",
    ):
        assert "affordable_housing" in classify(title).subjects, title


def test_sma_single_family_permit_not_housing():
    # Coastal individual-permit bills say "single-family dwelling" but are not
    # housing policy — they must NOT be filed under affordable_housing on that
    # alone.
    c = classify(
        "GRANTING A SPECIAL MANAGEMENT AREA MAJOR PERMIT TO ALLOW FOR THE "
        "CONSTRUCTION OF A SINGLE-FAMILY DWELLING."
    )
    assert "affordable_housing" not in c.subjects


def test_sma_permit_still_housing_with_strong_term():
    # The SMA veto only suppresses the weak terms; an explicit housing term
    # still tags it.
    c = classify(
        "SPECIAL MANAGEMENT AREA PERMIT FOR AN AFFORDABLE HOUSING DEVELOPMENT."
    )
    assert "affordable_housing" in c.subjects


def test_unclassified():
    c = classify("Resolution honoring the retirement of John Smith.")
    assert c.subjects == []


def test_empty_input():
    c = classify(None)
    assert c.subjects == []
    assert c.confidence == 0.0
