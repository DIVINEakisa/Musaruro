"""SMS workflow with a provider interface.

Default is SIMULATION: nothing is sent. A real send is possible only when ALL of these hold:
  1. gateway credentials AND an operator PIN are set as secrets/environment variables (never in code or in the repo),
  2. the operator chooses "real test SMS", types at most MAX_RECIPIENTS Rwandan numbers, confirms those people agreed,
  3. the PIN matches and the session has not used up its MAX_REAL_PER_SESSION sends.
Phone numbers are used for the one request and then discarded; the history stores only a masked form (+250 78* *** *12).
The gateway is Africa's Talking (supports Rwanda). Its sandbox accepts requests but delivers to no real phone.
"""
from __future__ import annotations

import datetime as dt
import hmac
import json
import os
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass

MAX_SINGLE = 160      # one SMS segment (GSM-7 characters)
MAX_TOTAL = 306       # two concatenated segments
GROUPS = ["District agronomists and extension officers", "Cooperative leaders and farmer promoters",
          "Farmers who registered for this district (not connected)"]
TEST_GROUP = "Test numbers typed by the operator"
GROUPS.append(TEST_GROUP)
STATUS_SIM = "SIMULATED: not sent"
MAX_RECIPIENTS = 3
MAX_REAL_PER_SESSION = 5
AT_URL = "https://api.africastalking.com/version1/messaging"
AT_SANDBOX_URL = "https://api.sandbox.africastalking.com/version1/messaging"
ACCEPTED_CODES = {100, 101, 102}     # Processed, Sent, Queued (Africa's Talking status codes)


@dataclass
class Result:
    status: str
    detail: str
    sent: bool = False


def length_info(text: str) -> dict:
    n = len(text)
    segs = 0 if n == 0 else 1 if n <= MAX_SINGLE else 2 if n <= MAX_TOTAL else -1
    return dict(chars=n, segments=segs, ok=segs in (1, 2),
                note="Fits one SMS" if segs == 1 else "Two SMS segments" if segs == 2 else "Too long: shorten it")


def validate(text: str, group: str, consent_confirmed: bool, kinyarwanda_reviewed: bool = True, lang: str = "en") -> list[str]:
    """Problems that block even a simulated send. Empty list = ok."""
    errs = []
    if not text.strip():
        errs.append("The message is empty.")
    if not length_info(text)["ok"] and text.strip():
        errs.append("The message is too long.")
    if group not in GROUPS:
        errs.append("Choose a recipient group.")
    if not consent_confirmed:
        errs.append("Confirm that recipients consented to receive these messages.")
    if lang == "rw" and not kinyarwanda_reviewed:
        errs.append("Kinyarwanda text must be reviewed by a native speaker first.")
    return errs


def normalize_rw_phone(raw: str) -> str | None:
    """+2507XXXXXXXX for MTN (078, 079) and Airtel (072, 073) numbers; None if it does not look like one."""
    d = re.sub(r"[\s\-().]", "", raw or "")
    if d.startswith("+"):
        d = d[1:]
    if d.startswith("250"):
        d = d[3:]
    elif d.startswith("0"):
        d = d[1:]
    return "+250" + d if re.fullmatch(r"7[2389]\d{7}", d) else None


def parse_recipients(text: str) -> tuple[list[str], list[str]]:
    """Split typed numbers (comma, space or newline separated) into (valid unique numbers, rejected entries)."""
    parts = [p for p in re.split(r"[,;\n]+", text or "") if p.strip()]
    good, bad = [], []
    for p in parts:
        n = normalize_rw_phone(p)
        if n is None:
            bad.append(p.strip())
        elif n not in good:
            good.append(n)
    return good, bad


def mask(number: str) -> str:
    return f"{number[:6]}* *** *{number[-2:]}" if len(number) >= 10 else "***"


def load_config(source=None) -> dict:
    """Read gateway settings from a mapping (e.g. st.secrets) or, failing that, the environment."""
    def get(k):
        try:
            v = source.get(k) if source is not None else None
        except Exception:  # a secrets store that is missing or malformed
            v = None
        return v or os.environ.get(k)
    return dict(username=get("MUSARURO_AT_USERNAME"), api_key=get("MUSARURO_AT_API_KEY"), sender=get("MUSARURO_AT_SENDER"),
                pin=get("MUSARURO_SMS_PIN"), sandbox=str(get("MUSARURO_AT_SANDBOX") or "").lower() in ("1", "true", "yes"))


def real_send_ready(cfg: dict) -> bool:
    return bool(cfg.get("username") and cfg.get("api_key") and cfg.get("pin"))


