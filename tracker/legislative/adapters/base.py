from abc import ABC, abstractmethod
from datetime import date
from typing import Iterator

from pydantic import BaseModel


class BillRecord(BaseModel):
    council: str
    bill_number: str
    title: str | None = None
    bill_type: str | None = None
    introducer: str | None = None
    introduced_date: str | None = None
    status: str | None = None
    last_action: str | None = None
    last_action_date: str | None = None
    url: str
    raw_subject: str | None = None


class ActionRecord(BaseModel):
    council: str
    bill_number: str
    action_date: str
    action: str
    committee: str | None = None


class CouncilAdapter(ABC):
    council_id: str

    @abstractmethod
    def fetch_bills(self, since: date | None = None) -> Iterator[BillRecord]:
        ...

    @abstractmethod
    def fetch_actions(self, bill_number: str) -> Iterator[ActionRecord]:
        ...
