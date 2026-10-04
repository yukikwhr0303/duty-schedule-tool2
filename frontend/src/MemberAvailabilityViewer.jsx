import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight, Moon, Phone, Pencil, Eye, Loader2, Sunrise, Sunset } from "lucide-react";
import { listMembers, getAvailability, replaceAvailability, getAvailabilityLogs, restoreSubmittedAvailability } from "./api";
import { formatJst } from "./deadline";
import { isHoliday, isWeekendOrHoliday, daysInMonth, isoDate } from "./holidays";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// DutyCalendar.jsx と同じ変換ロジック(このコンポーネントは他人の希望表を閲覧・代理編集するためのもの)
function rowsToEntries(rows) {
  const grouped = {};
  rows.forEach((r) => {
    if (!grouped[r.date]) grouped[r.date] = {};
    grouped[r.date][r.half] = r;
  });
  const entries = {};
  Object.entries(grouped).forEach(([dateStr, halves]) => {
    if (halves.ALL) {
      entries[dateStr] = { type: "weekday", duty: halves.ALL.duty_ng ? "ng" : "ok", call: halves.ALL.oncall_ng ? "ng" : "ok", note: halves.ALL.note || "" };
    } else {
      const am = halves.AM, pm = halves.PM;
      entries[dateStr] = {
        type: "weekend",
        amDuty: am?.duty_ng ? "ng" : "ok", pmDuty: pm?.duty_ng ? "ng" : "ok",
        amCall: am?.oncall_ng ? "ng" : "ok", pmCall: pm?.oncall_ng ? "ng" : "ok",
        note: am?.note || pm?.note || "",
      };
    }
  });
  return entries;
}

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

