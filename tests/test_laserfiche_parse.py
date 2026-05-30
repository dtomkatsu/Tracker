from tracker.legislative.adapters.laserfiche import (
    HawaiiCountyAdapter,
    _iso_from_mdy,
    _norm_key,
)

META_BILL = {
    "Bill/Resolution - Type": "BIL",
    "Bill/Resolution - Council Term": "2024-2026",
    "Bill/Resolution": "148",
    "Draft": "01",
    "Introducer": "James E. Hustace, Council Member",
    "Referred To": "FC",
    "Action 1": "FC-100: Recommended passage on first reading - 4/1/2026",
    "Action 2": "Council: Bill 148 passes first reading - 4/15/26",
    "Action 3": "Council: Bill 148 passes second & final reading - 05/20/26",
    "Status": "Adopted",
    "Reading Date": "4/15/2026",
}


def test_norm_key_strips_leading_zeros():
    assert _norm_key("Bill", "001") == "Bill 1"
    assert _norm_key("Resolution", "0148") == "Resolution 148"


def test_iso_from_mdy():
    assert _iso_from_mdy("passes - 05/20/26") == "2026-05-20"
    assert _iso_from_mdy("nope") is None


def test_build_record_extracts_metadata():
    rec = HawaiiCountyAdapter()._build_record(META_BILL, doc_id="999")
    assert rec is not None
    assert rec.bill_number == "Bill 148"
    assert rec.bill_type == "Bill"
    assert rec.introducer == "James E. Hustace, Council Member"
    assert rec.status == "Adopted"
    # latest (highest-numbered) action wins
    assert "second & final reading" in rec.last_action
    assert rec.last_action_date == "2026-05-20"
    assert "DocView.aspx?id=999" in rec.url


def test_build_record_derives_status_from_action_when_blank():
    meta = dict(META_BILL)
    meta["Status"] = ""
    rec = HawaiiCountyAdapter()._build_record(meta, doc_id="1")
    assert rec.status == "Passed Second Reading"


def test_build_record_rejects_non_bill():
    assert HawaiiCountyAdapter()._build_record({"Bill/Resolution - Type": "FUND"}, "1") is None
