# -*- coding: utf-8 -*-
"""
割当結果のカレンダー形式 Excel/PDF 出力(DB駆動版)。export_calendar.py のレイアウトを踏襲しつつ、
月単位ではなく任意の対象期間(start_date 〜 start_date+days-1)を日曜始まりの週グリッドで描画できるよう一般化した。
上級医/下級医の表記はカレンダー上には出さない。
"""
import io
import os
from datetime import date, timedelta

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from sqlalchemy.orm import Session

from . import models
from .holidays import HOLIDAYS

WD_LABELS = ["日", "月", "火", "水", "木", "金", "土"]

_JP_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
]
_pdf_font_registered = False


def _ensure_pdf_font():
    global _pdf_font_registered
    if _pdf_font_registered:
        return
    font_path = next((p for p in _JP_FONT_CANDIDATES if os.path.exists(p)), None)
    if font_path is None:
        raise RuntimeError("日本語フォントが見つかりません。JP_FONT_PATH を確認してください。")
    pdfmetrics.registerFont(TTFont("JPFont", font_path))
    pdfmetrics.registerFont(TTFont("JPFontBold", font_path))
    _pdf_font_registered = True


def _build_week_grid(start_date: date, end_date: date):
    """start_date〜end_date を含む、日曜始まりの週の配列を返す(範囲外の日は None)。"""
    first_sunday = start_date - timedelta(days=(start_date.weekday() + 1) % 7)
    last_saturday = end_date + timedelta(days=(5 - end_date.weekday()) % 7)
    weeks = []
    d = first_sunday
    while d <= last_saturday:
        week = []
        for _ in range(7):
            week.append(d if start_date <= d <= end_date else None)
            d += timedelta(days=1)
        weeks.append(week)
    return weeks


def _collect_data(db: Session, run: models.ScheduleRun):
    end_date = run.start_date + timedelta(days=run.days - 1)
    members = {m.id: m for m in db.query(models.Member).all()}

    day_lines = {}  # date -> [line, ...] (ALLなら1行、AM/PMなら2行)
    tally = {m.id: {"duty": 0, "oncall": 0} for m in members.values()}

    by_date_half = {}
    for a in run.assignments:
        by_date_half.setdefault((a.date, a.half), {})[a.role] = a
        if a.member_id in tally:
            tally[a.member_id][a.role] += 1

    d = run.start_date
    while d <= end_date:
        halves = ["AM", "PM"] if (d, "AM") in by_date_half or (d, "PM") in by_date_half else ["ALL"]
        lines = []
        for half in halves:
            slot = by_date_half.get((d, half), {})
            duty_a = slot.get("duty")
            oncall_a = slot.get("oncall")
            dn = members[duty_a.member_id].name if duty_a and duty_a.member_id in members else "―"
            on = members[oncall_a.member_id].name if oncall_a and oncall_a.member_id in members else "―"
            lines.append(f"{dn} / {on}")
        day_lines[d] = lines
        d += timedelta(days=1)

    return end_date, members, day_lines, tally


