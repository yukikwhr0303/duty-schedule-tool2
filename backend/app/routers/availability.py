from typing import List, Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/availability", tags=["availability"])


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
def replace_availability(member_id: int, payload: schemas.AvailabilityReplaceRequest, db: Session = Depends(get_db)):
    """指定期間 [start, end] のそのメンバーの不可設定を、送られてきた entries で丸ごと置き換える。
    医局員用カレンダー画面が「不可の枠だけ」を保持する仕様に合わせ、
    entries に含まれない日は「可」として扱われる(=行が存在しない)。"""
    member = db.get(models.Member, member_id)
    if not member:
        raise HTTPException(404, "member not found")
    if payload.end < payload.start:
        raise HTTPException(400, "end must be >= start")

    db.query(models.Availability).filter(
        models.Availability.member_id == member_id,
        models.Availability.date >= payload.start,
        models.Availability.date <= payload.end,
    ).delete()

    created = []
    for e in payload.entries:
        if not (payload.start <= e.date <= payload.end):
            raise HTTPException(400, f"entry date {e.date} is outside [{payload.start}, {payload.end}]")
        if not e.duty_ng and not e.oncall_ng:
            continue  # 全部可は保存不要
        row = models.Availability(
            member_id=member_id, date=e.date, half=e.half, duty_ng=e.duty_ng, oncall_ng=e.oncall_ng
        )
        db.add(row)
        created.append(row)

    db.commit()
    for row in created:
        db.refresh(row)
    return db.query(models.Availability).filter(
        models.Availability.member_id == member_id,
        models.Availability.date >= payload.start,
        models.Availability.date <= payload.end,
    ).order_by(models.Availability.date, models.Availability.half).all()
