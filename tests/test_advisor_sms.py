import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import advisor  # noqa: E402
import sms_service as sms  # noqa: E402

P = ROOT / "data" / "processed"
crops = pd.read_csv(P / "indicators_crop.csv")
sow = pd.read_csv(P / "sowing_month_district.csv")


def test_checks_cover_every_stage_and_label_everything_preliminary():
    for lvl in ("watch", "warning", "wet"):
        for st in advisor.STAGES:
            c = advisor.checks(lvl, st)
            assert c and all(x["status"] == advisor.PRELIM and x["action"] and x["why"] for x in c)
    assert advisor.checks("none", "Growing") == [] and advisor.checks("unknown", "Growing") == []
    with pytest.raises(ValueError):
        advisor.checks("watch", "flowering")


def test_checks_never_tell_farmer_to_switch_crops_or_claim_damage():
    text = " ".join(x["action"] + x["why"] for lvl in ("watch", "warning", "wet") for st in advisor.STAGES
                    for x in advisor.checks(lvl, st)).lower()
    for banned in ("switch", "plant soy", "plant bean", "instead of maize", "will fail", "yield loss", "crop failure"):
        assert banned not in text


def test_crop_evidence_never_recommends_and_uses_own_national_yield():
    ev = advisor.crop_evidence(crops, sow, "Musanze", "A", planned="Maize")
    assert not ev.empty and (ev.verdict == advisor.REVIEW).all()
    assert ev.loc[ev.crop == "Maize", "planned"].all() and not ev.loc[ev.crop != "Maize", "planned"].any()
    small = ev[~ev.enough_area]
    assert small.note.str.contains("Too little").all()


def test_usual_sowing_text():
    assert "Sep" in advisor.usual_sowing(sow, "Gatsibo", "A")
    assert advisor.usual_sowing(sow, "Nowhere", "A") == "unknown"


def test_sms_length_info():
    assert sms.length_info("x" * 160)["segments"] == 1 and sms.length_info("x" * 161)["segments"] == 2
    assert sms.length_info("x" * 307)["ok"] is False and sms.length_info("")["segments"] == 0


def test_sms_validation_requires_consent_group_and_reviewed_kinyarwanda():
    g = sms.GROUPS[0]
    assert sms.validate("hello", g, True) == []
    assert any("consent" in e for e in sms.validate("hello", g, False))
    assert any("group" in e for e in sms.validate("hello", "everyone", True))
    assert any("empty" in e for e in sms.validate(" ", g, True))
    assert any("Kinyarwanda" in e for e in sms.validate("hello", g, True, kinyarwanda_reviewed=False, lang="rw"))


def test_simulation_never_reports_delivery_and_history_has_no_phone_numbers():
    r = sms.get_provider().send("hello", sms.GROUPS[0])
    assert r.sent is False and r.status.startswith("SIMULATED")
    hist = []
    row = sms.record(hist, "Huye", sms.GROUPS[0], "watch", "hello", r)
    assert hist == [row] and row["delivered"] is False and "phone" not in " ".join(row)
    assert sms.GatewayProvider().send("x", sms.GROUPS[0]).sent is False


# ---- real sending (gateway mocked: no network, no real credentials) ----------------------------------------
CFG = dict(username="u", api_key="KEY", sender=None, pin="4321", sandbox=False)


def test_rwanda_numbers_are_normalised_and_bad_ones_rejected():
    good, bad = sms.parse_recipients("0788 123 456, +250 722 000 111\n250788123456, 0701234567, 07881")
    assert good == ["+250788123456", "+250722000111"] and bad == ["0701234567", "07881"]
    assert sms.mask("+250788123456").endswith("56") and "788123" not in sms.mask("+250788123456")


def test_real_send_checks_pin_consent_limits_and_configuration():
    ok = sms.validate_real(["+250788123456"], [], True, CFG, "4321", 0)
    assert ok == []
    assert any("PIN" in e for e in sms.validate_real(["+250788123456"], [], True, CFG, "0000", 0))
    assert any("agreed" in e for e in sms.validate_real(["+250788123456"], [], False, CFG, "4321", 0))
    assert any("At most" in e for e in sms.validate_real(["+250788123456"] * 4, [], True, CFG, "4321", 0))
    assert any("already used" in e for e in sms.validate_real(["+250788123456"], [], True, CFG, "4321", sms.MAX_REAL_PER_SESSION))
    assert any("not configured" in e for e in sms.validate_real(["+250788123456"], [], True, dict(CFG, api_key=None), "4321", 0))


def test_gateway_request_and_result_handling():
    seen = {}

    def fake(url, headers, form):
        seen.update(url=url, headers=headers, form=form)
        return {"SMSMessageData": {"Recipients": [{"statusCode": 101, "status": "Success"}]}}

    r = sms.AfricasTalkingProvider(CFG, post=fake).send("hi", sms.TEST_GROUP, ["+250788123456"])
    assert r.sent and r.status.startswith("ACCEPTED") and "not confirmed" in r.detail
    assert seen["form"]["to"] == "+250788123456" and seen["headers"]["apiKey"] == "KEY" and "sandbox" not in seen["url"]
    sb = sms.AfricasTalkingProvider(dict(CFG, sandbox=True), post=fake).send("hi", "g", ["+250788123456"])
    assert "sandbox" in seen["url"] and "no real phone" in sb.detail


def test_gateway_rejection_and_errors_never_claim_sent_and_never_leak_the_key():
    rej = lambda u, h, f: {"SMSMessageData": {"Recipients": [{"statusCode": 403, "status": "InvalidPhoneNumber"}]}}
    r = sms.AfricasTalkingProvider(CFG, post=rej).send("hi", "g", ["+250788123456"])
    assert not r.sent and "InvalidPhoneNumber" in r.detail

    def boom(u, h, f):
        raise OSError("connection to KEY failed")
    r2 = sms.AfricasTalkingProvider(CFG, post=boom).send("hi", "g", ["+250788123456"])
    assert not r2.sent and "KEY" not in r2.detail and r2.status == "FAILED"
    assert not sms.AfricasTalkingProvider(dict(CFG, api_key=None)).send("hi", "g", ["+250788123456"]).sent


def test_history_stores_only_masked_numbers():
    hist = []
    row = sms.record(hist, "Huye", sms.TEST_GROUP, "none", "hi", sms.Result("ACCEPTED by gateway", "", True), "en", ["+250788123456"])
    assert "788123" not in str(row) and row["to"].endswith("56")
