from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import require_admin

router = APIRouter(prefix="/ng-pairs", tags=["ng-pairs"])


def _to_out(row: models.NgPair) -> schemas.NgPairOut:
    return schemas.NgPairOut(
        id=row.id,
        member_a_id=row.member_a_id,
        member_a_name=row.member_a.name if row.member_a else "",
        member_b_id=row.member_b_id,
        member_b_name=row.member_b.name if row.member_b else "",
    )


@router.get("", response_model=List[schemas.NgPairOut])
def list_ng_pairs(db: Session = Depends(get_db)):
    rows = db.query(models.NgPair).all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=schemas.NgPairOut, status_code=201, dependencies=[Depends(require_admin)])
def create_ng_pair(payload: schemas.NgPairCreate, db: Session = Depends(get_db)):
    if payload.member_a_id == payload.member_b_id:
        raise HTTPException(400, "同じメンバー同士はNGペアにできません")
    a_id, b_id = sorted([payload.member_a_id, payload.member_b_id])

    for mid in (a_id, b_id):
        if not db.get(models.Member, mid):
            raise HTTPException(404, f"member not found: {mid}")

    existing = (
        db.query(models.NgPair)
        .filter(models.NgPair.member_a_id == a_id, models.NgPair.member_b_id == b_id)
        .first()
    )
    if existing:
        return _to_out(existing)

    row = models.NgPair(member_a_id=a_id, member_b_id=b_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/{pair_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_ng_pair(pair_id: int, db: Session = Depends(get_db)):
    row = db.get(models.NgPair, pair_id)
    if not row:
        raise HTTPException(404, "ng pair not found")
    db.delete(row)
    db.commit()
    return None
