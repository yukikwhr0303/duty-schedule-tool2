# -*- coding: utf-8 -*-
"""
自動割当エンジン(DB駆動版)。scheduler_prototype.py の CP-SAT ロジックを
FastAPI + SQLAlchemy から呼べる形にしたもの。ロジック自体は変更していない:
  1. 当直・オンコールは 上級医1名 + 下級医1名 のペア(片方が空なら両方空)
  2. 当直の連続なし(時系列で隣接する period 同士)
  3. 土日祝は 前半/後半 で 4枠(当直x2, オンコールx2)
  4. 個人ごとの当直不可/オンコール不可、前半不可/後半可 などの設定に対応
  5. 事前固定枠(fixed)に対応
  6. 個人ごとの希望回数(quota)になるべく近づける
  7. 埋まらない枠は空欄 + 理由を表示
"""
from dataclasses import dataclass, field
from datetime import date, timedelta

from ortools.sat.python import cp_model
from sqlalchemy.orm import Session

from . import models
from .holidays import is_weekend_or_holiday


@dataclass(frozen=True)
class Period:
    d: date
    half: str  # "ALL" / "AM" / "PM"


def build_periods(start: date, days: int):
    periods = []
    d = start
    for _ in range(days):
        if is_weekend_or_holiday(d):
            periods.append(Period(d, "AM"))
            periods.append(Period(d, "PM"))
        else:
            periods.append(Period(d, "ALL"))
        d += timedelta(days=1)
    return periods


@dataclass
class Doctor:
    id: int
    name: str
    rank: str  # "A" senior / "B" junior
    duty_quota: int
    oncall_quota: int
    unavailable: set = field(default_factory=set)  # {(date, half, "duty"/"oncall")}

    def duty_ok(self, p: Period) -> bool:
        return (p.d, p.half, "duty") not in self.unavailable

    def oncall_ok(self, p: Period) -> bool:
        return (p.d, p.half, "oncall") not in self.unavailable


