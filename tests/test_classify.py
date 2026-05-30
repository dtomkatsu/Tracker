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


def test_unclassified():
    c = classify("Resolution honoring the retirement of John Smith.")
    assert c.subjects == []


def test_empty_input():
    c = classify(None)
    assert c.subjects == []
    assert c.confidence == 0.0
