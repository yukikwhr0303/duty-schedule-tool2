import hmac
import json
from typing import List, Optional
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import ADMIN_PASSWORD, require_admin
from ..database import get_db

router = APIRouter(prefix="/availability", tags=["availability"])


def _utcnow() -> datetime:
    return datetime.utcnow()


def _rows_to_dicts(rows) -> List[dict]:
    return [
        {"date": r.date.isoformat(), "half": r.half, "duty_ng": bool(r.duty_ng), "oncall_ng": bool(r.oncall_ng), "note": r.note}
        for r in sorted(rows, key=lambda r: (r.date, r.half))
    ]


def _range_rows(db: Session, member_id: int, start: date, end: date):
    return (
        db.query(models.Availability)
        .filter(models.Availability.member_id == member_id, models.Availability.date >= start, models.Availability.date <= end)
        .all()
    )


def _is_admin_request(x_admin_password: str) -> bool:
    return hmac.compare_digest(x_admin_password or "", ADMIN_PASSWORD)


def _month_of(d: date):
    first = d.replace(day=1)
    nxt = (first + timedelta(days=32)).replace(day=1)
    return first, (nxt - first).days


@router.get("", response_model=List[schemas.AvailabilityOut])
def list_availability(
    member_id: Optional[int] = None,
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.Availability)
    if member_id is not None:
        q = q.filter(models.Availability.member_id == member_id)
    if start is not None:
        q = q.filter(models.Availability.date >= start)
    if end is not None:
        q = q.filter(models.Availability.date <= end)
    return q.order_by(models.Availability.date, models.Availability.half).all()


@router.put("/{member_id}", response_model=List[schemas.AvailabilityOut])
def replace_availability(
    member_id: int,
    payload: schemas.AvailabilityReplaceRequest,
    db: Session = Depends(get_db),
    x_admin_password: str = Header(default=""),
):
    """指定期間 [start, end] のそのメンバーの不可設定を、送られてきた entries で丸ごと置き換える。
    医局員用カレンダー画面が「不可の枠だけ」を保持する仕様に合わせ、
    entries に含まれない日は「可」として扱われる(=行が存在しない)。"""
    member = db.get(models.Member, member_id)
    if not member:
        raise HTTPException(404, "member not found")
    if payload.end < payload.start:
        raise HTTPException(400, "end must be >= start")

    before = _rows_to_dicts(_range_rows(db, member_id, payload.start, payload.end))

    db.query(models.Availability).filter(
        models.Availability.member_id == member_id,
        models.Availability.date >= payload.start,
        models.Availability.date <= payload.end,
    ).delete()

    created = []
    for e in payload.entries:
        if not (payload.start <= e.date <= payload.end):
            raise HTTPException(400, f"entry date {e.date} is outside [{payload.start}, {payload.end}]")
        note = (e.note or "").strip() or None
        if not e.duty_ng and not e.oncall_ng and not note:
            continue  # 全部可・コメントなしは保存不要
        row = models.Availability(
            member_id=member_id, date=e.date, half=e.half, duty_ng=e.duty_ng, oncall_ng=e.oncall_ng, note=note
        )
        db.add(row)
        created.append(row)

    db.flush()
    after = _rows_to_dicts(created)
    if before != after:  # 実際に変化があった時だけ履歴に残す
        period_start, period_days = _month_of(payload.start)
        db.add(models.AvailabilityLog(
            member_id=member_id, at=_utcnow(),
            actor="admin" if _is_admin_request(x_admin_password) else "member",
            action="save", period_start=period_start, period_days=period_days,
            target_date=payload.start if payload.start == payload.end else None,
            before_json=json.dumps(before, ensure_ascii=False), after_json=json.dumps(after, ensure_ascii=False),
        ))

    db.commit()
    for row in created:
        db.refresh(row)
    return db.query(models.Availability).filter(
        models.Availability.member_id == member_id,
        models.Availability.date >= payload.start,
        models.Availability.date <= payload.end,
    ).order_by(models.Availability.date, models.Availability.half).all()


