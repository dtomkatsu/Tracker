from tracker.legislative.adapters.legistar_api import LegistarApiAdapter

SAMPLE_MATTER = {
    "MatterId": 16317,
    "MatterGuid": "AB173D31-CBAB-457F-AB15-030DD2A9886A",
    "MatterFile": "DRIP-9(11)",
    "MatterTitle": "SHORELINE EROSION IMPACTS ON COASTAL PROPERTIES (DRIP-9(11))",
    "MatterTypeName": "Rule 7(B)",
    "MatterStatusName": "Agenda Ready",
    "MatterBodyName": "Disaster Recovery Committee",
    "MatterIntroDate": "2026-05-25T00:00:00",
}


def test_uses_gateway_permalink_not_legislationdetail():
    """LegislationDetail.aspx?ID=&GUID= returns 'Invalid parameters!' on this
    tenant; the adapter must emit the working Gateway.aspx?M=L&ID= permalink."""
    adapter = LegistarApiAdapter(council_id="maui", tenant="mauicounty")
    bill = adapter._to_bill(SAMPLE_MATTER)
    assert bill.url == "https://mauicounty.legistar.com/Gateway.aspx?M=L&ID=16317"
    assert "LegislationDetail.aspx" not in bill.url


def test_matter_mapping_basics():
    adapter = LegistarApiAdapter(council_id="maui", tenant="mauicounty")
    bill = adapter._to_bill(SAMPLE_MATTER)
    assert bill.council == "maui"
    assert bill.bill_number == "DRIP-9(11)"
    assert bill.bill_type == "Rule 7(B)"
    assert bill.introduced_date == "2026-05-25"
    assert bill.status == "Agenda Ready"
