from datetime import date, datetime
from typing import Optional, List, Literal

from pydantic import BaseModel, ConfigDict, Field

Half = Literal["ALL", "AM", "PM"]
Role = Literal["duty", "oncall"]
Rank = Literal["A", "B"]


# ---------- Member ----------
class MemberCreate(BaseModel):
    name: str
    rank: Rank


class MemberUpdate(BaseModel):
    name: Optional[str] = None
    rank: Optional[Rank] = None


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    rank: Rank
    has_pin: bool = False


# ---------- Auth ----------
class MemberLoginRequest(BaseModel):
    pin: str = Field(min_length=4, max_length=4, pattern=r"^\d{4}$")


class MemberLoginResult(BaseModel):
    member: MemberOut
    created_pin: bool  # True の場合、このリクエストで初めてPINを設定した


class AdminLoginRequest(BaseModel):
    password: str


# ---------- Availability ----------
class AvailabilityEntry(BaseModel):
    date: date
    half: Half
    duty_ng: bool = False
    oncall_ng: bool = False


class AvailabilityReplaceRequest(BaseModel):
    start: date
    end: date
    entries: List[AvailabilityEntry] = Field(default_factory=list)


class AvailabilityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    member_id: int
    date: date
    half: Half
    duty_ng: bool
    oncall_ng: bool


# ---------- Quota ----------
class QuotaItem(BaseModel):
    member_id: int
    duty_quota: int = 0
    oncall_quota: int = 0


class QuotaReplaceRequest(BaseModel):
    period_start: date
    period_days: int
    items: List[QuotaItem]


class QuotaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    member_id: int
    period_start: date
    period_days: int
    duty_quota: int
    oncall_quota: int


# ---------- Fixed slot ----------
class FixedSlotCreate(BaseModel):
    date: date
    half: Half
    role: Role
    member_id: int


class FixedSlotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    date: date
    half: Half
    role: Role
    member_id: int


# ---------- Schedule run ----------
class ScheduleRunRequest(BaseModel):
    start_date: date
    days: int = Field(gt=0, le=366)


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    date: date
    half: Half
    role: Role
    member_id: Optional[int]
    member_name: Optional[str] = None
    fixed: bool
    manual_override: bool = False
    unfilled_reason: Optional[str] = None


class TallyItem(BaseModel):
    member_id: int
    member_name: str
    duty: int
    oncall: int
    duty_quota: int
    oncall_quota: int


class ScheduleRunOut(BaseModel):
    id: int
    start_date: date
    days: int
    status: str
    created_at: datetime
    has_manual_edits: bool
    assignments: List[AssignmentOut]
    tally: List[TallyItem]


class ScheduleRunSummary(BaseModel):
    id: int
    start_date: date
    days: int
    status: str
    created_at: datetime
    has_manual_edits: bool


# ---------- Manual adjustment ----------
class AssignmentPatchRequest(BaseModel):
    member_id: Optional[int] = None


CandidateStatus = Literal["under", "on", "over"]


class CandidateOut(BaseModel):
    member_id: int
    name: str
    rank: Rank
    current_count: int
    quota: int
    status: CandidateStatus
    is_current: bool = False
