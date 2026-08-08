from fastapi import APIRouter, HTTPException
import hmac

from .. import schemas
from ..auth import ADMIN_PASSWORD

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/admin/login")
def admin_login(payload: schemas.AdminLoginRequest):
    """管理者パスワードを確認するだけのエンドポイント。トークンは発行せず、
    フロント側はこのパスワードをそのまま覚えておいて X-Admin-Password ヘッダーで送る簡易方式。"""
    if not hmac.compare_digest(payload.password or "", ADMIN_PASSWORD):
        raise HTTPException(401, "管理者パスワードが正しくありません")
    return {"ok": True}
