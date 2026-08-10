from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..scheduler import run_scheduler
from ..exporter import export_xlsx
from ..manual_edit import get_candidates
from ..auth import require_admin

router = APIRouter(prefix="/schedule", tags=["schedule"])


def _build_run_out(db: Session, run: models.ScheduleRun) -> schemas.ScheduleRunOut:
    members = {m.id: m for m in db.query(models.Member).all()}
    quota_rows = (
        db.query(models.Quota)
        .filter(models.Quota.period_start == run.start_date, models.Quota.period_days == run.days)
        .all()
    )
    quota_by_member = {q.member_id: q for q in quota_rows}

    assignments_out = []
    tally = {m.id: {"duty": 0, "oncall": 0} for m in members.values()}
    has_manual_edits = False
    for a in run.assignments:
        member_name = members[a.member_id].name if a.member_id in members else None
        assignments_out.append(
            schemas.AssignmentOut(
                id=a.id, date=a.date, half=a.half, role=a.role,
                member_id=a.member_id, member_name=member_name,
                fixed=a.fixed, manual_override=a.manual_override, unfilled_reason=a.unfilled_reason,
            )
        )
        if a.manual_override:
            has_manual_edits = True
        if a.member_id in tally:
            tally[a.member_id][a.role] += 1

    # 休止中のメンバーは一覧から除外し、希望回数設定画面と同じ並び順(sort_order → id)にする
    active_members_sorted = sorted(
        (m for m in members.values() if m.is_active is not False),
        key=lambda m: (m.sort_order if m.sort_order is not None else 0, m.id),
    )
    tally_out = [
        schemas.TallyItem(
            member_id=m.id,
            member_name=m.name,
            duty=tally[m.id]["duty"],
            oncall=tally[m.id]["oncall"],
            duty_quota=quota_by_member[m.id].duty_quota if m.id in quota_by_member else 0,
            oncall_quota=quota_by_member[m.id].oncall_quota if m.id in quota_by_member else 0,
        )
        for m in active_members_sorted
    ]

    return schemas.ScheduleRunOut(
        id=run.id, start_date=run.start_date, days=run.days, status=run.status,
        created_at=run.created_at, has_manual_edits=has_manual_edits,
        assignments=assignments_out, tally=tally_out,
    )


@router.post("/run", response_model=schemas.ScheduleRunOut, dependencies=[Depends(require_admin)])
def create_schedule_run(payload: schemas.ScheduleRunRequest, db: Session = Depends(get_db)):
    run = run_scheduler(db, payload.start_date, payload.days)
    return _build_run_out(db, run)


@router.get("/runs", response_model=List[schemas.ScheduleRunSummary])
def list_schedule_runs(db: Session = Depends(get_db)):
    runs = db.query(models.ScheduleRun).order_by(models.ScheduleRun.created_at.desc()).all()
    return [
        schemas.ScheduleRunSummary(
            id=r.id, start_date=r.start_date, days=r.days, status=r.status, created_at=r.created_at,
            has_manual_edits=any(a.manual_override for a in r.assignments),
        )
        for r in runs
    ]


@router.get("/runs/{run_id}", response_model=schemas.ScheduleRunOut)
def get_schedule_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(models.ScheduleRun, run_id)
    if not run:
        raise HTTPException(404, "schedule run not found")
    return _build_run_out(db, run)


@router.get("/runs/{run_id}/export.xlsx")
def export_run_xlsx(run_id: int, db: Session = Depends(get_db)):
    run = db.get(models.ScheduleRun, run_id)
    if not run:
        raise HTTPException(404, "schedule run not found")
    try:
        buf = export_xlsx(db, run)
    except Exception as e:
        # 原因をブラウザ側でも確認できるよう詳細メッセージ付きで返す(Renderのログを見なくても分かるように)
        raise HTTPException(500, f"Excel出力でエラーが発生しました: {type(e).__name__}: {e}")
    filename = f"duty_calendar_{run.start_date}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/runs/{run_id}/assignments/{assignment_id}/candidates", response_model=List[schemas.CandidateOut])
def get_assignment_candidates(run_id: int, assignment_id: int, db: Session = Depends(get_db)):
    run = db.get(models.ScheduleRun, run_id)
    if not run:
        raise HTTPException(404, "schedule run not found")
    assignment = db.get(models.Assignment, assignment_id)
    if not assignment or assignment.run_id != run_id:
        raise HTTPException(404, "assignment not found")

    candidates = get_candidates(db, run, assignment)
    return [
        schemas.CandidateOut(
            member_id=c.member_id, name=c.name, rank=c.rank,
            current_count=c.current_count, quota=c.quota, status=c.status, is_current=c.is_current,
        )
        for c in candidates
    ]


@router.patch("/runs/{run_id}/assignments/{assignment_id}", response_model=schemas.ScheduleRunOut, dependencies=[Depends(require_admin)])
def patch_assignment(run_id: int, assignment_id: int, payload: schemas.AssignmentPatchRequest, db: Session = Depends(get_db)):
    run = db.get(models.ScheduleRun, run_id)
    if not run:
        raise HTTPException(404, "schedule run not found")
    assignment = db.get(models.Assignment, assignment_id)
    if not assignment or assignment.run_id != run_id:
        raise HTTPException(404, "assignment not found")

    if payload.member_id is not None:
        member = db.get(models.Member, payload.member_id)
        if not member:
            raise HTTPException(400, "unknown member_id")
        assignment.member_id = payload.member_id
        assignment.unfilled_reason = None
    else:
        assignment.member_id = None
        assignment.unfilled_reason = "手動で空欄に設定"
    assignment.manual_override = True

    db.commit()
    db.refresh(run)
    return _build_run_out(db, run)
