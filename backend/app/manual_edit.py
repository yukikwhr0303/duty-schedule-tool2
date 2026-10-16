# -*- coding: utf-8 -*-
"""
自動割当結果に対する手動調整(担当者の入れ替え)のロジック。

候補者:
  その日・その半日・その役割(当直/オンコール)に本人が「不可」を入れていない人であれば、
  区分(上級医/下級医)や連続勤務などに関係なく全員を候補にする。現在の担当者は常に含める。
"""
from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy.orm import Session

from . import models


@dataclass
class Candidate:
    member_id: int
    name: str
    rank: str
    current_count: int
    quota: int
    status: str  # "under" / "on" / "over"
    is_current: bool


def _tally_for_run(db: Session, run: models.ScheduleRun):
    tally = {}
    for a in run.assignments:
        if a.member_id is None:
            continue
        tally.setdefault(a.member_id, {"duty": 0, "oncall": 0})
        tally[a.member_id][a.role] += 1
    return tally


def get_candidates(db: Session, run: models.ScheduleRun, assignment: models.Assignment) -> List[Candidate]:
    """プルダウンの候補 = 「その日・その枠・その役割に入れる人」の単純なリスト。
    連続勤務・NGペア・同じ枠の相方などの条件では絞り込まない(手動調整では自由に選べるようにするため)。
    除外するのは、その日その枠その役割に本人が「不可」を入れている人だけ。"""
    role = assignment.role
    members = {m.id: m for m in db.query(models.Member).filter(models.Member.is_active.is_(True)).all()}
    # 現在の担当者は、後でオフになっていても候補一覧に表示できるよう別途取得しておく
    if assignment.member_id and assignment.member_id not in members:
        current = db.get(models.Member, assignment.member_id)
        if current:
            members[current.id] = current

    eligible_ids = set(members.keys())

    avail_rows = (
        db.query(models.Availability)
        .filter(models.Availability.date == assignment.date, models.Availability.half == assignment.half)
        .all()
    )
    ng_field = "duty_ng" if role == "duty" else "oncall_ng"
    eligible_ids -= {a.member_id for a in avail_rows if getattr(a, ng_field)}

    # 常に現在の担当者自身は候補に含める(表示のため)
    if assignment.member_id:
        eligible_ids.add(assignment.member_id)

    tally = _tally_for_run(db, run)
    quota_rows = (
        db.query(models.Quota)
        .filter(models.Quota.period_start == run.start_date, models.Quota.period_days == run.days)
        .all()
    )
    quota_by_member = {q.member_id: q for q in quota_rows}

    results = []
    for mid in eligible_ids:
        m = members.get(mid)
        if not m:
            continue
        t = tally.get(mid, {"duty": 0, "oncall": 0})
        current_count = t[role]
        q = quota_by_member.get(mid)
        quota_val = (q.duty_quota if role == "duty" else q.oncall_quota) if q else 0
        if current_count > quota_val:
            status = "over"
        elif current_count < quota_val:
            status = "under"
        else:
            status = "on"
        results.append(
            Candidate(
                member_id=mid,
                name=m.name,
                rank=m.rank,
                current_count=current_count,
                quota=quota_val,
                status=status,
                is_current=(mid == assignment.member_id),
            )
        )

    results.sort(key=lambda c: (not c.is_current, c.status != "under", c.status == "over", c.name))
    return results
