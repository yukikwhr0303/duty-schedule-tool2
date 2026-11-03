import React, { useState, useMemo, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Moon, Phone, Sunrise, Sunset, RefreshCw, Loader2, MessageSquare, CheckCircle2 } from "lucide-react";
import { getAvailability, replaceAvailability, submitAvailability, getSubmissions } from "./api";
import { getDeadlineStatus, formatDeadlineLabel, formatJst } from "./deadline";
import { isHoliday, isWeekendOrHoliday, isoDate } from "./holidays";
import { periodRange, periodDates, periodTitle, shiftPeriod, periodContaining, deadlineBasis } from "./periods";

// ---- retro handheld-RPG tokens (v4: black/white, rounded box) ----
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function pad2(n) { return String(n).padStart(2, "0"); }

// API から取得した「不可」行のリスト([{date, half, duty_ng, oncall_ng}]) を
// カレンダーUIのentries辞書({ "YYYY-MM-DD": {type, ...} }) に変換する
function rowsToEntries(rows) {
  const grouped = {};
  rows.forEach((r) => {
    if (!grouped[r.date]) grouped[r.date] = {};
    grouped[r.date][r.half] = r;
  });
  const entries = {};
  Object.entries(grouped).forEach(([dateStr, halves]) => {
    if (halves.ALL) {
      entries[dateStr] = {
        type: "weekday",
        duty: halves.ALL.duty_ng ? "ng" : "ok",
        call: halves.ALL.oncall_ng ? "ng" : "ok",
        note: halves.ALL.note || "",
      };
    } else {
      const am = halves.AM, pm = halves.PM;
      entries[dateStr] = {
        type: "weekend",
        amDuty: am?.duty_ng ? "ng" : "ok",
        pmDuty: pm?.duty_ng ? "ng" : "ok",
        amCall: am?.oncall_ng ? "ng" : "ok",
        pmCall: pm?.oncall_ng ? "ng" : "ok",
        note: am?.note || pm?.note || "",
      };
    }
  });
  return entries;
}

// entries辞書の1日分を、API に送るレコード([{date,half,duty_ng,oncall_ng,note}, ...]) に変換
function entryToRecords(dateStr, e) {
  const note = e.note && e.note.trim() ? e.note.trim() : null;
  if (e.type === "weekday") {
    return [{ date: dateStr, half: "ALL", duty_ng: e.duty === "ng", oncall_ng: e.call === "ng", note }];
  }
  return [
    { date: dateStr, half: "AM", duty_ng: e.amDuty === "ng", oncall_ng: e.amCall === "ng", note },
    { date: dateStr, half: "PM", duty_ng: e.pmDuty === "ng", oncall_ng: e.pmCall === "ng", note },
  ];
}

