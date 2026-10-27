"""SMS workflow with a provider interface. Only SIMULATION is implemented: no message is ever sent from this app.

- No phone numbers are collected or stored; recipients are groups.
- Sending (even simulated) needs the operator's consent confirmation for the group.
- Credentials never live in code: a real gateway would read them from the environment (see GatewayProvider).
"""
from __future__ import annotations

import datetime as dt
import os
from dataclasses import dataclass

MAX_SINGLE = 160      # one SMS segment (GSM-7 characters)
MAX_TOTAL = 306       # two concatenated segments
GROUPS = ["District agronomists and extension officers", "Cooperative leaders and farmer promoters",
          "Farmers who registered for this district (not connected)"]
STATUS_SIM = "SIMULATED: not sent"


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


class SmsProvider:
    def send(self, text: str, group: str) -> Result:  # pragma: no cover - interface
        raise NotImplementedError


class SimulatedProvider(SmsProvider):
    def send(self, text: str, group: str) -> Result:
        return Result(STATUS_SIM, f"Generated for '{group}'. No gateway is connected, so nothing was delivered.", sent=False)


class GatewayProvider(SmsProvider):
    """Placeholder for a real SMS gateway. Reads credentials from the environment, never from code."""

    def __init__(self) -> None:
        self.key = os.environ.get("MUSARURO_SMS_API_KEY")

    def send(self, text: str, group: str) -> Result:
        if not self.key:
            return Result("NOT CONFIGURED", "No SMS gateway credentials are set. Nothing was sent.", sent=False)
        raise NotImplementedError("Gateway integration is not implemented in this prototype.")


def get_provider() -> SmsProvider:
    return SimulatedProvider()


def record(history: list, district: str, group: str, level: str, text: str, result: Result, lang: str = "en") -> dict:
    """Append a history row. Contains no phone numbers."""
    row = dict(time=dt.datetime.now().strftime("%Y-%m-%d %H:%M"), district=district, group=group, level=level,
               lang=lang, chars=len(text), status=result.status, delivered=result.sent)
    history.append(row)
    return row
