# -*- coding: utf-8 -*-
"""
割当結果のカレンダー形式 Excel 出力(DB駆動版)。

病院側で実際に使っているExcelテンプレート(backend/app/templates/duty_template.xlsx)を
そのまま読み込み、日付ごとのセルと担当回数一覧の値だけを書き込んで返す。
テンプレート側のフォント・罫線・列幅などのスタイルは一切変更しない(値のみ設定)。

テンプレートのレイアウト(「カレンダー」シート):
  - 1〜28行目: 日曜始まりの週グリッド(最大6週分)。各曜日は3列一組
    [氏名(当直)列, 区切り"/"列, 氏名(オンコール)列] で構成され、
    土日祝はAM/PM 2行、平日はAM相当の1行のみを使う。
  - 30行目以降: 担当回数一覧。氏名 / 実:当直・OC / 希望:当直・OC / 希望合計 / 実合計、
    および右側に上級医・下級医別の希望合計の内訳ボックス。
"""
import io
import os
from copy import copy
from datetime import date, timedelta

import openpyxl
from openpyxl.styles import Font
from sqlalchemy.orm import Session

from . import models
from .holidays import HOLIDAYS
from .scheduler import build_periods

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "templates", "duty_template.xlsx")
SHEET_NAME = "カレンダー"

WEEKDAY_BASE_COL = 2  # B列 = 日曜列の先頭
DAY_BLOCK_ROWS = [5, 9, 13, 17, 21, 25]  # テンプレートに用意された6週分の「日付」行
TALLY_HEADER_ROW = 30
TALLY_MEMBER_START_ROW = 31
TALLY_CLEAR_MAX_ROW = 80  # 担当回数一覧エリアをクリアする際の安全マージン込みの上限行

RED = "FFFF0000"
BLUE = "FF0070C0"


def _set_font_color(cell, rgb):
    f = cell.font
    cell.font = Font(name=f.name, size=f.size, bold=f.bold, italic=f.italic, color=rgb)


def _week_index_and_weekday(d: date, first_sunday: date):
    delta = (d - first_sunday).days
    return delta // 7, delta % 7


def _clear(ws, row, col):
    # openpyxl の ws.cell(row, col, value=None) は「値未指定」扱いになり実際にはクリアされないため、
    # 明示的に .value に None を代入する。
    ws.cell(row=row, column=col).value = None


def _clear_calendar_body(ws):
    for base_row in DAY_BLOCK_ROWS:
        for wd in range(7):
            col = WEEKDAY_BASE_COL + wd * 3
            for r in (base_row, base_row + 1, base_row + 2):
                _clear(ws, r, col)
                _clear(ws, r, col + 2)


def _clear_tally_body(ws):
    for r in range(TALLY_MEMBER_START_ROW, TALLY_CLEAR_MAX_ROW):
        for c in (7, 8, 9, 10, 11, 12, 13, 14, 16):  # G,H,I,J,K,L,M,N,P
            _clear(ws, r, c)
    # 内訳ボックス(Q/S列)のラベル・値もクリア
    for r in (TALLY_HEADER_ROW, TALLY_HEADER_ROW + 1, TALLY_HEADER_ROW + 3, TALLY_HEADER_ROW + 4):
        _clear(ws, r, 17)  # Q
        _clear(ws, r, 19)  # S


def _collect_export_data(db: Session, run: models.ScheduleRun):
    end_date = run.start_date + timedelta(days=run.days - 1)
    members = {m.id: m for m in db.query(models.Member).all()}

    by_date_half = {}
    tally = {m.id: {"duty": 0, "oncall": 0} for m in members.values()}
    for a in run.assignments:
        by_date_half.setdefault(a.date, {})[(a.half, a.role)] = a
        if a.member_id in tally:
            tally[a.member_id][a.role] += 1

    quota_rows = (
        db.query(models.Quota)
        .filter(models.Quota.period_start == run.start_date, models.Quota.period_days == run.days)
        .all()
    )
    quota_by_member = {q.member_id: q for q in quota_rows}

    return end_date, members, by_date_half, tally, quota_by_member


