from typing import List
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import require_admin

router = APIRouter(prefix="/quotas", tags=["quotas"])


@router.get("", response_model=List[schemas.QuotaOut])
def list_quotas(period_start: date, period_days: int, db: Session = Depends(get_db)):
    return (
        db.query(models.Quota)
        .filter(models.Quota.period_start == period_start, models.Quota.period_days == period_days)
        .all()
    )


@router.put("", response_model=List[schemas.QuotaOut], dependencies=[Depends(require_admin)])
def replace_quotas(payload: schemas.QuotaReplaceRequest, db: Session = Depends(get_db)):
    """対象期間(period_start, period_days)のメンバー別希望回数を丸ごと置き換える(upsert)。"""
    member_ids = [it.member_id for it in payload.items]
    existing_members = {
        m.id for m in db.query(models.Member.id).filter(models.Member.id.in_(member_ids)).all()
    }
    missing = set(member_ids) - existing_members
    if missing:
        raise HTTPException(400, f"unknown member_id(s): {sorted(missing)}")

    db.query(models.Quota).filter(
        models.Quota.period_start == payload.period_start,
        models.Quota.period_days == payload.period_days,
    ).delete()

    rows = []
    for it in payload.items:
        row = models.Quota(
            member_id=it.member_id,
            period_start=payload.period_start,
            period_days=payload.period_days,
            duty_quota=it.duty_quota,
            oncall_quota=it.oncall_quota,
        )
        db.add(row)
        rows.append(row)

    db.commit()
    return (
        db.query(models.Quota)
        .filter(models.Quota.period_start == payload.period_start, models.Quota.period_days == payload.period_days)
        .all()
    )