def export_xlsx(db: Session, run: models.ScheduleRun) -> io.BytesIO:
    end_date, members, day_lines, tally = _collect_data(db, run)
    weeks = _build_week_grid(run.start_date, end_date)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "当直表"

    FONT_NAME = "Yu Gothic"
    sun_font = Font(name=FONT_NAME, color="C0392B", bold=True, size=12)
    sat_font = Font(name=FONT_NAME, color="2A5FA0", bold=True, size=12)
    header_font = Font(name=FONT_NAME, bold=True, size=12)
    pair_font = Font(name=FONT_NAME, size=10)
    sun_fill = PatternFill("solid", fgColor="FBE9E9")
    sat_fill = PatternFill("solid", fgColor="E8EBF3")
    thin = Side(style="thin", color="999999")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    title = f"{run.start_date:%Y/%m/%d} 〜 {end_date:%Y/%m/%d} 当直・オンコール表"
    ws.cell(row=1, column=1, value=title).font = Font(name=FONT_NAME, bold=True, size=14)

    header_row = 3
    for i, label in enumerate(WD_LABELS):
        c = ws.cell(row=header_row, column=i + 1, value=label)
        c.font = sun_font if i == 0 else (sat_font if i == 6 else header_font)
        c.alignment = Alignment(horizontal="center")
        c.border = border

    ROW_HEIGHT = 70
    COL_WIDTH = 17
    for i in range(7):
        ws.column_dimensions[get_column_letter(i + 1)].width = COL_WIDTH

    row_cursor = header_row + 1
    for week in weeks:
        ws.row_dimensions[row_cursor].height = ROW_HEIGHT
        for i, d in enumerate(week):
            cell = ws.cell(row=row_cursor, column=i + 1)
            cell.border = border
            cell.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
            cell.font = pair_font
            if d is None:
                continue
            lines = day_lines.get(d, ["/"])
            holiday_name = HOLIDAYS.get(d, "")
            day_label = f"{d.day}" + (f" {holiday_name}" if holiday_name else "")
            cell.value = day_label + "\n" + "\n".join(lines)

            is_red = (d.weekday() == 6) or (d in HOLIDAYS)
            is_sat = d.weekday() == 5
            if is_red:
                cell.fill = sun_fill
            elif is_sat:
                cell.fill = sat_fill
        row_cursor += 1

    sum_start_row = row_cursor + 2
    ws.cell(row=sum_start_row, column=1, value="担当回数一覧").font = Font(name=FONT_NAME, bold=True, size=12)
    headers2 = ["氏名", "当直", "オンコール", "合計"]
    for i, h in enumerate(headers2):
        c = ws.cell(row=sum_start_row + 1, column=i + 1, value=h)
        c.font = Font(name=FONT_NAME, bold=True, size=10.5, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1E1E1E")
        c.alignment = Alignment(horizontal="center")
        c.border = border

    for i, m in enumerate(members.values()):
        r = sum_start_row + 2 + i
        duty_n = tally[m.id]["duty"]
        oncall_n = tally[m.id]["oncall"]
        values = [m.name, duty_n, oncall_n, duty_n + oncall_n]
        for c_idx, v in enumerate(values, start=1):
            cell = ws.cell(row=r, column=c_idx, value=v)
            cell.font = Font(name=FONT_NAME, size=10.5)
            cell.alignment = Alignment(horizontal="center")
            cell.border = border

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def export_pdf(db: Session, run: models.ScheduleRun) -> io.BytesIO:
    _ensure_pdf_font()
    end_date, members, day_lines, tally = _collect_data(db, run)
    weeks = _build_week_grid(run.start_date, end_date)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=10 * mm, bottomMargin=10 * mm
    )

    title_style = ParagraphStyle("title", fontName="JPFontBold", fontSize=15)
    cell_style = ParagraphStyle("cell", fontName="JPFont", fontSize=8, leading=11)
    daynum_style_normal = ParagraphStyle("daynum", fontName="JPFontBold", fontSize=10, textColor=colors.HexColor("#1E1E1E"))
    daynum_style_red = ParagraphStyle("daynum_r", fontName="JPFontBold", fontSize=10, textColor=colors.HexColor("#C0392B"))
    daynum_style_sat = ParagraphStyle("daynum_s", fontName="JPFontBold", fontSize=10, textColor=colors.HexColor("#2A5FA0"))

    story = []
    story.append(Paragraph(f"{run.start_date:%Y/%m/%d} 〜 {end_date:%Y/%m/%d}　当直・オンコール表", title_style))
    story.append(Spacer(1, 6))

    table_data = [WD_LABELS]
    for week in weeks:
        row_cells = []
        for d in week:
            if d is None:
                row_cells.append("")
                continue
            holiday_name = HOLIDAYS.get(d, "")
            is_red = d.weekday() == 6 or d in HOLIDAYS
            is_sat = d.weekday() == 5
            dstyle = daynum_style_red if is_red else (daynum_style_sat if is_sat else daynum_style_normal)
            day_label = f"{d.day}" + (f" {holiday_name}" if holiday_name else "")
            lines = day_lines.get(d, ["/"])
            content = [Paragraph(day_label, dstyle)]
            for ln in lines:
                content.append(Paragraph(ln, cell_style))
            row_cells.append(content)
        table_data.append(row_cells)

    col_w = (landscape(A4)[0] - 20 * mm) / 7
    row_heights = [8 * mm] + [26 * mm] * len(weeks)
    t = Table(table_data, colWidths=[col_w] * 7, rowHeights=row_heights)

    style_cmds = [
        ("FONTNAME", (0, 0), (-1, 0), "JPFontBold"),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E1E1E")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#999999")),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]
    for wi, week in enumerate(weeks, start=1):
        for i, d in enumerate(week):
            if d is None:
                continue
            is_red = d.weekday() == 6 or d in HOLIDAYS
            is_sat = d.weekday() == 5
            if is_red:
                style_cmds.append(("BACKGROUND", (i, wi), (i, wi), colors.HexColor("#FBE9E9")))
            elif is_sat:
                style_cmds.append(("BACKGROUND", (i, wi), (i, wi), colors.HexColor("#E8EBF3")))

    t.setStyle(TableStyle(style_cmds))
    story.append(t)
    story.append(Spacer(1, 10))

    tally_data = [["氏名", "当直", "オンコール", "合計"]]
    for m in members.values():
        duty_n = tally[m.id]["duty"]
        oncall_n = tally[m.id]["oncall"]
        tally_data.append([m.name, str(duty_n), str(oncall_n), str(duty_n + oncall_n)])

    t2 = Table(tally_data, colWidths=[40 * mm, 25 * mm, 30 * mm, 25 * mm])
    t2.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), "JPFont"),
                ("FONTNAME", (0, 0), (-1, 0), "JPFontBold"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E1E1E")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
            ]
        )
    )
    story.append(
        KeepTogether(
            [
                Paragraph("担当回数一覧", ParagraphStyle("h2", fontName="JPFontBold", fontSize=12)),
                Spacer(1, 4),
                t2,
            ]
        )
    )

    doc.build(story)
    buf.seek(0)
    return buf