def export_xlsx(db: Session, run: models.ScheduleRun) -> io.BytesIO:
    end_date, members, by_date_half, tally, quota_by_member = _collect_export_data(db, run)

    wb = openpyxl.load_workbook(TEMPLATE_PATH)
    ws = wb[SHEET_NAME]

    ws["A1"] = f"{run.start_date.year}年"
    ws["B1"] = f"{run.start_date.month}月"

    _clear_calendar_body(ws)
    _clear_tally_body(ws)

    # --- カレンダー本体 ---
    first_sunday = run.start_date - timedelta(days=(run.start_date.weekday() + 1) % 7)
    d = run.start_date
    while d <= end_date:
        week_idx, wd = _week_index_and_weekday(d, first_sunday)
        if week_idx < len(DAY_BLOCK_ROWS):
            base_row = DAY_BLOCK_ROWS[week_idx]
            col = WEEKDAY_BASE_COL + wd * 3

            daynum_cell = ws.cell(row=base_row, column=col, value=d.day)
            if d.weekday() == 6 or d in HOLIDAYS:
                _set_font_color(daynum_cell, RED)
            elif d.weekday() == 5:
                _set_font_color(daynum_cell, BLUE)

            slot = by_date_half.get(d, {})
            has_am_pm = any(key[0] in ("AM", "PM") for key in slot)
            halves = ["AM", "PM"] if has_am_pm else ["ALL"]
            for i, half in enumerate(halves):
                r = base_row + 1 + i
                duty_a = slot.get((half, "duty"))
                oncall_a = slot.get((half, "oncall"))
                dn = "" if duty_a is None else (members[duty_a.member_id].name if duty_a.member_id in members else "―")
                on = "" if oncall_a is None else (members[oncall_a.member_id].name if oncall_a.member_id in members else "―")
                ws.cell(row=r, column=col, value=dn or None)
                ws.cell(row=r, column=col + 1, value="/")
                ws.cell(row=r, column=col + 2, value=on or None)
        d += timedelta(days=1)

    # --- 担当回数一覧 ---
    # is_active が未設定(None)の古いデータは「在籍中」扱いにする(他画面と同じ挙動)
    active_members = [m for m in members.values() if m.is_active is not False]
    # sort_order が未設定(None)のメンバーがいても比較エラーにならないよう 0 扱いにする
    active_members.sort(key=lambda m: (0 if m.rank == "A" else 1, m.sort_order or 0, m.id))
    seniors = [m for m in active_members if m.rank == "A"]
    juniors = [m for m in active_members if m.rank == "B"]

    for i, m in enumerate(active_members):
        r = TALLY_MEMBER_START_ROW + i
        ws.cell(row=r, column=7, value=m.name)  # G 氏名
        ws.cell(row=r, column=8, value=tally[m.id]["duty"])  # H 実:当直
        ws.cell(row=r, column=9, value="/")  # I
        ws.cell(row=r, column=10, value=quota_by_member[m.id].duty_quota if m.id in quota_by_member else 0)  # J 希望:当直
        ws.cell(row=r, column=11, value=tally[m.id]["oncall"])  # K 実:オンコール
        ws.cell(row=r, column=12, value="/")  # L
        ws.cell(row=r, column=13, value=quota_by_member[m.id].oncall_quota if m.id in quota_by_member else 0)  # M 希望:オンコール
        ws.cell(row=r, column=14, value=f"=SUM(J{r},M{r})")  # N 希望合計
        ws.cell(row=r, column=16, value=f"=SUM(H{r},K{r})")  # P 実合計

    total_row = TALLY_MEMBER_START_ROW + len(active_members)
    ws.cell(row=total_row, column=7, value="total")
    ws.cell(row=total_row, column=9, value="/")
    if active_members:
        ws.cell(row=total_row, column=10, value=f"=SUM(J{TALLY_MEMBER_START_ROW}:J{total_row - 1})")
        ws.cell(row=total_row, column=13, value=f"=SUM(M{TALLY_MEMBER_START_ROW}:M{total_row - 1})")
    ws.cell(row=total_row, column=12, value="/")

    necessary_row = total_row + 1
    required_slots = len(build_periods(run.start_date, run.days))
    ws.cell(row=necessary_row, column=7, value="必要数")
    ws.cell(row=necessary_row, column=10, value=required_slots)
    ws.cell(row=necessary_row, column=13, value=required_slots)

    # 上級医/下級医別の希望合計 内訳ボックス(Q/S列)
    ws.cell(row=TALLY_HEADER_ROW, column=17, value="下　当直")
    ws.cell(row=TALLY_HEADER_ROW, column=19, value="上　当直")
    ws.cell(row=TALLY_HEADER_ROW + 3, column=17, value="下　OC")
    ws.cell(row=TALLY_HEADER_ROW + 3, column=19, value="上　OC")

    if seniors:
        s_start, s_end = TALLY_MEMBER_START_ROW, TALLY_MEMBER_START_ROW + len(seniors) - 1
        ws.cell(row=TALLY_MEMBER_START_ROW, column=19, value=f"=SUM(J{s_start}:J{s_end})")
        ws.cell(row=TALLY_HEADER_ROW + 4, column=19, value=f"=SUM(M{s_start}:M{s_end})")
    if juniors:
        j_start = TALLY_MEMBER_START_ROW + len(seniors)
        j_end = j_start + len(juniors) - 1
        ws.cell(row=TALLY_MEMBER_START_ROW, column=17, value=f"=SUM(J{j_start}:J{j_end})")
        ws.cell(row=TALLY_HEADER_ROW + 4, column=17, value=f"=SUM(M{j_start}:M{j_end})")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
