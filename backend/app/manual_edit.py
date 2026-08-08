# -*- coding: utf-8 -*-
"""
自動割当結果に対する手動調整(担当者の入れ替え)のロジック。

候補者の絞り込みルール:
  1. 差し替え先は、その枠に現在入っている人と同じ区分(上級医/下級医)のみ
     (空欄の場合は、同じ期間のペアとなる役割から必要な区分を逆算する。両方空欄なら区分は問わない)
  2. その日・その半日・その役割(当直/オンコール)に「不可」を設定している人は除外
  3. 当直の枠については、時系列で隣接する期間に当直で入っている人は除外(連続当直禁止)
"""
from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy.orm import Session

from . import models
from .scheduler import Period, build_periods


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
    periods = build_periods(run.start_date, run.days)
    target = Period(assignment.date, assignment.half)
    try:
        idx = periods.index(target)
    except ValueError:
        idx = None

    role = assignment.role
    members = {m.id: m for m in db.query(models.Member).all()}

    # 1) 区分(上級医/下級医)の決定
    required_rank: Optional[str] = None
    if assignment.member_id and assignment.member_id in members:
        required_rank = members[assignment.member_id].rank
    else:
        sibling_role = "oncall" if role == "duty" else "duty"
        sibling = next(
            (a for a in run.assignments if a.date == assignment.date and a.half == assignment.half and a.role == sibling_role),
            None,
        )
        if sibling and sibling.member_id and sibling.member_id in members:
            required_rank = "B" if members[sibling.member_id].rank == "A" else "A"

    eligible_ids = {m.id for m in members.values() if required_rank is None or m.rank == required_rank}

    # 2) 当日・その役割の不可設定を除外
    avail_rows = (
        db.query(models.Availability)
        .filter(models.Availability.date == assignment.date, models.Availability.half == assignment.half)
        .all()
    )
    ng_field = "duty_ng" if role == "duty" else "oncall_ng"
    ng_ids = {a.member_id for a in avail_rows if getattr(a, ng_field)}
    eligible_ids -= ng_ids

    # 3) 連続当直禁止(当直の枠のみ)
    if role == "duty" and idx is not None:
        adjacent_ids = set()
        for neighbor_idx in (idx - 1, idx + 1):
            if 0 <= neighbor_idx < len(periods):
                p = periods[neighbor_idx]
                neighbor = next(
                    (a for a in run.assignments if a.date == p.d and a.half == p.half and a.role == "duty"),
                    None,
                )
                if neighbor and neighbor.member_id:
                    adjacent_ids.add(neighbor.member_id)
        eligible_ids -= adjacent_ids

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
