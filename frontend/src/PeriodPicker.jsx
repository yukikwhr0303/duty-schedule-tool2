import React, { useState, useMemo, useEffect } from "react";
import { CalendarRange, ChevronRight } from "lucide-react";
import { YEAR_OPTIONS, countPeriods, daysBetweenInclusive } from "./holidays";
import { periodsOfYear, periodRange, periodLabel, monthPeriod, nyPeriod } from "./periods";

const WD = ["日", "月", "火", "水", "木", "金", "土"];

// 対象期間の選択UI。基本は「対象月」(年・月)、オプションで「開始日〜終了日」を
// 日単位で指定できる。対象月を変更すると日単位の指定は必ずリセットされる。
// 有効な期間(start, days)が変わるたびに onChange({ start, end, days, requiredSlots, valid }) を呼ぶ。
export default function PeriodPicker({ onChange, defaultYear, defaultMonth }) {
  const today = new Date();
  const [year, setYear] = useState(defaultYear ?? (YEAR_OPTIONS.includes(today.getFullYear()) ? today.getFullYear() : YEAR_OPTIONS[1]));
  // month は 1〜12 の数字、または年末年始を表す "ny"
  const [month, setMonth] = useState(defaultMonth ?? today.getMonth() + 1);
  const [customRange, setCustomRange] = useState(null); // { start, end }
  const [detailOpen, setDetailOpen] = useState(false);

  const changeYear = (y) => { setYear(y); setCustomRange(null); setDetailOpen(false); };
  const changeMonth = (m) => { setMonth(m); setCustomRange(null); setDetailOpen(false); };

  const period = month === "ny" ? nyPeriod(year) : monthPeriod(year, month);
  const { start: monthStart, end: monthEnd } = periodRange(period);

  const effectiveStart = customRange ? customRange.start : monthStart;
  const effectiveEnd = customRange ? customRange.end : monthEnd;
  const effectiveDays = useMemo(() => {
    if (!effectiveStart || !effectiveEnd) return 0;
    return Math.max(1, daysBetweenInclusive(effectiveStart, effectiveEnd));
  }, [effectiveStart, effectiveEnd]);

  const rangeInvalid = !!(customRange && new Date(customRange.end) < new Date(customRange.start));
  const requiredSlots = useMemo(
    () => (rangeInvalid ? 0 : countPeriods(effectiveStart, effectiveDays)),
    [effectiveStart, effectiveDays, rangeInvalid]
  );

  useEffect(() => {
    onChange?.({ start: effectiveStart, end: effectiveEnd, days: effectiveDays, requiredSlots, valid: !rangeInvalid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveStart, effectiveEnd, effectiveDays, requiredSlots, rangeInvalid]);

  const openDetail = () => {
    if (!detailOpen && !customRange) {
      setCustomRange({ start: monthStart, end: monthEnd });
    }
    setDetailOpen((v) => !v);
  };

  const rangeLabel = (() => {
    const s = new Date(effectiveStart + "T00:00:00");
    const e = new Date(effectiveEnd + "T00:00:00");
    const f = (d) => `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
    return `${f(s)} 〜 ${f(e)}・${effectiveDays}日間`;
  })();

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, color: "#6B6B6B", marginBottom: "10px" }}>
        <CalendarRange size={15} /> 対象期間
      </div>

      <div style={{ fontSize: "11px", color: "#8A8A8A", marginBottom: "4px" }}>対象期間(12月・年末年始・1月は分かれています)</div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
        <select
          value={year}
          onChange={(e) => changeYear(Number(e.target.value))}
          style={{
            flex: 1, padding: "8px 10px", border: "2px solid #1E1E1E", borderRadius: "3px",
            fontSize: "14px", fontFamily: "inherit", outline: "none", color: "#1E1E1E", background: "#FFFFFF",
          }}
        >
          {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select
          value={month}
          onChange={(e) => changeMonth(e.target.value === "ny" ? "ny" : Number(e.target.value))}
          style={{
            flex: 1, padding: "8px 10px", border: "2px solid #1E1E1E", borderRadius: "3px",
            fontSize: "14px", fontFamily: "inherit", outline: "none", color: "#1E1E1E", background: "#FFFFFF",
          }}
        >
          {periodsOfYear(year).map((p) => (
            <option key={p.kind === "ny" ? "ny" : p.month} value={p.kind === "ny" ? "ny" : p.month}>{periodLabel(p, true)}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", color: "#6B6B6B", marginBottom: "12px" }}>
        <span>{rangeLabel}</span>
        <span style={{ fontWeight: 700, fontSize: "15px", color: "#1E1E1E" }}>
          {requiredSlots}<span style={{ fontSize: "11px", fontWeight: 400, color: "#8A8A8A" }}> 枠</span>
        </span>
      </div>

      <button
        onClick={openDetail}
        style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "none", padding: 0, fontSize: "12px", color: "#223A70", cursor: "pointer", fontFamily: "inherit" }}
      >
        <ChevronRight size={13} style={{ transform: detailOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
        日単位で細かく指定する(オプション)
      </button>

      {detailOpen && (
        <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1.5px solid #E4E4E4" }}>
          <div style={{ fontSize: "11px", color: "#8A8A8A", marginBottom: "4px" }}>対象期間(開始日〜終了日)</div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <input
              type="date"
              value={customRange?.start ?? monthStart}
              onChange={(e) => setCustomRange((prev) => ({ start: e.target.value, end: prev?.end ?? monthEnd }))}
              style={{ border: "2px solid #1E1E1E", borderRadius: "3px", padding: "7px 10px", fontSize: "13px", fontFamily: "inherit", outline: "none", color: "#1E1E1E" }}
            />
            <span style={{ color: "#8A8A8A" }}>〜</span>
            <input
              type="date"
              value={customRange?.end ?? monthEnd}
              onChange={(e) => setCustomRange((prev) => ({ start: prev?.start ?? monthStart, end: e.target.value }))}
              style={{ border: "2px solid #1E1E1E", borderRadius: "3px", padding: "7px 10px", fontSize: "13px", fontFamily: "inherit", outline: "none", color: "#1E1E1E" }}
            />
          </div>
          {rangeInvalid && (
            <div style={{ fontSize: "11px", color: "#EE1515", marginTop: "8px" }}>終了日は開始日以降にしてください。</div>
          )}
          <div style={{ fontSize: "11px", color: "#8A8A8A", marginTop: "10px", lineHeight: 1.7 }}>
            ▶ 月をまたぐ期間や、月の途中からの期間もここで指定できます。<br />
            ▶ 対象期間を変更すると、この指定は自動でリセットされます(基本は上の期間単位)。
          </div>
        </div>
      )}
    </>
  );
}
