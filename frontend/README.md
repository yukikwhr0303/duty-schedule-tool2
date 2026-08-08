# 当直表自動作成ツール — フロントエンド (React + Vite)

`backend/` のFastAPIに接続済みのReactアプリです。ダミーstateではなく実際にデータが保存され、画面をリロードしても消えません。

## セットアップ

```bash
cd frontend
npm install
cp .env.example .env   # 接続先バックエンドのURLを設定(デフォルトは http://localhost:8000)
npm run dev
```

別ターミナルで `backend/` を起動しておく必要があります(`backend/README.md` 参照)。

## 画面構成

`src/App.jsx` に上部タブが2つあります。

| タブ | コンポーネント | 内容 |
|---|---|---|
| 希望入力 | `src/MemberLoginGate.jsx` → `src/DutyCalendar.jsx` | 医局員用: 氏名+PINでログイン後、当直・オンコール希望入力(カレンダー) |
| 管理者用 | `src/AdminLoginGate.jsx` → `src/AdminPage.jsx` | 管理者パスワードでログイン後、管理者用の3セクションを1ページにまとめたもの(下記) |

`AdminPage.jsx` は上部のミニナビ(タブ切り替えではなく同ページ内スクロール)で3セクションを行き来します。

| セクション | コンポーネント | 内容 | 接続先API |
|---|---|---|---|
| メンバー管理 | `src/MemberManagement.jsx` | 氏名・上級医(A)/下級医(B)の登録・PINリセット | `GET/POST/PUT/DELETE /members` |
| 個人の希望表 | `src/MemberAvailabilityViewer.jsx` | メンバーを選んで希望表を閲覧。「編集する」を押す(確認あり)と本人に代わって編集も可能 | `GET /availability` , `PUT /availability/{member_id}` |
| 希望回数設定 | `src/QuotaSetting.jsx` | メンバー別の当直・オンコール希望回数 | `GET/PUT /quotas` |
| 自動割当・結果 | `src/ScheduleRunPanel.jsx` | スタート実行・実行履歴・結果カレンダー・Excel/PDF出力・手動調整 | `POST /schedule/run` 他 |

対象期間の選び方(対象月が基本、オプションで日単位)は `src/PeriodPicker.jsx` として共通化し、希望回数設定と自動割当・結果の両方で使っています。祝日データや期間計算のロジックは `src/holidays.js` に集約しています。

`src/api.js` に共通のfetchラッパーをまとめています。

## ログイン(今回追加、身内向けの簡易な仕組み)

- **医局員** (`src/MemberLoginGate.jsx`): 氏名を選び、4桁PINで本人確認します。初めての人はここで新しくPINを設定します(`POST /members/{id}/login`)。ログイン中の氏名は `localStorage`(`duty_member_session`)に保存され、次回アクセス時も自動的にログイン状態になります。ログアウトボタンで解除できます。
- **管理者** (`src/AdminLoginGate.jsx`): 全員共通の1つのパスワードでログインします(`POST /auth/admin/login`)。成功するとパスワードそのものを `localStorage`(`duty_admin_password`)に保存し、以降の管理系API呼び出しには `src/api.js` が自動的に `X-Admin-Password` ヘッダーを付けます。管理者用の画面はこれを経由しないと開けません。
- PINを忘れた医局員は、管理者に「メンバー管理」画面の鍵アイコン(PINリセット)を押してもらうと、次回ログイン時に新しいPINを再設定できます。管理者パスワードを忘れた場合は画面上のリセット手段はなく、サーバー側の環境変数 `ADMIN_PASSWORD` を変更してもらう必要があります。
- 強固なセキュリティ機構(トークン失効・レート制限など)は意図的に入れていません。同じ部署の人同士の誤操作防止が目的です。

## 希望入力画面の締切表示・一括不可(今回追加)

- `src/deadline.js`: ある対象月の希望は「前月の第1月曜日〜同じ週の金曜12:00」が募集期間、というルールを計算するユーティリティ。表示中の月に応じて「受付開始前 / 締切まであとN日 / 本日◯時まで / 締切済み」をバナー表示します(締切を過ぎても入力自体はロックしません)。
- 「この月をすべて不可にする」ボタン: 表示中の月の当直・オンコールを一括で不可にします(確認ダイアログあり)。可能な日がほとんどない月に、1日ずつ不可を押す手間を省くためのものです。「全部可に戻す」でまとめて戻せます。

## 自動割当・結果画面

- 対象期間を選んで「スタート」を押すと `POST /schedule/run` を呼び、結果を表示します。
- 実行履歴は `GET /schedule/runs` で全件取得し、一覧から過去の結果をいつでも見返せます(クリックで `GET /schedule/runs/{id}` を再取得)。
- 結果カレンダーの担当者名をタップすると、差し替え候補が一覧表示されます(`GET /schedule/runs/{id}/assignments/{assignment_id}/candidates`)。候補は「同じ区分(上級医/下級医)」「その日その役割が不可でない」「当直の場合は前後の当直と被らない」人だけに絞り込まれ、それぞれ希望回数に対して「アンダー(緑)/ちょうど/オーバー(赤)」の色分きで表示されます。選ぶと即座に `PATCH .../assignments/{assignment_id}` で保存されます。
- Excel/PDF出力ボタンは `GET /schedule/runs/{id}/export.xlsx` / `.pdf` にリンクしています。

## テスト

`vitest` + `@testing-library/react` による結合テストを用意しています。実際に起動しているバックエンドに対して、モックなしで本物のHTTPリクエストを送って確認します。

```bash
# 別ターミナルでバックエンドを起動した状態で
npm test
```

現在13件のテストがあり、すべて成功を確認済みです(メンバー追加・A/B切り替え・希望回数の月単位/日単位保存・希望入力保存・自動割当の実行と手動調整・管理者ページの統合・管理者ログインゲート・医局員ログインゲート・PINリセット・締切バナー表示・月一括不可/一括可・個人の希望表の閲覧と代理編集)。テスト内では `src/api.js` の `setAdminPassword()` / `clearAdminPassword()` / `clearMemberSession()` を使ってログイン状態を直接操作しています。

## 次にやること

- デプロイ(Render / Fly.io): フロントを静的ビルドしてホスティングし、`VITE_API_BASE` を本番バックエンドのURLに設定
- 任意: Excel/PDFの「メール自動送信」機能(SMTP経由)
