# 当直表自動作成ツール — バックエンド (FastAPI + SQLite)

`README_引き継ぎ.md` の「まだできていないこと」のうち、以下を実装済み。

- FastAPIバックエンド一式(members / availability / quota / fixed_slots / schedule_runs / assignments)
- SQLiteでの永続化(SQLAlchemy 2.0)
- `scheduler_prototype.py` のOR-Tools(CP-SAT)ロジックをDB駆動化
- `export_calendar.py` のExcel/PDF出力ロジックをDB駆動化・任意期間に一般化(月単位限定を解消)
- React 3画面(現在は希望入力カレンダー・管理者ページ)をこのAPIに接続(`frontend/` 参照)
- 自動割当の結果に対する手動調整(担当者の入れ替え)API
- 簡易ログイン/メンバー識別(医局員は4桁PIN、管理者は共通パスワード。詳細は下記「認証」参照)

デプロイはまだ未着手です。

## セットアップ

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

起動すると `backend/duty_schedule.db` が自動作成されます。DB接続先を変えたい場合は環境変数 `DATABASE_URL` を設定してください(例: `sqlite:///./duty_schedule.db`、将来PostgreSQLへ移行する場合は `postgresql://...`)。

以前のセッションで作った `duty_schedule.db` が残っている場合、`assignments` テーブルに `manual_override` 列が無いままなので削除してから起動し直してください(`create_all` は既存テーブルへの列追加はしません)。

起動後、`http://127.0.0.1:8000/docs` でSwagger UIから全エンドポイントを試せます。

## PDF出力について

日本語フォントとして `/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf`(Droid Sans Fallback)を優先的に使用します。無ければ `/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf` にフォールバックします。どちらも無い環境では `app/exporter.py` の `_JP_FONT_CANDIDATES` にフォントパスを追加してください。

## 認証(身内向けの簡易な仕組み)

強固なセキュリティは想定していません。同じ部署の人同士が誤って他人のデータを編集してしまうのを防ぐための、簡易な確認です。

- **医局員**: 氏名を選び、4桁の暗証番号(PIN)で本人確認します。PINは初回ログイン時に本人が自由に設定します(管理者が割り振るのではない)。`members.pin_hash` にハッシュ化して保存(`app/auth.py` の `hash_pin`/`verify_pin`)。忘れた場合は管理者が `PATCH /members/{id}/reset-pin` でリセットでき、次回ログイン時に本人が再設定できます。
- **管理者**: 全員共通の1つのパスワードで確認します。環境変数 `ADMIN_PASSWORD`(未設定時のデフォルトは `changeme`。本番運用では必ず変更してください)。`POST /auth/admin/login` で確認だけ行い、トークンは発行しません。フロント側はこのパスワードをそのまま覚えておき、管理系エンドポイントには毎回 `X-Admin-Password` ヘッダーとして添付します。
- 管理者パスワードを忘れた場合は、画面上でのリセット手段はありません。サーバー側で `ADMIN_PASSWORD` を再設定して再起動してください。

管理者権限が必要なエンドポイント(`X-Admin-Password` ヘッダー必須、`Depends(require_admin)`):
`POST/PUT/DELETE /members`(一覧取得の`GET`は誰でも可)、`PATCH /members/{id}/reset-pin`、`PUT /quotas`、`POST/DELETE /fixed-slots`、`POST /schedule/run`、`PATCH /schedule/runs/{id}/assignments/{assignment_id}`。結果の閲覧・出力・候補者取得などの`GET`系は誰でも見られます。

## データモデル

| テーブル | 内容 |
|---|---|
| `members` | 氏名・区分(A=上級医 / B=下級医) |
| `availability` | メンバー×日付×半日(ALL/AM/PM)ごとの「当直不可/オンコール不可」。行が無ければ「可」。 |
| `quotas` | 対象期間(period_start, period_days)×メンバーごとの希望回数(当直/オンコール) |
| `fixed_slots` | 日付×半日×役割(duty/oncall)ごとの事前固定配置 |
| `schedule_runs` | 自動割当を1回実行した記録(対象期間・ソルバーのステータス) |
| `assignments` | 割当結果1枠分。`member_id` が null なら空欄で `unfilled_reason` に理由が入る。`manual_override` は手動調整で変更されたかどうか |

## 主なエンドポイント

- `GET/POST/PUT/DELETE /members`
- `GET /availability` , `PUT /availability/{member_id}` — 期間を丸ごと置き換え
- `GET /quotas` , `PUT /quotas` — 対象期間の希望回数を丸ごと置き換え(upsert)
- `GET/POST/DELETE /fixed-slots`
- `POST /schedule/run` — 自動割当を実行して結果を返す(members/availability/quotas/fixed_slotsを読み、assignmentsに保存)
- `GET /schedule/runs` , `GET /schedule/runs/{id}` — 実行履歴・結果の取得(`has_manual_edits` で手動調整の有無がわかる)
- `GET /schedule/runs/{id}/export.xlsx` , `GET /schedule/runs/{id}/export.pdf` — カレンダー形式で出力
- `GET /schedule/runs/{id}/assignments/{assignment_id}/candidates` — その枠に入れられる候補者一覧(区分・不可設定・連続当直禁止でフィルタ済み。各候補の希望回数に対する過不足も返す)
- `PATCH /schedule/runs/{id}/assignments/{assignment_id}` — その枠の担当者を手動で変更(`member_id: null` で空欄にできる)。ロジックは `app/manual_edit.py` 参照。
- `POST /members/{id}/login` — 氏名+PINでの簡易ログイン(初回はPIN新規設定)
- `PATCH /members/{id}/reset-pin` — 管理者操作。PINを未設定状態に戻す
- `POST /auth/admin/login` — 管理者パスワードの確認のみ(トークン発行なし)

## 動作確認済み

members作成 → availability設定 → quota設定 → fixed_slot設定 → `/schedule/run` 実行(OPTIMAL) → Excel/PDFエクスポート → 候補者取得 → 手動でPATCH → 認証(PIN初回設定/再ログイン/誤PIN拒否、管理者パスワード確認、保護エンドポイントのヘッダーなし/誤り/正しい場合の挙動)、まで一通りcurlで確認済み。フロントエンドからの結合テスト(vitest、10件)でも確認済み。

## 次にやること

1. デプロイ(Render / Fly.io)
2. 任意: Excel/PDFの「メール自動送信」機能(SMTP経由)
