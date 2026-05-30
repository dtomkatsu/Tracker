from tracker.legislative.adapters.honolulu import HonoluluAdapter

SAMPLE_ROW = {
    "id": 3752,
    "displayNumber": "BILL040(26)",
    "number": 40,
    "year": 2026,
    "type": "BILL",
    "title": "RELATING TO REAL PROPERTY TAXATION.",
    "summary": "Temporarily entitles owners of certain condominium units to an exemption.",
    "introducers": "TYLER DOS SANTOS-TAM",
    "dateIntroduced": 1779962400000,
    "lastEventType": "INTRO",
    "lastEventDescription": "Introduced.",
    "lastEventDate": {"year": 2026, "monthValue": 5, "dayOfMonth": 28},
}


def test_uses_public_measure_url_not_browse():
    """The /measure/browse/{id} route 403s for authenticated eHawaii users;
    the adapter must emit the public /measure/{id} route."""
    bill = HonoluluAdapter()._row_to_bill(SAMPLE_ROW)
    assert bill.url == "https://hnldoc.ehawaii.gov/hnldoc/measure/3752"
    assert "/browse/" not in bill.url


def test_row_mapping_basics():
    bill = HonoluluAdapter()._row_to_bill(SAMPLE_ROW)
    assert bill.council == "honolulu"
    assert bill.bill_number == "BILL040(26)"
    assert bill.bill_type == "Bill"
    assert bill.introduced_date == "2026-05-28"
    assert bill.last_action_date == "2026-05-28"
