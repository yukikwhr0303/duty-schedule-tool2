from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import require_admin, hash_pin, verify_pin

router = APIRouter(prefix="/members", tags=["members"])


@router.get("", response_model=List[schemas.MemberOut])
def list_members(db: Session = Depends(get_db)):
    return db.query(models.Member).order_by(models.Member.sort_order, models.Member.id).all()


@router.post("", response_model=schemas.MemberOut, status_code=201, dependencies=[Depends(require_admin)])
def create_member(payload: schemas.MemberCreate, db: Session = Depends(get_db)):
    max_order = db.query(func.max(models.Member.sort_order)).scalar() or 0
    m = models.Member(name=payload.name, rank=payload.rank, sort_order=max_order + 1)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


@router.put("/{member_id}", response_model=schemas.MemberOut, dependencies=[Depends(require_admin)])
def update_member(member_id: int, payload: schemas.MemberUpdate, db: Session = Depends(get_db)):
    m = db.get(models.Member, member_id)
    if not m:
        raise HTTPException(404, "member not found")
    if payload.name is not None:
        m.name = payload.name
    if payload.rank is not None:
        m.rank = payload.rank
    if payload.is_active is not None:
        m.is_active = payload.is_active
    db.commit()
    db.refresh(m)
    return m


@router.patch("/reorder", response_model=List[schemas.MemberOut], dependencies=[Depends(require_admin)])
def reorder_members(payload: schemas.MemberReorderRequest, db: Session = Depends(get_db)):
    """渡された member_ids の並び順どおりに sort_order を振り直す(1始まり)。"""
    members = {m.id: m for m in db.query(models.Member).filter(models.Member.id.in_(payload.member_ids)).all()}
    missing = set(payload.member_ids) - set(members)
    if missing:
        raise HTTPException(400, f"unknown member_id(s): {sorted(missing)}")
    for i, mid in enumerate(payload.member_ids):
        members[mid].sort_order = i + 1
    db.commit()
    return db.query(models.Member).order_by(models.Member.sort_order, models.Member.id).all()


@router.delete("/{member_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_member(member_id: int, db: Session = Depends(get_db)):
    m = db.get(models.Member, member_id)
    if not m:
        raise HTTPException(404, "member not found")
    db.delete(m)
    db.commit()
    return None


@router.post("/{member_id}/login", response_model=schemas.MemberLoginResult)
def member_login(member_id: int, payload: schemas.MemberLoginRequest, db: Session = Depends(get_db)):
    """氏名選択+4桁PINでの簡易ログイン。PIN未設定の場合はこのリクエストで新規設定する。
    身内向けの簡易な本人確認であり、強固な認証は想定していない。"""
    m = db.get(models.Member, member_id)
    if not m:
        raise HTTPException(404, "member not found")

    if m.pin_hash is None:
        m.pin_hash = hash_pin(member_id, payload.pin)
        db.commit()
        db.refresh(m)
        return schemas.MemberLoginResult(member=m, created_pin=True)

    if not verify_pin(member_id, payload.pin, m.pin_hash):
        raise HTTPException(401, "暗証番号が正しくありません")
    return schemas.MemberLoginResult(member=m, created_pin=False)


@router.patch("/{member_id}/reset-pin", response_model=schemas.MemberOut, dependencies=[Depends(require_admin)])
def reset_member_pin(member_id: int, db: Session = Depends(get_db)):
    """管理者操作: 本人が暗証番号を忘れた場合にリセットする(次回ログイン時に再設定できるようになる)。"""
    m = db.get(models.Member, member_id)
    if not m:
        raise HTTPException(404, "member not found")
    m.pin_hash = None
    db.commit()
    db.refresh(m)
    return m
