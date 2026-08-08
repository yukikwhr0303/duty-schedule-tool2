from typing import List, Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import require_admin

router = APIRouter(prefix="/fixed-slots", tags=["fixed-slots"])


@router.get("", response_model=List[schemas.FixedSlotOut])
def list_fixed_slots(
    start: Optional[date] = Query(None), end: Optional[date] = Query(None), db: Session = Depends(get_db)
):
    q = db.query(models.FixedSlot)
    if start is not None:
        q = q.filter(models.FixedSlot.date >= start)
    if end is not None:
        q = q.filter(models.FixedSlot.date <= end)
    return q.order_by(models.FixedSlot.date, models.FixedSlot.half).all()


@router.post("", response_model=schemas.FixedSlotOut, status_code=201, dependencies=[Depends(require_admin)])
def create_fixed_slot(payload: schemas.FixedSlotCreate, db: Session = Depends(get_db)):
    member = db.get(models.Member, payload.member_id)
    if not member:
        raise HTTPException(400, "unknown member_id")

    existing = (
        db.query(models.FixedSlot)
        .filter(
            models.FixedSlot.date == payload.date,
            models.FixedSlot.half == payload.half,
            models.FixedSlot.role == payload.role,
        )
        .first()
    )
    if existing:
        existing.member_id = payload.member_id
        db.commit()
        db.refresh(existing)
        return existing

    row = models.FixedSlot(date=payload.date, half=payload.half, role=payload.role, member_id=payload.member_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{fixed_slot_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_fixed_slot(fixed_slot_id: int, db: Session = Depends(get_db)):
    row = db.get(models.FixedSlot, fixed_slot_id)
    if not row:
        raise HTTPException(404, "fixed slot not found")
    db.delete(row)
    db.commit()
    return None