@router.post("/{member_id}/submit", response_model=schemas.SubmissionOut)
def submit_availability(member_id: int, payload: schemas.SubmissionRequest, db: Session = Depends(get_db)):
    """「この内容で提出する」ボタン用。対象月について提出済みであることを記録する(upsert)。"""
    member = db.get(models.Member, member_id)
    if not member:
        raise HTTPException(404, "member not found")

    existing = (
        db.query(models.AvailabilitySubmission)
        .filter(
            models.AvailabilitySubmission.member_id == member_id,
            models.AvailabilitySubmission.period_start == payload.period_start,
            models.AvailabilitySubmission.period_days == payload.period_days,
        )
        .first()
    )
    now = _utcnow()
    # 提出時点の対象月の内容をスナップショットとして履歴に残す(中身が空の提出も後から分かる)
    snapshot = _rows_to_dicts(
        _range_rows(db, member_id, payload.period_start, payload.period_start + timedelta(days=payload.period_days - 1))
    )
    db.add(models.AvailabilityLog(
        member_id=member_id, at=now, actor="member", action="submit",
        period_start=payload.period_start, period_days=payload.period_days,
        after_json=json.dumps(snapshot, ensure_ascii=False),
    ))

    if existing:
        existing.submitted_at = now
        db.commit()
        db.refresh(existing)
        return existing

    row = models.AvailabilitySubmission(
        member_id=member_id, period_start=payload.period_start, period_days=payload.period_days, submitted_at=now
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/submissions", response_model=List[schemas.SubmissionOut])
def list_submissions(period_start: date, period_days: int, db: Session = Depends(get_db)):
    """対象月について、提出済みのメンバー一覧を返す(管理者が未提出者を割り出すのに使う)。"""
    return (
        db.query(models.AvailabilitySubmission)
        .filter(
            models.AvailabilitySubmission.period_start == period_start,
            models.AvailabilitySubmission.period_days == period_days,
        )
        .all()
    )


@router.get("/logs", response_model=List[schemas.AvailabilityLogOut], dependencies=[Depends(require_admin)])
def list_availability_logs(
    period_start: date,
    period_days: int,
    member_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """対象月の希望入力履歴(本人の保存・提出、管理者の代理編集)を古い順に返す。管理者のみ。"""
    q = db.query(models.AvailabilityLog).filter(
        models.AvailabilityLog.period_start == period_start,
        models.AvailabilityLog.period_days == period_days,
    )
    if member_id is not None:
        q = q.filter(models.AvailabilityLog.member_id == member_id)
    logs = q.order_by(models.AvailabilityLog.at, models.AvailabilityLog.id).all()
    names = {m.id: m.name for m in db.query(models.Member).all()}
    return [
        schemas.AvailabilityLogOut(
            id=l.id, member_id=l.member_id, member_name=names.get(l.member_id, "(削除済み)"),
            at=l.at, actor=l.actor, action=l.action, period_start=l.period_start, period_days=l.period_days,
            target_date=l.target_date,
            before=json.loads(l.before_json) if l.before_json is not None else None,
            after=json.loads(l.after_json) if l.after_json is not None else None,
        )
        for l in logs
    ]


@router.post("/{member_id}/restore-submitted", response_model=List[schemas.AvailabilityOut], dependencies=[Depends(require_admin)])
def restore_submitted(member_id: int, payload: schemas.SubmissionRequest, db: Session = Depends(get_db)):
    """管理者用。対象月の希望を「本人が最後に提出した時点の内容」に戻す(代理編集のリセット)。"""
    member = db.get(models.Member, member_id)
    if not member:
        raise HTTPException(404, "member not found")
    last = (
        db.query(models.AvailabilityLog)
        .filter(
            models.AvailabilityLog.member_id == member_id,
            models.AvailabilityLog.action == "submit",
            models.AvailabilityLog.period_start == payload.period_start,
            models.AvailabilityLog.period_days == payload.period_days,
        )
        .order_by(models.AvailabilityLog.at.desc(), models.AvailabilityLog.id.desc())
        .first()
    )
    if not last:
        raise HTTPException(400, "この月の本人の提出記録がありません")

    start = payload.period_start
    end = start + timedelta(days=payload.period_days - 1)
    snapshot = json.loads(last.after_json or "[]")
    before = _rows_to_dicts(_range_rows(db, member_id, start, end))

    db.query(models.Availability).filter(
        models.Availability.member_id == member_id,
        models.Availability.date >= start,
        models.Availability.date <= end,
    ).delete()
    for r in snapshot:
        db.add(models.Availability(
            member_id=member_id, date=date.fromisoformat(r["date"]), half=r["half"],
            duty_ng=r["duty_ng"], oncall_ng=r["oncall_ng"], note=r.get("note"),
        ))
    db.flush()
    if before != snapshot:
        db.add(models.AvailabilityLog(
            member_id=member_id, at=_utcnow(), actor="admin", action="save",
            period_start=start, period_days=payload.period_days, target_date=None,
            before_json=json.dumps(before, ensure_ascii=False), after_json=json.dumps(snapshot, ensure_ascii=False),
        ))
    db.commit()
    return _range_rows_sorted(db, member_id, start, end)


def _range_rows_sorted(db: Session, member_id: int, start: date, end: date):
    return sorted(_range_rows(db, member_id, start, end), key=lambda r: (r.date, r.half))