export default function MemberAvailabilityViewer() {
  const today = new Date();
  const [members, setMembers] = useState([]);
  const [memberId, setMemberId] = useState(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [entries, setEntries] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [activeDay, setActiveDay] = useState(null);
  const [draft, setDraft] = useState(null);
  const [savingDay, setSavingDay] = useState(false);
  const [submits, setSubmits] = useState([]); // 本人の提出履歴(新しい順)
  const [viewId, setViewId] = useState(null); // null=現在の内容 / 数値=その提出時点の内容を閲覧
  const [restoring, setRestoring] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    listMembers()
      .then((ms) => {
        setMembers(ms);
        if (ms.length > 0) setMemberId((prev) => prev ?? ms[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  const selectedMember = members.find((m) => m.id === memberId);
  const isInactive = selectedMember?.is_active === false;

  const nDays = daysInMonth(year, month + 1);
  const startWd = new Date(year, month, 1).getDay();
  const cells = useMemo(() => {
    const arr = [];
    for (let i = 0; i < startWd; i++) arr.push(null);
    for (let d = 1; d <= nDays; d++) arr.push(d);
    return arr;
  }, [startWd, nDays]);

  const loadMonth = useCallback(() => {
    if (!memberId) return;
    setLoading(true);
    setError(null);
    const start = isoDate(year, month + 1, 1);
    const end = isoDate(year, month + 1, nDays);
    getAvailability(memberId, start, end)
      .then((rows) => setEntries(rowsToEntries(rows)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [memberId, year, month, nDays]);

  useEffect(() => { loadMonth(); }, [loadMonth]);

  // 選択中メンバー・月の変更履歴(本人の保存/提出・管理者の代理編集。変更前の内容もここで確認できる)
  useEffect(() => {
    if (!memberId) return;
    getAvailabilityLogs(isoDate(year, month + 1, 1), nDays, memberId)
      .then((ls) => setSubmits(ls.filter((l) => l.action === "submit").reverse()))
      .catch(() => setSubmits([]));
  }, [memberId, year, month, nDays, historyTick]);

  const changeMonth = (delta) => {
    let m = month + delta, y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonth(m); setYear(y);
    setViewId(null);
  };

  const selectMember = (id) => {
    setMemberId(id);
    setEditMode(false);
    setViewId(null);
  };

  const enterEditMode = () => {
    const m = members.find((x) => x.id === memberId);
    if (!window.confirm(`${m ? m.name : "本人"}さんに代わって希望を変更します。よろしいですか？`)) return;
    setEditMode(true);
  };

  const openDay = (day) => {
    if (!day) return;
    const wknd = isWeekendOrHoliday(new Date(year, month, day));
    const k = isoDate(year, month + 1, day);
    const existing = shownEntries[k];
    const def = isInactive ? "ng" : "ok";
    if (wknd) setDraft(existing || { type: "weekend", amDuty: def, pmDuty: def, amCall: def, pmCall: def, note: "" });
    else setDraft(existing || { type: "weekday", duty: def, call: def, note: "" });
    setActiveDay(day);
  };

  const hasAnyNg = (d) =>
    d.type === "weekday" ? d.duty === "ng" || d.call === "ng" : d.amDuty === "ng" || d.pmDuty === "ng" || d.amCall === "ng" || d.pmCall === "ng";

  const persistDay = async (dateStr, entryOrNull) => {
    setSavingDay(true);
    setError(null);
    try {
      const records = entryOrNull ? entryToRecords(dateStr, entryOrNull) : [];
      await replaceAvailability(memberId, dateStr, dateStr, records, { asAdmin: true });
      setHistoryTick((t) => t + 1);
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
    const k = isoDate(year, month + 1, activeDay);
    persistDay(k, hasAnyNg(draft) ? draft : null);
  };
  const clearDraft = () => {
    const k = isoDate(year, month + 1, activeDay);
    persistDay(k, null);
  };

  const lastSubmit = submits[0] || null;
  const viewLog = viewId ? submits.find((l) => l.id === viewId) || null : null;
  const shownEntries = viewLog ? rowsToEntries(viewLog.after || []) : entries;
  const canEdit = editMode && !viewLog;

  const restoreSubmitted = async () => {
    const m = members.find((x) => x.id === memberId);
    if (!window.confirm(`${m ? m.name : "本人"}さんの${year}/${month + 1}月の希望を、本人が最後に提出した時点の内容に戻します(代理編集の内容は消えます)。よろしいですか？`)) return;
    setRestoring(true);
    setError(null);
    try {
      await restoreSubmittedAvailability(memberId, isoDate(year, month + 1, 1), nDays);
      loadMonth();
      setViewId(null);
      setHistoryTick((t) => t + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setRestoring(false);
    }
  };

  const monthName = `${year}/${String(month + 1).padStart(2, "0")}`;

  return (
    <div style={{ background: "#FFFFFF", fontFamily: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif", color: "#1E1E1E" }}>
      <style>{`
        .pf { font-weight: 700; }
        .poke-window { background: #FFFFFF; border: 3px solid #1E1E1E; border-radius: 4px; box-shadow: 0 3px 0 #1E1E1E; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="poke-window" style={{ margin: "16px 14px 0", padding: "16px" }}>
        <div className="pf" style={{ fontSize: "13px", marginBottom: "10px" }}>個人の希望表を確認</div>
        <select
          value={memberId ?? ""}
          onChange={(e) => selectMember(Number(e.target.value))}
          style={{ width: "100%", padding: "10px 12px", border: "2px solid #1E1E1E", borderRadius: "3px", fontSize: "14px", fontFamily: "inherit", outline: "none" }}
        >
          {members.length === 0 && <option value="">(メンバー未登録)</option>}
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}（{m.rank === "A" ? "上級医" : "下級医"}）{m.is_active === false ? "・休止中" : ""}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div style={{ margin: "12px 14px 0", padding: "10px 14px", border: "2px solid #EE1515", borderRadius: "3px", background: "#FFF3F3", fontSize: "12px", color: "#B01010" }}>
          エラー: {error}
        </div>
      )}

      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => changeMonth(-1)} style={pixelBtnStyle}><ChevronLeft size={16} color="#1E1E1E" /></button>
          <div className="pf" style={{ fontSize: "20px" }}>
            {monthName}
            {loading && <Loader2 size={13} style={{ marginLeft: "8px", animation: "spin 1s linear infinite", verticalAlign: "middle" }} />}
          </div>
          <button onClick={() => changeMonth(1)} style={pixelBtnStyle}><ChevronRight size={16} color="#1E1E1E" /></button>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
          {editMode ? (
            <button onClick={() => { setEditMode(false); setViewId(null); }} style={{ ...editBtnStyle, background: "#F1EFE8", color: "#1E1E1E" }}>
              <Eye size={13} /> 閲覧のみに戻す
            </button>
          ) : (
            <button onClick={enterEditMode} disabled={!memberId} style={editBtnStyle}>
              <Pencil size={13} /> 編集する
            </button>
          )}
        </div>
      </div>

      {isInactive && (
        <div style={{ margin: "10px 14px 0", padding: "10px 14px", border: "2px solid #8A8A8A", borderRadius: "3px", background: "#F5F5F5", fontSize: "12px", color: "#6B6B6B" }}>
          {selectedMember?.name}さんは休止中です。未入力の日はデフォルトで「不可」として表示されています。
        </div>
      )}

      {editMode && (
        <div style={{ margin: "10px 14px 0", padding: "10px 14px", border: "2px solid #FFCB05", borderRadius: "3px", background: "#FFF7E0", fontSize: "12px", color: "#8A6400" }}>
          <div>編集モードです。{selectedMember?.name}さんに代わって希望を変更しています。</div>
          <div style={{ fontWeight: 700, margin: "10px 0 6px", color: "#1E1E1E" }}>表示する内容(本人の提出履歴)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <VersionBtn active={!viewLog} onClick={() => setViewId(null)}>
              現在の内容(編集できます)
            </VersionBtn>
            {submits.map((l, i) => (
              <VersionBtn key={l.id} active={viewId === l.id} onClick={() => setViewId(l.id)}>
                {formatJst(l.at)} 提出{i === 0 ? "(最終提出)" : ""}
              </VersionBtn>
            ))}
            {submits.length === 0 && <div style={{ color: "#8A8A8A" }}>この月の本人の提出記録はまだありません</div>}
          </div>
          {viewLog && (
            <div style={{ marginTop: "8px", color: "#223A70", fontWeight: 700 }}>
              過去の提出内容を表示中です(閲覧のみ・編集はできません)
            </div>
          )}
          {lastSubmit && (
            <button
              onClick={restoreSubmitted}
              disabled={restoring}
              style={{ width: "100%", marginTop: "10px", padding: "10px", background: "#FFFFFF", color: "#223A70", border: "2px solid #223A70", borderRadius: "3px", fontSize: "12.5px", fontWeight: 700, cursor: restoring ? "default" : "pointer", opacity: restoring ? 0.6 : 1 }}
            >
              {restoring ? "戻しています..." : "最終提出の内容に戻す(代理編集のリセット)"}
            </button>
          )}
        </div>
      )}

      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "14px 10px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", textAlign: "center", marginBottom: "8px" }}>
          {WEEKDAY_LABELS.map((w, i) => (
            <div key={w} style={{ fontSize: "12px", fontWeight: 700, color: i === 0 ? "#EE1515" : i === 6 ? "#223A70" : "#6B6B6B", padding: "4px 0" }}>{w}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "5px" }}>
          {cells.map((day, idx) => {
            if (!day) return <div key={idx} />;
            const dt = new Date(year, month, day);
            const dow = dt.getDay();
            const hName = isHoliday(dt);
            const k = isoDate(year, month + 1, day);
            const e = shownEntries[k];
            const allNg = e
              ? (e.type === "weekday" ? e.duty === "ng" && e.call === "ng" : e.amDuty === "ng" && e.pmDuty === "ng" && e.amCall === "ng" && e.pmCall === "ng")
              : isInactive && !viewLog;
            const isRedDay = dow === 0 || !!hName;
            const dowTint = isRedDay ? "#FBE9E9" : dow === 6 ? "#E8EBF3" : "#FFFFFF";
            const dowBorder = isRedDay ? "#EE1515" : dow === 6 ? "#223A70" : "#1E1E1E";
            const bg = allNg ? "#EE1515" : e ? "#FFCB05" : dowTint;
            const border = e || (isInactive && !viewLog) ? "#1E1E1E" : dowBorder;
            const textColor = allNg ? "#FFFFFF" : e ? "#1E1E1E" : isRedDay ? "#B01010" : dow === 6 ? "#223A70" : "#1E1E1E";
            return (
              <button
                key={idx}
                onClick={() => openDay(day)}
                style={{
                  position: "relative", aspectRatio: "1", background: bg, border: `1.5px solid ${border}`,
                  borderRadius: "2px", color: textColor, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0,
                }}
              >
                <span style={{ fontSize: "13px", fontWeight: 700 }}>{day}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ padding: "10px 18px 16px", display: "flex", gap: "14px", fontSize: "11.5px", color: "#8A8A8A" }}>
        <LegendDot color="#FFCB05" label="一部不可" />
        <LegendDot color="#EE1515" label="終日不可" />
      </div>

      {activeDay && draft && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(30,30,30,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }} onClick={() => { if (!savingDay) { setActiveDay(null); setDraft(null); } }}>
          <div className="poke-window" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "420px", padding: "20px 18px 24px", borderRadius: "6px 6px 0 0" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>
              {month + 1}月{activeDay}日（{WEEKDAY_LABELS[new Date(year, month, activeDay).getDay()]}）
            </div>
            <div style={{ fontSize: "13px", color: "#6B6B6B", marginBottom: "16px" }}>
              {canEdit ? "不可にする枠を選んでください" : "内容を確認できます（閲覧のみ）"}
            </div>

            {draft.type === "weekday" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {canEdit ? (
                  <>
                    <FieldRow icon={<Moon size={16} />} label="当直" ng={draft.duty === "ng"} onToggle={() => setDraft({ ...draft, duty: draft.duty === "ng" ? "ok" : "ng" })} />
                    <FieldRow icon={<Phone size={16} />} label="オンコール" ng={draft.call === "ng"} onToggle={() => setDraft({ ...draft, call: draft.call === "ng" ? "ok" : "ng" })} />
                  </>
                ) : (
                  <>
                    <ReadOnlyRow icon={<Moon size={16} />} label="当直" ng={draft.duty === "ng"} />
                    <ReadOnlyRow icon={<Phone size={16} />} label="オンコール" ng={draft.call === "ng"} />
                  </>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ fontSize: "12.5px", fontWeight: 700, display: "flex", alignItems: "center", gap: "5px" }}><Sunrise size={14} /> 前半</div>
                {canEdit ? (
                  <>
                    <FieldRow icon={<Moon size={16} />} label="当直" ng={draft.amDuty === "ng"} onToggle={() => setDraft({ ...draft, amDuty: draft.amDuty === "ng" ? "ok" : "ng" })} />
                    <FieldRow icon={<Phone size={16} />} label="オンコール" ng={draft.amCall === "ng"} onToggle={() => setDraft({ ...draft, amCall: draft.amCall === "ng" ? "ok" : "ng" })} />
                  </>
                ) : (
                  <>
                    <ReadOnlyRow icon={<Moon size={16} />} label="当直" ng={draft.amDuty === "ng"} />
                    <ReadOnlyRow icon={<Phone size={16} />} label="オンコール" ng={draft.amCall === "ng"} />
                  </>
                )}
                <div style={{ fontSize: "12.5px", fontWeight: 700, display: "flex", alignItems: "center", gap: "5px", marginTop: "6px" }}><Sunset size={14} /> 後半</div>
                {canEdit ? (
                  <>
                    <FieldRow icon={<Moon size={16} />} label="当直" ng={draft.pmDuty === "ng"} onToggle={() => setDraft({ ...draft, pmDuty: draft.pmDuty === "ng" ? "ok" : "ng" })} />
                    <FieldRow icon={<Phone size={16} />} label="オンコール" ng={draft.pmCall === "ng"} onToggle={() => setDraft({ ...draft, pmCall: draft.pmCall === "ng" ? "ok" : "ng" })} />
                  </>
                ) : (
                  <>
                    <ReadOnlyRow icon={<Moon size={16} />} label="当直" ng={draft.pmDuty === "ng"} />
                    <ReadOnlyRow icon={<Phone size={16} />} label="オンコール" ng={draft.pmCall === "ng"} />
                  </>
                )}
              </div>
            )}

            {draft.note && (
              <div style={{ marginTop: "14px", padding: "10px 12px", border: "1.5px solid #E4E4E4", borderRadius: "3px", background: "#FAFAFA" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#8A8A8A", marginBottom: "4px" }}>コメント</div>
                <div style={{ fontSize: "13px", color: "#1E1E1E", whiteSpace: "pre-wrap" }}>{draft.note}</div>
              </div>
            )}

            {canEdit ? (
              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button onClick={clearDraft} disabled={savingDay} style={{ flex: 1, padding: "12px", background: "#FFFFFF", color: "#6B6B6B", border: "2px solid #1E1E1E", borderRadius: "3px", fontSize: "13px", fontWeight: 700, cursor: savingDay ? "default" : "pointer", opacity: savingDay ? 0.6 : 1 }}>
                  全部可に戻す
                </button>
                <button onClick={saveDraft} disabled={savingDay} style={{ flex: 1.4, padding: "12px", background: "#1E1E1E", color: "#FFFFFF", border: "2px solid #1E1E1E", borderRadius: "3px", fontSize: "13px", fontWeight: 700, cursor: savingDay ? "default" : "pointer", opacity: savingDay ? 0.6 : 1 }}>
                  ▶ {savingDay ? "保存中..." : "保存"}
                </button>
              </div>
            ) : (
              <div style={{ marginTop: "20px" }}>
                <button onClick={() => { setActiveDay(null); setDraft(null); }} style={{ width: "100%", padding: "12px", background: "#FFFFFF", color: "#1E1E1E", border: "2px solid #1E1E1E", borderRadius: "3px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                  閉じる
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function VersionBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{ textAlign: "left", padding: "8px 10px", border: `2px solid ${active ? "#1E1E1E" : "#E4E4E4"}`, borderRadius: "3px", background: active ? "#FFFFFF" : "#FFFBEF", color: "#1E1E1E", fontSize: "12.5px", fontWeight: active ? 700 : 400, cursor: "pointer", fontFamily: "inherit" }}
    >
      {active ? "● " : "○ "}{children}
    </button>
  );
}

function FieldRow({ icon, label, ng, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: ng ? "#EE1515" : "#FFFFFF", border: "1.5px solid #1E1E1E", borderRadius: "3px", cursor: "pointer", width: "100%" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600, color: ng ? "#FFFFFF" : "#1E1E1E" }}>
        <span style={{ color: ng ? "#FFE3DD" : "#1E1E1E" }}>{icon}</span>
        {label}
      </div>
      <div style={{ fontSize: "13px", fontWeight: 700, color: ng ? "#FFFFFF" : "#8A8A8A" }}>{ng ? "✕ 不可" : "○ 可"}</div>
    </button>
  );
}

function ReadOnlyRow({ icon, label, ng }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: ng ? "#EE1515" : "#FFFFFF", border: "1.5px solid #1E1E1E", borderRadius: "3px", width: "100%", boxSizing: "border-box" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600, color: ng ? "#FFFFFF" : "#1E1E1E" }}>
        <span style={{ color: ng ? "#FFE3DD" : "#1E1E1E" }}>{icon}</span>
        {label}
      </div>
      <div style={{ fontSize: "13px", fontWeight: 700, color: ng ? "#FFFFFF" : "#8A8A8A" }}>{ng ? "✕ 不可" : "○ 可"}</div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: color }} />
      {label}
    </div>
  );
}

const pixelBtnStyle = {
  background: "#FFFFFF", border: "2px solid #1E1E1E", borderRadius: "3px", width: "30px", height: "30px",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

const editBtnStyle = {
  display: "flex", alignItems: "center", gap: "5px", padding: "7px 12px", border: "2px solid #223A70",
  borderRadius: "3px", background: "#FFFFFF", color: "#223A70", fontSize: "11.5px", fontWeight: 700, cursor: "pointer",
};
