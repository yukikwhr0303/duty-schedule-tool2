import React, { useState, useEffect, useCallback } from "react";
import { Play, Loader2, Download, FileSpreadsheet, FileText, History, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { runSchedule, listScheduleRuns, getScheduleRun, exportUrl, getCandidates, patchAssignment } from "./api";
import PeriodPicker from "./PeriodPicker";

const WD = ["日", "月", "火", "水", "木", "金", "土"];

function parseDate(s) { return new Date(s + "T00:00:00"); }
function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

// 開始日〜終了日を含む、日曜始まりの週グリッドを作る(範囲外はnull)
function buildWeekGrid(startStr, endStr) {
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  const firstSunday = addDays(start, -((start.getDay() + 0) % 7));
  const lastSaturday = addDays(end, (6 - end.getDay() + 7) % 7);
  const weeks = [];
  let d = firstSunday;
  while (d <= lastSaturday) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(d >= start && d <= end ? new Date(d) : null);
      d = addDays(d, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

const STATUS_LABEL = {
  OPTIMAL: { label: "成功(全枠割当)", color: "#1E8A3C" },
  FEASIBLE: { label: "成功(空欄あり)", color: "#C99A00" },
  INFEASIBLE: { label: "失敗", color: "#EE1515" },
  ERROR: { label: "エラー(メンバー未登録など)", color: "#EE1515" },
};

// 担当回数が希望回数よりオーバー/アンダーな人を見つけやすくするための色
const NAME_COLOR = { over: "#EE1515", under: "#0EA5E9" };

export default function ScheduleRunPanel() {
  const [period, setPeriod] = useState({ start: null, end: null, days: 0, requiredSlots: 0, valid: true });
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [currentRun, setCurrentRun] = useState(null);
  const [starting, setStarting] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [error, setError] = useState(null);

  const [modalAssignment, setModalAssignment] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [patching, setPatching] = useState(false);

  const reloadRuns = useCallback(() => {
    setRunsLoading(true);
    listScheduleRuns()
      .then(setRuns)
      .catch((e) => setError(e.message))
      .finally(() => setRunsLoading(false));
  }, []);

  useEffect(() => {
    reloadRuns();
  }, [reloadRuns]);

  const start = async () => {
    if (!period.valid || !period.start || !period.days) return;
    setStarting(true);
    setError(null);
    try {
      const run = await runSchedule(period.start, period.days);
      setCurrentRun(run);
      reloadRuns();
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const openRun = async (id) => {
    setRunLoading(true);
    setError(null);
    try {
      const run = await getScheduleRun(id);
      setCurrentRun(run);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunLoading(false);
    }
  };

  const openReassign = async (assignment) => {
    setModalAssignment(assignment);
    setCandidates(null);
    setCandidatesLoading(true);
    try {
      const cs = await getCandidates(currentRun.id, assignment.id);
      setCandidates(cs);
    } catch (e) {
      setError(e.message);
      setCandidates([]);
    } finally {
      setCandidatesLoading(false);
    }
  };

  const chooseCandidate = async (memberId) => {
    setPatching(true);
    setError(null);
    try {
      const updated = await patchAssignment(currentRun.id, modalAssignment.id, memberId);
      setCurrentRun(updated);
      reloadRuns();
      setModalAssignment(null);
      setCandidates(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setPatching(false);
    }
  };

  // --- 結果カレンダー用のデータ組み立て ---
  const byDateHalf = {};
  if (currentRun) {
    for (const a of currentRun.assignments) {
      byDateHalf[a.date] = byDateHalf[a.date] || {};
      byDateHalf[a.date][a.half] = byDateHalf[a.date][a.half] || {};
      byDateHalf[a.date][a.half][a.role] = a;
    }
  }
  const weeks = currentRun ? buildWeekGrid(currentRun.start_date, fmtDate(addDays(parseDate(currentRun.start_date), currentRun.days - 1))) : [];

  // 担当者名を、希望回数に対してオーバー/アンダーで色分けするための参照
  const tallyByMember = {};
  if (currentRun) {
    for (const t of currentRun.tally) tallyByMember[t.member_id] = t;
  }

  const statusInfo = currentRun ? (STATUS_LABEL[currentRun.status] || { label: currentRun.status, color: "#6B6B6B" }) : null;

  return (
    <div style={{ background: "#FFFFFF", fontFamily: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif", color: "#1E1E1E" }}>
      <style>{`
        .pf { font-weight: 700; }
        .poke-window {
          background: #FFFFFF;
          border: 3px solid #1E1E1E;
          border-radius: 4px;
          box-shadow: 0 3px 0 #1E1E1E;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="poke-window" style={{ margin: "16px 14px 0", padding: "16px 16px 18px" }}>
        <div className="pf" style={{ fontSize: "13px", marginBottom: "10px" }}>自動割当・結果</div>
        <div style={{ fontSize: "12px", color: "#6B6B6B", lineHeight: 1.6 }}>
          対象期間を選んで「スタート」を押すと、希望回数設定の内容にもとづいて自動で割り当てます。
          結果カレンダーの担当者をタップすると手動で入れ替えられます。
        </div>
      </div>

      {error && (
        <div style={{ margin: "12px 14px 0", padding: "10px 14px", border: "2px solid #EE1515", borderRadius: "3px", background: "#FFF3F3", fontSize: "12px", color: "#B01010" }}>
          エラー: {error}
        </div>
      )}

      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "14px" }}>
        <PeriodPicker onChange={setPeriod} />
        <button
          onClick={start}
          disabled={starting || !period.valid}
          className="pf"
          style={{
            width: "100%", marginTop: "14px", background: "#1E1E1E", color: "#FFFFFF", border: "2px solid #1E1E1E",
            borderRadius: "3px", boxShadow: "0 3px 0 #6B6B6B", fontSize: "14px", padding: "12px",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            cursor: starting ? "default" : "pointer", opacity: starting ? 0.6 : 1,
          }}
        >
          {starting ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={16} />}
          {starting ? "実行中..." : "スタート"}
        </button>
      </div>

      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 700, color: "#6B6B6B", marginBottom: "8px" }}>
          <History size={14} /> 実行履歴
          {runsLoading && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {runs.map((r) => {
            const info = STATUS_LABEL[r.status] || { label: r.status, color: "#6B6B6B" };
            const active = currentRun?.id === r.id;
            return (
              <button
                key={r.id}
                onClick={() => openRun(r.id)}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 10px", border: `1.5px solid ${active ? "#1E1E1E" : "#E4E4E4"}`,
                  borderRadius: "3px", background: active ? "#F5F5F5" : "#FFFFFF",
                  fontSize: "12px", cursor: "pointer", fontFamily: "inherit", color: "#1E1E1E", textAlign: "left",
                }}
              >
                <span>
                  {r.start_date} 〜 {r.days}日間
                  {r.has_manual_edits && <span style={{ color: "#223A70", marginLeft: "6px" }}>・手動調整あり</span>}
                </span>
                <span style={{ color: info.color, fontWeight: 700 }}>{info.label}</span>
              </button>
            );
          })}
          {!runsLoading && runs.length === 0 && (
            <div style={{ padding: "16px", textAlign: "center", fontSize: "12px", color: "#8A8A8A" }}>まだ実行履歴がありません</div>
          )}
        </div>
      </div>

      {runLoading && (
        <div style={{ margin: "12px 14px 0", textAlign: "center" }}><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /></div>
      )}

      {currentRun && !runLoading && (
        <>
          <div className="poke-window" style={{ margin: "12px 14px 0", padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 700 }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: statusInfo.color, display: "inline-block" }} />
                {statusInfo.label}
              </span>
              <span style={{ fontSize: "11px", color: "#8A8A8A" }}>{currentRun.start_date} 〜 {currentRun.days}日間</span>
            </div>
          </div>

          <div className="poke-window" style={{ margin: "12px 14px 0", padding: "12px 8px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#6B6B6B", padding: "2px 8px 4px" }}>
              結果カレンダー ▶ 担当者をタップすると変更できます
            </div>
            <div style={{ fontSize: "10px", color: "#8A8A8A", padding: "0 8px 8px", display: "flex", gap: "12px" }}>
              <span><span style={{ color: NAME_COLOR.under }}>■</span> アンダー(希望より少ない)</span>
              <span><span style={{ color: NAME_COLOR.over }}>■</span> オーバー(希望より多い)</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", textAlign: "center", fontSize: "11px", color: "#6B6B6B", marginBottom: "6px" }}>
              {WD.map((w, i) => <div key={w} style={{ color: i === 0 ? "#EE1515" : i === 6 ? "#223A70" : "#6B6B6B" }}>{w}</div>)}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "4px", marginBottom: "4px" }}>
                {week.map((d, di) => {
                  if (!d) return <div key={di} />;
                  const dateStr = fmtDate(d);
                  const halves = byDateHalf[dateStr] || {};
                  const halfKeys = Object.keys(halves);
                  const dow = d.getDay();
                  const anyUnfilled = halfKeys.some((h) => (halves[h].duty && !halves[h].duty.member_id) || (halves[h].oncall && !halves[h].oncall.member_id));
                  const bg = anyUnfilled ? "#FFCB05" : dow === 0 ? "#FBE9E9" : dow === 6 ? "#E8EBF3" : "#FFFFFF";
                  return (
                    <div key={di} style={{ border: "1.5px solid #1E1E1E", borderRadius: "2px", background: bg, padding: "3px", fontSize: "10px", minHeight: "56px" }}>
                      <div style={{ fontWeight: 700, marginBottom: "2px" }}>{d.getDate()}</div>
                      {halfKeys.map((h) => (
                        <div key={h} style={{ display: "flex", flexDirection: "column", gap: "1px", marginBottom: "2px" }}>
                          <NameBtn a={halves[h].duty} tally={tallyByMember} onClick={() => halves[h].duty && openReassign(halves[h].duty)} />
                          <NameBtn a={halves[h].oncall} tally={tallyByMember} onClick={() => halves[h].oncall && openReassign(halves[h].oncall)} />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="poke-window" style={{ margin: "12px 14px 0", padding: "10px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#6B6B6B", padding: "4px 6px 8px" }}>担当回数一覧</div>
            <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "#8A8A8A", fontSize: "10px" }}>
                  <td style={{ padding: "4px 6px" }}>氏名</td>
                  <td style={{ padding: "4px 6px", textAlign: "center" }}>当直</td>
                  <td style={{ padding: "4px 6px", textAlign: "center" }}>オンコール</td>
                </tr>
              </thead>
              <tbody>
                {currentRun.tally.map((t) => (
                  <tr key={t.member_id} style={{ borderTop: "1.5px solid #E4E4E4" }}>
                    <td style={{ padding: "6px" }}>{t.member_name}</td>
                    <td style={{ padding: "6px", textAlign: "center", color: t.duty === t.duty_quota ? "#1E1E1E" : t.duty > t.duty_quota ? NAME_COLOR.over : NAME_COLOR.under }}>{t.duty} / {t.duty_quota}</td>
                    <td style={{ padding: "6px", textAlign: "center", color: t.oncall === t.oncall_quota ? "#1E1E1E" : t.oncall > t.oncall_quota ? NAME_COLOR.over : NAME_COLOR.under }}>{t.oncall} / {t.oncall_quota}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="poke-window" style={{ margin: "12px 14px 24px", padding: "12px 14px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#6B6B6B", marginBottom: "10px" }}>出力</div>
            <div style={{ display: "flex", gap: "8px" }}>
              <a href={exportUrl(currentRun.id, "xlsx")} style={{ flex: 1, textDecoration: "none" }}>
                <div style={{ border: "2px solid #1E1E1E", borderRadius: "3px", padding: "9px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#1E1E1E", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                  <FileSpreadsheet size={14} /> Excelで出力
                </div>
              </a>
              <a href={exportUrl(currentRun.id, "pdf")} style={{ flex: 1, textDecoration: "none" }}>
                <div style={{ border: "2px solid #1E1E1E", borderRadius: "3px", padding: "9px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#1E1E1E", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                  <FileText size={14} /> PDFで出力
                </div>
              </a>
            </div>
          </div>
        </>
      )}

      {modalAssignment && (
        <div style={{ position: "relative", minHeight: "300px", background: "rgba(30,30,30,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", margin: "0 14px 24px", borderRadius: "4px" }}>
          <div className="poke-window" style={{ width: "100%", maxWidth: "360px", padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700 }}>
                {modalAssignment.date} の{modalAssignment.role === "duty" ? "当直" : "オンコール"}を変更
              </div>
              <button onClick={() => { setModalAssignment(null); setCandidates(null); }} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px" }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ fontSize: "11px", color: "#8A8A8A", marginBottom: "12px" }}>現在: {modalAssignment.member_name || "―(空欄)"}</div>

            {candidatesLoading && (
              <div style={{ textAlign: "center", padding: "16px" }}><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /></div>
            )}

            {!candidatesLoading && candidates && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "300px", overflowY: "auto" }}>
                {candidates.map((c) => {
                  const statusStyle =
                    c.status === "over" ? { border: "2px solid #E24B4A", background: "#FCEBEB", labelColor: "#993C1D" } :
                    c.status === "under" ? { border: "2px solid #639922", background: "#EAF3DE", labelColor: "#3B6D11" } :
                    { border: "1.5px solid #1E1E1E", background: "#FFFFFF", labelColor: "#6B6B6B" };
                  return (
                    <button
                      key={c.member_id}
                      onClick={() => chooseCandidate(c.member_id)}
                      disabled={patching || c.is_current}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "9px 10px", borderRadius: "3px", cursor: c.is_current ? "default" : "pointer",
                        border: statusStyle.border, background: statusStyle.background, fontFamily: "inherit",
                        opacity: patching ? 0.6 : 1,
                      }}
                    >
                      <span style={{ fontSize: "13px", fontWeight: 600 }}>
                        {c.name}({c.rank === "A" ? "上級医" : "下級医"}){c.is_current && "・現在の担当"}
                      </span>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: statusStyle.labelColor }}>
                        {modalAssignment.role === "duty" ? "当直" : "オンコール"}{c.current_count}/{c.quota}
                      </span>
                    </button>
                  );
                })}
                {candidates.length === 0 && (
                  <div style={{ padding: "16px", textAlign: "center", fontSize: "12px", color: "#8A8A8A" }}>
                    条件(区分・不可設定・連続当直禁止)に合う候補者がいません
                  </div>
                )}
                <button
                  onClick={() => chooseCandidate(null)}
                  disabled={patching}
                  style={{ marginTop: "4px", padding: "9px 10px", borderRadius: "3px", border: "1.5px dashed #8A8A8A", background: "none", fontFamily: "inherit", fontSize: "12px", color: "#6B6B6B", cursor: "pointer" }}
                >
                  空欄にする
                </button>
              </div>
            )}

            <div style={{ fontSize: "10px", color: "#8A8A8A", marginTop: "10px", lineHeight: 1.6 }}>
              ▶ 緑=希望回数より少ない人(入れやすい)、赤=多い人(外しやすい)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NameBtn({ a, tally, onClick }) {
  if (!a) return null;
  const empty = !a.member_id;
  let color = a.manual_override ? "#223A70" : "#1E1E1E";
  if (empty) {
    color = "#B01010";
  } else {
    const t = tally?.[a.member_id];
    if (t) {
      const count = a.role === "duty" ? t.duty : t.oncall;
      const quota = a.role === "duty" ? t.duty_quota : t.oncall_quota;
      if (count > quota) color = NAME_COLOR.over;
      else if (count < quota) color = NAME_COLOR.under;
    }
  }
  return (
    <button
      onClick={onClick}
      style={{
        background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer",
        fontFamily: "inherit", fontSize: "10px", fontWeight: 700, color,
        textDecoration: "underline dotted",
      }}
    >
      {a.member_name || "―(空欄)"}
    </button>
  );
}
