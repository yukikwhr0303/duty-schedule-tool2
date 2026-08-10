# -*- coding: utf-8 -*-
"""
自動割当結果に対する手動調整(担当者の入れ替え)のロジック。

候補者の絞り込みルール:
  1. 区分(上級医/下級医)は問わない。当直⇔オンコールの入れ替えで上級医⇔下級医を
     入れ替えたいケースがあるため、その日に空いている人であれば区分を問わず候補にする。
  2. 同じ期間のもう一方の役割(当直/オンコール)に現在入っている人は除外
     (同じ人が同じ期間の当直・オンコール両方を兼ねてしまう二重登録を防ぐため)
  3. その日・その半日・その役割(当直/オンコール)に「不可」を設定している人は除外
  4. 当直の枠については、時系列で隣接する期間に当直で入っている人は除外(連続当直禁止。
     同日の前半→後半も含む。休日/祝日が2日連続する場合の「後半→翌日の後半」も含む)
  5. 「当直またはオンコール」が3暦日連続にならないようにする(直近3暦日の合計<=2)
"""
from dataclasses import dataclass
from datetime import timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from . import models
from .scheduler import Period, build_periods, group_periods_by_day, night_period_for_day


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
    members = {m.id: m for m in db.query(models.Member).filter(models.Member.is_active.is_(True)).all()}
    # 現在の担当者は、後でオフになっていても候補一覧に表示できるよう別途取得しておく
    if assignment.member_id and assignment.member_id not in members:
        current = db.get(models.Member, assignment.member_id)
        if current:
            members[current.id] = current

    # 1) 区分(上級医/下級医)は問わない(全員を候補の母集団にする)
    eligible_ids = set(members.keys())

    # 2) 同じ期間のもう一方の役割に現在入っている人は除外(同一人物の二重登録防止)
    sibling_role = "oncall" if role == "duty" else "duty"
    sibling = next(
        (a for a in run.assignments if a.date == assignment.date and a.half == assignment.half and a.role == sibling_role),
        None,
    )
    if sibling and sibling.member_id:
        eligible_ids.discard(sibling.member_id)

    # 3) 当日・その役割の不可設定を除外
    avail_rows = (
        db.query(models.Availability)
        .filter(models.Availability.date == assignment.date, models.Availability.half == assignment.half)
        .all()
    )
    ng_field = "duty_ng" if role == "duty" else "oncall_ng"
    ng_ids = {a.member_id for a in avail_rows if getattr(a, ng_field)}
    eligible_ids -= ng_ids

    periods_by_day = group_periods_by_day(periods)
    ordered_days = sorted(periods_by_day.keys())
    today = assignment.date

    # 4) 連続当直禁止(当直の枠のみ)。時系列で隣接する期間(同日の前半→後半も含む)を除外。
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

        # 4b) 暦日で連続する2日の「代表(夜間相当)当直枠」同士も連続禁止にする
        #     (休日後半→休日後半、平日→休日後半、など。period一覧では休日の前半(AM)が
        #     間に挟まるケースを上の隣接period間ルールだけでは検知できないため個別に追加している)。
        today_periods = periods_by_day.get(today)
        today_is_night_slot = bool(today_periods) and assignment.half == night_period_for_day(today_periods).half
        if today_is_night_slot:
            for neighbor_day in (today - timedelta(days=1), today + timedelta(days=1)):
                neighbor_periods = periods_by_day.get(neighbor_day)
                if not neighbor_periods:
                    continue
                neighbor_night = night_period_for_day(neighbor_periods)
                neighbor_assignment = next(
                    (
                        a for a in run.assignments
                        if a.date == neighbor_night.d and a.half == neighbor_night.half and a.role == "duty"
                    ),
                    None,
                )
                if neighbor_assignment and neighbor_assignment.member_id:
                    eligible_ids.discard(neighbor_assignment.member_id)

    # 5) 「当直またはオンコール」が3暦日連続にならないようにする(直近3暦日の合計<=2)。
    #    当直同士の連続は 4) で既に禁止済み。ここは主に、オンコール2日連続の前後に
    #    当直/オンコールが入って実質3日連続になる混在パターンを防ぐためのもの。
    if today in ordered_days:
        day_idx = ordered_days.index(today)
        exclude_ids = set()
        for offset in (-2, -1, 0):
            window_idxs = [day_idx + offset, day_idx + offset + 1, day_idx + offset + 2]
            if not all(0 <= w < len(ordered_days) for w in window_idxs):
                continue
            window_days = [ordered_days[w] for w in window_idxs]
            if (window_days[1] - window_days[0]).days != 1 or (window_days[2] - window_days[1]).days != 1:
                continue  # 暦日として連続していない(間が空いている)場合は対象外
            other_days = [wd for wd in window_days if wd != today]
            for mid in eligible_ids:
                covered_count = sum(
                    1
                    for wd in other_days
                    if any(a.member_id == mid and a.date == wd and a.role in ("duty", "oncall") for a in run.assignments)
                )
                if covered_count >= 2:
                    exclude_ids.add(mid)
        eligible_ids -= exclude_ids

    # 5b) 暦日ベースの5)だけだと、休日の前半→後半→翌日のように「period としては3連続だが
    #     暦日では2日」というすり抜けパターンを防げない(例: 土曜オンコール前半→土曜オンコール後半→
    #     日曜当直)。これを塞ぐため、period一覧上の単純な3連続も別途禁止する。
    if idx is not None:
        exclude_ids2 = set()
        for offset in (-2, -1, 0):
            window = [idx + offset, idx + offset + 1, idx + offset + 2]
            if not all(0 <= w < len(periods) for w in window):
                continue
            other_idxs = [w for w in window if w != idx]
            for mid in eligible_ids:
                covered_count = sum(
                    1
                    for w in other_idxs
                    if any(
                        a.member_id == mid and a.date == periods[w].d and a.half == periods[w].half
                        and a.role in ("duty", "oncall")
                        for a in run.assignments
                    )
                )
                if covered_count >= 2:
                    exclude_ids2.add(mid)
        eligible_ids -= exclude_ids2

    # 6) NGペア除外(この期間のもう一方の役割の担当者とNGペアの人は除外)
    sibling_role2 = "oncall" if role == "duty" else "duty"
    sibling2 = next(
        (a for a in run.assignments if a.date == assignment.date and a.half == assignment.half and a.role == sibling_role2),
        None,
    )
    if sibling2 and sibling2.member_id:
        ng_rows = (
            db.query(models.NgPair)
            .filter(
                (models.NgPair.member_a_id == sibling2.member_id)
                | (models.NgPair.member_b_id == sibling2.member_id)
            )
            .all()
        )
        ng_partner_ids = set()
        for row in ng_rows:
            ng_partner_ids.add(row.member_a_id if row.member_b_id == sibling2.member_id else row.member_b_id)
        eligible_ids -= ng_partner_ids

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