def pin_ok(cfg: dict, entered: str) -> bool:
    return bool(cfg.get("pin")) and hmac.compare_digest(str(cfg["pin"]), str(entered or ""))


def validate_real(recipients: list[str], rejected: list[str], people_agreed: bool, cfg: dict, entered_pin: str, used: int) -> list[str]:
    errs = []
    if not real_send_ready(cfg):
        errs.append("The SMS gateway is not configured, so real sending is switched off.")
        return errs
    if not recipients:
        errs.append("Enter at least one Rwandan mobile number (for example 0788 123 456).")
    if len(recipients) > MAX_RECIPIENTS:
        errs.append(f"At most {MAX_RECIPIENTS} numbers per send while this is a prototype.")
    if rejected:
        errs.append("These do not look like Rwandan MTN or Airtel numbers: " + ", ".join(rejected))
    if not people_agreed:
        errs.append("Confirm that the people at these numbers agreed to get this test message.")
    if not pin_ok(cfg, entered_pin):
        errs.append("The operator PIN is wrong.")
    if used >= MAX_REAL_PER_SESSION:
        errs.append(f"This session has already used its {MAX_REAL_PER_SESSION} real sends.")
    return errs


class SmsProvider:
    def send(self, text: str, group: str, recipients: list[str] | None = None) -> Result:  # pragma: no cover - interface
        raise NotImplementedError


class SimulatedProvider(SmsProvider):
    def send(self, text: str, group: str, recipients: list[str] | None = None) -> Result:
        return Result(STATUS_SIM, f"Generated for '{group}'. No gateway is connected, so nothing was delivered.", sent=False)


def _http_post(url: str, headers: dict, form: dict, timeout: int = 20) -> dict:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - fixed https gateway URL
        return json.loads(r.read().decode())


class AfricasTalkingProvider(SmsProvider):
    """Sends through Africa's Talking. `post` can be replaced in tests so no network is used.
    'sent' = accepted by the gateway; delivery to the handset is NOT confirmed (that needs a delivery-report callback)."""

    def __init__(self, cfg: dict | None = None, post=_http_post) -> None:
        self.cfg = cfg if cfg is not None else load_config()
        self.post = post

    def send(self, text: str, group: str, recipients: list[str] | None = None) -> Result:
        c = self.cfg
        if not (c.get("username") and c.get("api_key")):
            return Result("NOT CONFIGURED", "No SMS gateway credentials are set. Nothing was sent.", sent=False)
        if not recipients:
            return Result("NOT SENT", "No recipient numbers were given.", sent=False)
        form = {"username": c["username"], "to": ",".join(recipients), "message": text}
        if c.get("sender"):
            form["from"] = c["sender"]
        url = AT_SANDBOX_URL if c.get("sandbox") else AT_URL
        try:
            data = self.post(url, {"apiKey": c["api_key"], "Accept": "application/json"}, form)
        except Exception as e:  # network, HTTP or JSON error: report the type only, never the key
            return Result("FAILED", f"The gateway request failed ({type(e).__name__}). Nothing is known to have been sent.", sent=False)
        recs = (data.get("SMSMessageData") or {}).get("Recipients") or []
        ok = [r for r in recs if r.get("statusCode") in ACCEPTED_CODES]
        where = " (sandbox: no real phone receives it)" if c.get("sandbox") else ""
        if recs and len(ok) == len(recs):
            return Result("ACCEPTED by gateway", f"{len(ok)} of {len(recs)} numbers accepted{where}. Delivery to the phone is not confirmed.", sent=True)
        reasons = sorted({str(r.get("status")) for r in recs if r.get("statusCode") not in ACCEPTED_CODES}) or ["no recipient reply"]
        return Result("PARTLY ACCEPTED" if ok else "REJECTED", f"{len(ok)} of {len(recs)} accepted{where}. Reasons: {', '.join(reasons)}.", sent=bool(ok))


GatewayProvider = AfricasTalkingProvider      # old name kept


def get_provider(real: bool = False, cfg: dict | None = None) -> SmsProvider:
    if real:
        return AfricasTalkingProvider(cfg)
    return SimulatedProvider()


def record(history: list, district: str, group: str, level: str, text: str, result: Result, lang: str = "en",
           recipients: list[str] | None = None) -> dict:
    """Append a history row. Phone numbers are stored only masked; 'delivered' here means accepted by the gateway."""
    row = dict(time=dt.datetime.now().strftime("%Y-%m-%d %H:%M"), district=district, group=group, level=level,
               lang=lang, chars=len(text), status=result.status, delivered=result.sent)
    if recipients:
        row["to"] = ", ".join(mask(n) for n in recipients)
    history.append(row)
    return row