export default function DutyCalendar({ member }) {
  const today = new Date();
  const memberId = member.id;
  // 表示中の期間(12月・年末年始・1月は分かれている)。初期表示は今日を含む期間。
  const [period, setPeriod] = useState(() => periodContaining(new Date()));
  const [entries, setEntries] = useState({});
  const [activeDay, setActiveDay] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingDay, setSavingDay] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const range = periodRange(period);
  const nDays = range.days;
  const dates = useMemo(() => periodDates(period), [period]);
  const cells = useMemo(() => {
    const arr = [];
    for (let i = 0; i < dates[0].getDay(); i++) arr.push(null);
    dates.forEach((d) => arr.push(d));
    return arr;
  }, [dates]);

  const loadMonth = useCallback(() => {
    if (!memberId) return;
    setLoading(true);
    setError(null);
    getAvailability(memberId, range.start, range.end)
      .then((rows) => setEntries(rowsToEntries(rows)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [memberId, range.start, range.end]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  const loadSubmission = useCallback(() => {
    if (!memberId) return;
    setSubmission(null);
    getSubmissions(range.start, nDays)
      .then((rows) => setSubmission(rows.find((r) => r.member_id === memberId) || null))
      .catch(() => {});
  }, [memberId, range.start, nDays]);

  useEffect(() => {
    loadSubmission();
  }, [loadSubmission]);

  const submitMonth = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitAvailability(memberId, range.start, nDays);
      setSubmission(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const changeMonth = (delta) => {
    setPeriod((p) => shiftPeriod(p, delta));
    setActiveDay(null);
    setDraft(null);
  };

  // activeDay は選択中の日付(Date)
  const openDay = (dt) => {
    if (!dt) return;
    const wknd = isWeekendOrHoliday(dt);
    const k = isoDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    const existing = entries[k];
    if (wknd) setDraft(existing || { type: "weekend", amDuty: "ok", pmDuty: "ok", amCall: "ok", pmCall: "ok", note: "" });
    else setDraft(existing || { type: "weekday", duty: "ok", call: "ok", note: "" });
    setActiveDay(dt);
  };

  const hasAnyNg = (d) =>
    d.type === "weekday"
      ? d.duty === "ng" || d.call === "ng"
      : d.amDuty === "ng" || d.pmDuty === "ng" || d.amCall === "ng" || d.pmCall === "ng";

  const hasContent = (d) => hasAnyNg(d) || !!(d.note && d.note.trim());

  const persistDay = async (dateStr, entryOrNull) => {
    setSavingDay(true);
    setError(null);
    try {
      const records = entryOrNull ? entryToRecords(dateStr, entryOrNull) : [];
      await replaceAvailability(memberId, dateStr, dateStr, records);
      setEntries((prev) => {
        const next = { ...prev };
        if (entryOrNull) next[dateStr] = entryOrNull; else delete next[dateStr];
        return next;
      });
      setActiveDay(null);
      setDraft(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingDay(false);
    }
  };

  const saveDraft = () => {
    const k = isoDate(activeDay.getFullYear(), activeDay.getMonth() + 1, activeDay.getDate());
    persistDay(k, hasContent(draft) ? draft : null);
  };

  const clearDraft = () => {
    const k = isoDate(activeDay.getFullYear(), activeDay.getMonth() + 1, activeDay.getDate());
    persistDay(k, null);
  };

  const applyBulk = async (makeUnavailable) => {
    if (bulkBusy) return;
    const monthLabel = periodTitle(period);
    const confirmMsg = makeUnavailable
      ? `${monthLabel}の当直・オンコールをすべて「不可」にします。よろしいですか？`
      : `${monthLabel}をすべて「可」に戻します。よろしいですか？`;
    if (!window.confirm(confirmMsg)) return;

    setBulkBusy(true);
    setError(null);
    try {
      const start = range.start;
      const end = range.end;
      const records = [];
      const nextEntries = {};
      if (makeUnavailable) {
        for (const dt of dates) {
          const dateStr = isoDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
          if (isWeekendOrHoliday(dt)) {
            records.push({ date: dateStr, half: "AM", duty_ng: true, oncall_ng: true });
            records.push({ date: dateStr, half: "PM", duty_ng: true, oncall_ng: true });
            nextEntries[dateStr] = { type: "weekend", amDuty: "ng", pmDuty: "ng", amCall: "ng", pmCall: "ng", note: "" };
          } else {
            records.push({ date: dateStr, half: "ALL", duty_ng: true, oncall_ng: true });
            nextEntries[dateStr] = { type: "weekday", duty: "ng", call: "ng", note: "" };
          }
        }
      }
      await replaceAvailability(memberId, start, end, records);
      setEntries(nextEntries);
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const monthName = periodTitle(period);
  const basis = deadlineBasis(period);
  const deadlineStatus = getDeadlineStatus(new Date(), basis.year, basis.month0);

  return (
    <div style={{ minHeight: "100vh", maxWidth: "480px", margin: "0 auto", background: "#FFFFFF", fontFamily: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif", color: "#1E1E1E", paddingBottom: "100px" }}>
      <style>{`
        .pf { font-weight: 700; }
        .poke-window {
          background: #FFFFFF;
          border: 3px solid #1E1E1E;
          border-radius: 4px;
          box-shadow: 0 3px 0 #1E1E1E;
        }
        @keyframes blink { 0%, 55% { opacity: 1 } 56%, 100% { opacity: 0 } }
        .cursor { animation: blink 1s steps(1) infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {error && (
        <div style={{ margin: "12px 14px 0", padding: "10px 14px", border: "2px solid #EE1515", borderRadius: "3px", background: "#FFF3F3", fontSize: "12px", color: "#B01010" }}>
          エラー: {error}
        </div>
      )}

      {/* deadline banner */}
      <div
        style={{
          margin: "16px 14px 0", padding: "10px 14px", borderRadius: "3px", fontSize: "12.5px",
          border: `2px solid ${deadlineStatus.phase === "open" ? "#EE1515" : deadlineStatus.phase === "closed" ? "#8A8A8A" : "#223A70"}`,
          background: deadlineStatus.phase === "open" ? "#FFF3F3" : deadlineStatus.phase === "closed" ? "#F5F5F5" : "#EEF1F8",
          color: deadlineStatus.phase === "open" ? "#B01010" : deadlineStatus.phase === "closed" ? "#6B6B6B" : "#223A70",
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px",
        }}
      >
        <b>{monthName}分の締切</b>
        <span>{formatDeadlineLabel(deadlineStatus.start)}〜{formatDeadlineLabel(deadlineStatus.deadline)}</span>
        <span
          style={{
            marginLeft: "auto", padding: "2px 8px", borderRadius: "2px", fontSize: "11px", fontWeight: 700, color: "#FFFFFF",
            background: deadlineStatus.phase === "open" ? "#EE1515" : deadlineStatus.phase === "closed" ? "#8A8A8A" : "#223A70",
          }}
        >
          {deadlineStatus.phase === "before" && "受付開始前"}
          {deadlineStatus.phase === "open" && (deadlineStatus.daysLeft <= 1 ? `本日${formatDeadlineLabel(deadlineStatus.deadline)}まで` : `締切まであと${deadlineStatus.daysLeft}日`)}
          {deadlineStatus.phase === "closed" && "締切済み"}
        </span>
      </div>

      {/* header window */}
      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "16px 16px 18px" }}>
        <div className="pf" style={{ fontSize: "13px", color: "#1E1E1E", lineHeight: 1.6, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
          当直・オンコール希望入力
          {loading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
          <button onClick={loadMonth} title="再読み込み" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", display: "flex" }}>
            <RefreshCw size={14} color="#8A8A8A" />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <button onClick={() => changeMonth(-1)} style={pixelBtnStyle}><ChevronLeft size={18} color="#1E1E1E" /></button>
          <div className="pf" style={{ fontSize: "30px", color: "#1E1E1E", letterSpacing: "0.03em" }}>{monthName}</div>
          <button onClick={() => changeMonth(1)} style={pixelBtnStyle}><ChevronRight size={18} color="#1E1E1E" /></button>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => applyBulk(false)}
            disabled={bulkBusy}
            style={{ flex: 1, padding: "9px", border: "2px solid #1E1E1E", borderRadius: "3px", background: "#FFFFFF", color: "#1E1E1E", fontSize: "11.5px", fontWeight: 700, cursor: bulkBusy ? "default" : "pointer", opacity: bulkBusy ? 0.6 : 1 }}
          >
            全部可に戻す
          </button>
          <button
            onClick={() => applyBulk(true)}
            disabled={bulkBusy}
            style={{ flex: 1.4, padding: "9px", border: "2px solid #1E1E1E", borderRadius: "3px", background: "#EE1515", color: "#FFFFFF", fontSize: "11.5px", fontWeight: 700, cursor: bulkBusy ? "default" : "pointer", opacity: bulkBusy ? 0.6 : 1 }}
          >
            この期間をすべて不可にする
          </button>
        </div>
      </div>

      {/* legend window */}
      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "12px 14px", display: "flex", flexWrap: "wrap", gap: "14px", fontSize: "13px", color: "#6B6B6B" }}>
        <LegendDot color="#FFFFFF" label="無地＝全部可" bordered />
        <LegendDot color="#FFCB05" label="一部不可" />
        <LegendDot color="#EE1515" label="終日不可" />
        <LegendDot color="#223A70" label="土曜(4枠)" outline />
        <LegendDot color="#EE1515" label="日・祝(4枠)" outline />
      </div>
      <div style={{ padding: "10px 18px 0", fontSize: "12.5px", color: "#8A8A8A", lineHeight: 1.7 }}>
        ▶ 不可の枠だけタップしてください。何もしなければ可のままです。選択内容はその場で保存されます。
      </div>

      {/* calendar window */}
      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "14px 10px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", textAlign: "center", marginBottom: "8px" }}>
          {WEEKDAY_LABELS.map((w, i) => (
            <div key={w} style={{ fontSize: "13px", fontWeight: 700, color: i === 0 ? "#EE1515" : i === 6 ? "#223A70" : "#6B6B6B", padding: "4px 0" }}>{w}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "5px" }}>
          {cells.map((dt, idx) => {
            if (!dt) return <div key={idx} />;
            const day = dt.getDate();
            const dow = dt.getDay();
            const hName = isHoliday(dt);
            const k = isoDate(dt.getFullYear(), dt.getMonth() + 1, day);
            const e = entries[k];
            const allNg = e && (e.type === "weekday" ? e.duty === "ng" && e.call === "ng" : e.amDuty === "ng" && e.pmDuty === "ng" && e.amCall === "ng" && e.pmCall === "ng");
            const restricted = e && (e.type === "weekday" ? (e.duty === "ng" || e.call === "ng") : (e.amDuty === "ng" || e.pmDuty === "ng" || e.amCall === "ng" || e.pmCall === "ng"));
            const isToday = dt.getFullYear() === today.getFullYear() && dt.getMonth() === today.getMonth() && day === today.getDate();
            const isRedDay = dow === 0 || !!hName;
            const dowTint = isRedDay ? "#FBE9E9" : dow === 6 ? "#E8EBF3" : "#FFFFFF";
            const dowBorder = isRedDay ? "#EE1515" : dow === 6 ? "#223A70" : "#1E1E1E";
            const bg = allNg ? "#EE1515" : restricted ? "#FFCB05" : dowTint;
            const border = restricted ? "#1E1E1E" : dowBorder;
            const textColor = allNg ? "#FFFFFF" : restricted ? "#1E1E1E" : isRedDay ? "#B01010" : dow === 6 ? "#223A70" : "#1E1E1E";
            return (
              <button
                key={idx}
                onClick={() => openDay(dt)}
                style={{
                  position: "relative", aspectRatio: "1",
                  background: bg,
                  border: `1.5px solid ${border}`,
                  borderRadius: "2px",
                  boxShadow: isToday ? "inset 0 0 0 2px #1E1E1E" : "none",
                  color: textColor,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", padding: 0,
                }}
              >
                <span style={{ fontSize: "14px", fontWeight: 700 }}>{day}</span>
                {hName && !e && <span style={{ fontSize: "8px", color: "#B01010", marginTop: "1px" }}>祝</span>}
                {e && e.type === "weekend" && restricted && !allNg && (
                  <div style={{ display: "flex", gap: "2px", marginTop: "3px" }}>
                    <PixDot ng={e.amDuty === "ng"} /><PixDot ng={e.pmDuty === "ng"} /><PixDot ng={e.amCall === "ng"} /><PixDot ng={e.pmCall === "ng"} />
                  </div>
                )}
                {e?.note && (
                  <span style={{ position: "absolute", top: "2px", right: "2px" }}>
                    <MessageSquare size={9} color={allNg ? "#FFFFFF" : "#223A70"} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* footer window: submission status */}
      <div className="poke-window" style={{ position: "fixed", bottom: "10px", left: "50%", transform: "translateX(-50%)", width: "calc(100% - 28px)", maxWidth: "452px", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", background: "#FFFFFF" }}>
        <div style={{ fontSize: "12px", color: submission ? "#1E7A34" : "#8A8A8A", display: "flex", alignItems: "center", gap: "6px", lineHeight: 1.5 }}>
          {submission ? (
            <>
              <CheckCircle2 size={15} />
              提出済み（{formatJst(submission.submitted_at)}）
            </>
          ) : (
            "この月はまだ提出されていません"
          )}
        </div>
        <button
          onClick={submitMonth}
          disabled={submitting}
          className="pf"
          style={{
            padding: "10px 16px", background: "#1E1E1E", color: "#FFFFFF", border: "2px solid #1E1E1E",
            borderRadius: "3px", boxShadow: "0 3px 0 #6B6B6B", fontSize: "12px",
            cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1, whiteSpace: "nowrap",
          }}
        >
          {submitting ? "送信中..." : "この内容で提出する"}
        </button>
      </div>

      {/* modal: command window */}
      {activeDay && draft && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(30,30,30,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }} onClick={() => { if (!savingDay) { setActiveDay(null); setDraft(null); } }}>
          <div className="poke-window" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "480px", padding: "20px 18px 24px", borderRadius: "6px 6px 0 0" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E1E1E", marginBottom: "4px" }}>
              {activeDay.getMonth() + 1}月{activeDay.getDate()}日（{WEEKDAY_LABELS[activeDay.getDay()]}）
              {isHoliday(activeDay) && (
                <span style={{ fontSize: "12px", color: "#EE1515", marginLeft: "8px" }}>
                  {isHoliday(activeDay)}
                </span>
              )}
            </div>
            <div style={{ fontSize: "13px", color: "#6B6B6B", marginBottom: "16px" }}>
              不可にする枠を選んでください
            </div>

            {draft.type === "weekday" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <FieldRow icon={<Moon size={16} />} label="当直" ng={draft.duty === "ng"} onToggle={() => setDraft({ ...draft, duty: draft.duty === "ng" ? "ok" : "ng" })} />
                <FieldRow icon={<Phone size={16} />} label="オンコール" ng={draft.call === "ng"} onToggle={() => setDraft({ ...draft, call: draft.call === "ng" ? "ok" : "ng" })} />
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1E1E1E", display: "flex", alignItems: "center", gap: "5px" }}><Sunrise size={14} /> 前半</div>
                <FieldRow icon={<Moon size={16} />} label="当直" ng={draft.amDuty === "ng"} onToggle={() => setDraft({ ...draft, amDuty: draft.amDuty === "ng" ? "ok" : "ng" })} />
                <FieldRow icon={<Phone size={16} />} label="オンコール" ng={draft.amCall === "ng"} onToggle={() => setDraft({ ...draft, amCall: draft.amCall === "ng" ? "ok" : "ng" })} />
                <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1E1E1E", display: "flex", alignItems: "center", gap: "5px", marginTop: "6px" }}><Sunset size={14} /> 後半</div>
                <FieldRow icon={<Moon size={16} />} label="当直" ng={draft.pmDuty === "ng"} onToggle={() => setDraft({ ...draft, pmDuty: draft.pmDuty === "ng" ? "ok" : "ng" })} />
                <FieldRow icon={<Phone size={16} />} label="オンコール" ng={draft.pmCall === "ng"} onToggle={() => setDraft({ ...draft, pmCall: draft.pmCall === "ng" ? "ok" : "ng" })} />
              </div>
            )}

            <div style={{ marginTop: "14px" }}>
              <label style={{ fontSize: "12px", fontWeight: 700, color: "#6B6B6B", display: "flex", alignItems: "center", gap: "5px", marginBottom: "6px" }}>
                <MessageSquare size={14} /> コメント（任意）
              </label>
              <textarea
                value={draft.note || ""}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="例：学会のため午後不在　など"
                rows={2}
                style={{
                  width: "100%", padding: "8px 10px", border: "2px solid #1E1E1E", borderRadius: "3px",
                  fontSize: "13px", fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button onClick={clearDraft} disabled={savingDay} style={{ flex: 1, padding: "12px", background: "#FFFFFF", color: "#6B6B6B", border: "2px solid #1E1E1E", borderRadius: "3px", fontSize: "13px", fontWeight: 700, cursor: savingDay ? "default" : "pointer", opacity: savingDay ? 0.6 : 1 }}>
                全部可に戻す
              </button>
              <button onClick={saveDraft} disabled={savingDay} style={{ flex: 1.4, padding: "12px", background: "#1E1E1E", color: "#FFFFFF", border: "2px solid #1E1E1E", borderRadius: "3px", boxShadow: "0 3px 0 #6B6B6B", fontSize: "13px", fontWeight: 700, cursor: savingDay ? "default" : "pointer", opacity: savingDay ? 0.6 : 1 }}>
                <span className="cursor">▶</span> {savingDay ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldRow({ icon, label, ng, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "11px 14px",
        background: ng ? "#EE1515" : "#FFFFFF",
        border: `1.5px solid #1E1E1E`,
        borderRadius: "3px",
        cursor: "pointer", width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600, color: ng ? "#FFFFFF" : "#1E1E1E" }}>
        {ng && <span className="cursor" style={{ color: "#FFCB05" }}>▶</span>}
        <span style={{ color: ng ? "#FFE3DD" : "#1E1E1E" }}>{icon}</span>
        {label}
      </div>
      <div style={{ fontSize: "13px", fontWeight: 700, color: ng ? "#FFFFFF" : "#8A8A8A" }}>
        {ng ? "✕ 不可" : "○ 可"}
      </div>
    </button>
  );
}

function PixDot({ ng }) {
  if (!ng) return null;
  return <span style={{ width: "5px", height: "5px", background: "#FFFFFF", border: "1px solid #1E1E1E", borderRadius: "50%" }} />;
}

function LegendDot({ color, label, outline, bordered }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: outline ? "transparent" : color, border: outline ? `2px dashed ${color}` : bordered ? "1.5px solid #1E1E1E" : "none" }} />
      {label}
    </div>
  );
}

const pixelBtnStyle = {
  background: "#FFFFFF", border: "2px solid #1E1E1E", borderRadius: "3px", width: "34px", height: "34px",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};
