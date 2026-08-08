# -*- coding: utf-8 -*-
"""
身内向けの簡易な本人確認。

- 医局員: 氏名を選び、4桁の暗証番号(PIN)を入力する。初回はその場でPINを新規設定する。
  第三者からの完全な防御は想定しておらず、同じ医局のメンバー同士での誤操作・なりすまし防止が目的。
- 管理者: 医局で1つ共有する管理者パスワード(環境変数 ADMIN_PASSWORD)。
  リクエストヘッダー X-Admin-Password で照合する(トークン発行はしないシンプルな方式)。
"""
import hashlib
import hmac
import os

from fastapi import Header, HTTPException

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "changeme")


def hash_pin(member_id: int, pin: str) -> str:
    return hashlib.sha256(f"member:{member_id}:{pin}".encode("utf-8")).hexdigest()


def verify_pin(member_id: int, pin: str, pin_hash: str) -> bool:
    return hmac.compare_digest(hash_pin(member_id, pin), pin_hash)


def require_admin(x_admin_password: str = Header(default="")):
    if not hmac.compare_digest(x_admin_password or "", ADMIN_PASSWORD):
        raise HTTPException(401, "管理者パスワードが正しくありません")