def run_scheduler(db: Session, start_date: date, days: int) -> models.ScheduleRun:
    end_date = start_date + timedelta(days=days - 1)
    periods = build_periods(start_date, days)

    members = (
        db.query(models.Member)
        .filter(models.Member.is_active.is_(True))
        .order_by(models.Member.sort_order, models.Member.id)
        .all()
    )
    if not members:
        run = models.ScheduleRun(start_date=start_date, days=days, status="ERROR")
        db.add(run)
        db.commit()
        db.refresh(run)
        return run

    availabilities = (
        db.query(models.Availability)
        .filter(models.Availability.date >= start_date, models.Availability.date <= end_date)
        .all()
    )
    fixed_rows = (
        db.query(models.FixedSlot)
        .filter(models.FixedSlot.date >= start_date, models.FixedSlot.date <= end_date)
        .all()
    )
    quota_rows = (
        db.query(models.Quota)
        .filter(models.Quota.period_start == start_date, models.Quota.period_days == days)
        .all()
    )
    quota_by_member = {q.member_id: q for q in quota_rows}

    doctors = []
    for m in members:
        q = quota_by_member.get(m.id)
        doctors.append(
            Doctor(
                id=m.id,
                name=m.name,
                rank=m.rank,
                duty_quota=q.duty_quota if q else 0,
                oncall_quota=q.oncall_quota if q else 0,
            )
        )
    by_id = {d.id: d for d in doctors}

    for a in availabilities:
        doc = by_id.get(a.member_id)
        if not doc:
            continue
        if a.duty_ng:
            doc.unavailable.add((a.date, a.half, "duty"))
        if a.oncall_ng:
            doc.unavailable.add((a.date, a.half, "oncall"))

    # 固定枠: (Period, role) -> member_id
    periods_by_key = {(p.d, p.half): p for p in periods}
    FIXED = {}
    for f in fixed_rows:
        p = periods_by_key.get((f.date, f.half))
        if p is None:
            continue
        FIXED[(p, f.role)] = f.member_id

    seniors = [d for d in doctors if d.rank == "A"]
    juniors = [d for d in doctors if d.rank == "B"]

    model = cp_model.CpModel()
    duty, oncall = {}, {}
    for p in periods:
        for d in doctors:
            duty[(p, d.id)] = model.NewBoolVar(f"duty_{p.d}_{p.half}_{d.id}")
            oncall[(p, d.id)] = model.NewBoolVar(f"oncall_{p.d}_{p.half}_{d.id}")

    for p in periods:
        model.Add(sum(duty[(p, d.id)] for d in doctors) <= 1)
        model.Add(sum(oncall[(p, d.id)] for d in doctors) <= 1)

    duty_filled, oncall_filled = {}, {}
    for p in periods:
        duty_filled[p] = model.NewBoolVar(f"duty_filled_{p.d}_{p.half}")
        model.Add(sum(duty[(p, d.id)] for d in doctors) == duty_filled[p])
        oncall_filled[p] = model.NewBoolVar(f"oncall_filled_{p.d}_{p.half}")
        model.Add(sum(oncall[(p, d.id)] for d in doctors) == oncall_filled[p])
        model.Add(duty_filled[p] == oncall_filled[p])

    for p in periods:
        for d in doctors:
            if not d.duty_ok(p):
                model.Add(duty[(p, d.id)] == 0)
            if not d.oncall_ok(p):
                model.Add(oncall[(p, d.id)] == 0)

    if seniors and juniors:
        for p in periods:
            duty_senior = sum(duty[(p, d.id)] for d in seniors)
            duty_junior = sum(duty[(p, d.id)] for d in juniors)
            oncall_senior = sum(oncall[(p, d.id)] for d in seniors)
            oncall_junior = sum(oncall[(p, d.id)] for d in juniors)
            model.Add(duty_senior + oncall_senior == duty_filled[p])
            model.Add(duty_junior + oncall_junior == duty_filled[p])
    else:
        # 上級医または下級医が0名の場合は誰も割当できない(全枠空欄)
        for p in periods:
            model.Add(duty_filled[p] == 0)

    for i in range(len(periods) - 1):
        p1, p2 = periods[i], periods[i + 1]
        for d in doctors:
            model.Add(duty[(p1, d.id)] + duty[(p2, d.id)] <= 1)

    # オンコールは3期間連続を禁止(2期間連続までは可)
    for i in range(len(periods) - 2):
        p1, p2, p3 = periods[i], periods[i + 1], periods[i + 2]
        for d in doctors:
            model.Add(oncall[(p1, d.id)] + oncall[(p2, d.id)] + oncall[(p3, d.id)] <= 2)

    for (p, role), doc_id in FIXED.items():
        if doc_id not in by_id:
            continue
        if role == "duty":
            model.Add(duty[(p, doc_id)] == 1)
        else:
            model.Add(oncall[(p, doc_id)] == 1)

    quota_dev = []
    for d in doctors:
        total_duty = sum(duty[(p, d.id)] for p in periods)
        total_oncall = sum(oncall[(p, d.id)] for p in periods)

        dev_duty = model.NewIntVar(-len(periods), len(periods), f"dev_duty_{d.id}")
        model.Add(dev_duty == total_duty - d.duty_quota)
        abs_dev_duty = model.NewIntVar(0, len(periods), f"abs_dev_duty_{d.id}")
        model.AddAbsEquality(abs_dev_duty, dev_duty)
        quota_dev.append(abs_dev_duty)

        dev_oncall = model.NewIntVar(-len(periods), len(periods), f"dev_oncall_{d.id}")
        model.Add(dev_oncall == total_oncall - d.oncall_quota)
        abs_dev_oncall = model.NewIntVar(0, len(periods), f"abs_dev_oncall_{d.id}")
        model.AddAbsEquality(abs_dev_oncall, dev_oncall)
        quota_dev.append(abs_dev_oncall)

    unfilled_penalty = sum((1 - duty_filled[p]) for p in periods) * 1000
    quota_penalty = sum(quota_dev)
    model.Minimize(unfilled_penalty + quota_penalty)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 15
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    run = models.ScheduleRun(start_date=start_date, days=days, status=solver.StatusName(status))
    db.add(run)
    db.flush()  # get run.id

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for p in periods:
            duty_doc = next((d for d in doctors if solver.Value(duty[(p, d.id)])), None)
            oncall_doc = next((d for d in doctors if solver.Value(oncall[(p, d.id)])), None)

            duty_reason = None
            oncall_reason = None
            if duty_doc is None:
                senior_avail = [s for s in seniors if s.duty_ok(p) or s.oncall_ok(p)]
                junior_avail = [j for j in juniors if j.duty_ok(p) or j.oncall_ok(p)]
                if not seniors or not juniors:
                    reason = "上級医または下級医が登録されていません"
                elif not senior_avail:
                    reason = "対応可能な上級医がいません"
                elif not junior_avail:
                    reason = "対応可能な下級医がいません"
                else:
                    reason = "全体条件(連続禁止・希望回数など)により配置不可"
                duty_reason = reason
                oncall_reason = reason

            db.add(
                models.Assignment(
                    run_id=run.id, date=p.d, half=p.half, role="duty",
                    member_id=duty_doc.id if duty_doc else None,
                    fixed=(p, "duty") in FIXED,
                    unfilled_reason=duty_reason,
                )
            )
            db.add(
                models.Assignment(
                    run_id=run.id, date=p.d, half=p.half, role="oncall",
                    member_id=oncall_doc.id if oncall_doc else None,
                    fixed=(p, "oncall") in FIXED,
                    unfilled_reason=oncall_reason,
                )
            )

    db.commit()
    db.refresh(run)
    return run
