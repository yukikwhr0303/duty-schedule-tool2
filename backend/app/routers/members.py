from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import require_admin, hash_pin, verify_pin

router = APIRouter(prefix="/members", tags=["members"])


@router.get("", response_model=List[schemas.MemberOut])
def list_members(db: Session = Depends(get_db)):
    return db.query(models.Member).order_by(models.Member.id).all()


@router.post("", response_model=schemas.MemberOut, status_code=201, dependencies=[Depends(require_admin)])
def create_member(payload: schemas.MemberCreate, db: Session = Depends(get_db)):
    m = models.Member(name=payload.name, rank=payload.rank)
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
    db.commit()
    db.refresh(m)
    return m


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
