# -*- coding: utf-8 -*-
"""
自動割当エンジン(DB駆動版)。scheduler_prototype.py の CP-SAT ロジックを
FastAPI + SQLAlchemy から呼べる形にしたもの。
  1. 当直・オンコールは 上級医1名 + 下級医1名 のペア(片方が空なら両方空)
  2. 当直の連続なし(period一覧で隣接する枠同士。同日の前半→後半も含む)
  3. 土日祝は 前半/後半 で 4枠(当直x2, オンコールx2)
  4. 個人ごとの当直不可/オンコール不可、前半不可/後半可 などの設定に対応
  5. 事前固定枠(fixed)に対応
  6. 個人ごとの希望回数(quota)になるべく近づける
  7. 埋まらない枠は空欄 + 理由を表示
  8. 暦日ベースの連続禁止ルール:
     - 当直・オンコールいずれかを担当した状態(covered)が3暦日連続にならないようにする
       (前半/後半の区別なく、その日のどこかで担当していれば「その日はcovered」として数える)
     - 「夜間相当の当直」(平日は当直、休日/祝日は後半の当直)が2暦日連続にならないようにする
       (平日当直→平日当直、休日後半当直→平日当直、休日後半当直→休日後半当直、をまとめて禁止)
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


def group_periods_by_day(periods):
    """期間一覧を暦日ごとにグループ化した dict{date: [Period, ...]} を返す。"""
    by_day = {}
    for p in periods:
        by_day.setdefault(p.d, []).append(p)
    return by_day


def night_period_for_day(day_periods):
    """その日の「代表(夜間相当)当直枠」を返す(平日はALL、休日/祝日は後半PM)。
    前半(AM)は日中のみのシフトのため、暦日をまたぐ連続当直の判定には使わない。"""
    return day_periods[0] if len(day_periods) == 1 else next(p for p in day_periods if p.half == "PM")


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

    # 暦日ごとの期間一覧と、暦日ベースの連続禁止ルールで使う「その日の代表当直枠」
    periods_by_day = group_periods_by_day(periods)
    ordered_days = sorted(periods_by_day.keys())
    night_period_by_day = {day: night_period_for_day(periods_by_day[day]) for day in ordered_days}

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
    ng_pairs = [(p.member_a_id, p.member_b_id) for p in db.query(models.NgPair).all()]

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

    # 暦日で連続する2日の「代表(夜間相当)当直枠」同士も連続禁止にする
    # (平日の当直→平日の当直、休日後半当直→平日の当直、休日後半当直→休日後半当直、
    #  平日の当直→休日後半当直、をまとめてカバーする)。
    # 平日→平日、休日後半→平日の組み合わせは上の隣接period間ルールで既にカバーされているが、
    # period一覧では休日の前半(AM)が間に挟まるケース(休日後半→休日後半、平日→休日後半)は
    # 上のルールだけでは検知できないため、暦日ベースで改めて禁止する。
    for i in range(len(ordered_days) - 1):
        day1, day2 = ordered_days[i], ordered_days[i + 1]
        if (day2 - day1).days != 1:
            continue
        p1, p2 = night_period_by_day[day1], night_period_by_day[day2]
        for d in doctors:
            model.Add(duty[(p1, d.id)] + duty[(p2, d.id)] <= 1)

    # 「当直またはオンコール」のどちらかを担当した状態(covered)が3暦日連続にならないようにする
    # (前半/後半の区別なく、その日のどこかで担当していれば「その日はcovered」として数える)。
    # 当直そのものの連続は上のルールで既に禁止済み。このルールは主に、オンコール2連続の
    # 直後/直前に当直やオンコールが入って実質3日連続の対応になってしまう混在パターンを
    # 防ぐためのもの(オンコール2日連続まで自体は許可)。
    covered = {}
    for p in periods:
        for d in doctors:
            covered[(p, d.id)] = model.NewBoolVar(f"covered_{p.d}_{p.half}_{d.id}")
            model.Add(covered[(p, d.id)] >= duty[(p, d.id)])
            model.Add(covered[(p, d.id)] >= oncall[(p, d.id)])
            model.Add(covered[(p, d.id)] <= duty[(p, d.id)] + oncall[(p, d.id)])

    covered_day = {}
    for day in ordered_days:
        day_periods = periods_by_day[day]
        for d in doctors:
            var = model.NewBoolVar(f"covered_day_{day}_{d.id}")
            model.AddMaxEquality(var, [covered[(p, d.id)] for p in day_periods])
            covered_day[(day, d.id)] = var

    for i in range(len(ordered_days) - 2):
        day1, day2, day3 = ordered_days[i], ordered_days[i + 1], ordered_days[i + 2]
        if (day2 - day1).days != 1 or (day3 - day2).days != 1:
            continue
        for d in doctors:
            model.Add(covered_day[(day1, d.id)] + covered_day[(day2, d.id)] + covered_day[(day3, d.id)] <= 2)

    # 上の暦日ベースのルールだけだと、休日の前半・後半を「1日」として1つにまとめてしまうため、
    # 「休日の前半→後半→翌日」のように period としては3連続でも暦日では2日、という
    # すり抜けパターンを防げない(例: 土曜オンコール前半→土曜オンコール後半→日曜当直)。
    # これを塞ぐため、period一覧上で単純に3連続している場合も別途禁止する。
    for i in range(len(periods) - 2):
        p1, p2, p3 = periods[i], periods[i + 1], periods[i + 2]
        for d in doctors:
            model.Add(covered[(p1, d.id)] + covered[(p2, d.id)] + covered[(p3, d.id)] <= 2)

    # NGペア: 同じ期間に、この2人が当直/オンコールのどちらの組み合わせでも一緒にならないようにする
    for a_id, b_id in ng_pairs:
        if a_id not in by_id or b_id not in by_id:
            continue
        for p in periods:
            model.Add(duty[(p, a_id)] + oncall[(p, b_id)] <= 1)
            model.Add(duty[(p, b_id)] + oncall[(p, a_id)] <= 1)

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
