import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { listMembers, getAvailabilityLogs } from "./api";
import { getRecruitmentWindow, formatJst } from "./deadline";
import { daysInMonth, isoDate } from "./holidays";
import AvailabilityHistory from "./AvailabilityHistory";

// 対象月(=今募集中の月)の既定値は「翌月」
function defaultTarget() {
  const now = new Date();
  let y = now.getFullYear();
  let m0 = now.getMonth() + 1;
  if (m0 > 11) { m0 = 0; y += 1; }
  return { year: y, month0: m0 };
}

// 提出状況と履歴を一覧で確認する管理者向けパネル。
// 「誰が締切に遅れたか」「誰が一番遅いか」「提出だけして中身が空ではないか」「提出後に内容を変えていないか」を見る。
export default function SubmissionLog() {
  const [{ year, month0 }, setTarget] = useState(defaultTarget);
  const [members, setMembers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  const periodStart = isoDate(year, month0 + 1, 1);
  const periodDays = daysInMonth(year, month0 + 1);
  const { deadline } = getRecruitmentWindow(year, month0);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([listMembers(), getAvailabilityLogs(periodStart, periodDays)])
      .then(([ms, ls]) => {
        setMembers(ms.filter((m) => m.is_active !== false));
        setLogs(ls);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [periodStart, periodDays]);

  useEffect(() => { reload(); }, [reload]);

  const changeMonth = (delta) => {
    let m = month0 + delta, y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setTarget({ year: y, month0: m });
    setOpenId(null);
  };

  const rows = members.map((m) => {
    const mine = logs.filter((l) => l.member_id === m.id);
    const submits = mine.filter((l) => l.action === "submit");
    const first = submits[0] || null;
    const last = submits[submits.length - 1] || null;
    const lastSubmitAt = last ? new Date(last.at) : null;
    return { m, submits, first, last, lastSubmitAt };
  });

  // 未提出 → 提出が遅い順(一番遅い人が上)
  rows.sort((a, b) => {
    if (!a.last && !b.last) return 0;
    if (!a.last) return -1;
    if (!b.last) return 1;
    return b.lastSubmitAt - a.lastSubmitAt;
  });

  return (
    <div style={{ background: "#FFFFFF", fontFamily: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif", color: "#1E1E1E" }}>
      <style>{`
        .poke-window { background: #FFFFFF; border: 3px solid #1E1E1E; border-radius: 4px; box-shadow: 0 3px 0 #1E1E1E; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <div className="poke-window" style={{ margin: "16px 14px 0", padding: "16px" }}>
        <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
          提出状況・履歴
          {loading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
          <button onClick={reload} title="再読み込み" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", display: "flex" }}>
            <RefreshCw size={14} color="#8A8A8A" />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "6px 0" }}>
          <button onClick={() => changeMonth(-1)} style={navBtn}><ChevronLeft size={14} /></button>
          <div style={{ fontWeight: 700, fontSize: "16px" }}>{year}/{String(month0 + 1).padStart(2, "0")}分</div>
          <button onClick={() => changeMonth(1)} style={navBtn}><ChevronRight size={14} /></button>
        </div>
        <div style={{ fontSize: "11.5px", color: "#8A8A8A", marginBottom: "10px" }}>
          締切: {formatJst(deadline)}　／　並び: 未提出 → 提出が遅い人の順(名前を押すと初回・更新ごとの提出日時と内容)
        </div>

        {error && (
          <div style={{ padding: "10px 14px", border: "2px solid #EE1515", borderRadius: "3px", background: "#FFF3F3", fontSize: "12px", color: "#B01010", marginBottom: "10px" }}>
            エラー: {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {rows.map((r) => {
            const open = openId === r.m.id;
            return (
              <div key={r.m.id} style={{ border: "1.5px solid #1E1E1E", borderRadius: "3px" }}>
                <button
                  onClick={() => setOpenId(open ? null : r.m.id)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", background: "#FFFFFF", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700 }}>{r.m.name}</div>
                    <div style={{ fontSize: "11.5px", color: "#6B6B6B", lineHeight: 1.6 }}>
                      {r.last ? (
                        <>
                          最終提出 {formatJst(r.last.at)}
                          {r.submits.length > 1 && `(初回 ${formatJst(r.first.at)} / 計${r.submits.length}回)`}
                        </>
                      ) : "未提出"}
                    </div>
                  </div>
                  {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {open && (
                  <div style={{ padding: "8px 10px 10px", borderTop: "1.5px solid #E4E4E4", background: "#FAFAFA" }}>
                    <AvailabilityHistory logs={r.submits} emptyText="提出はまだありません" />
                  </div>
                )}
              </div>
            );
          })}
          {!loading && rows.length === 0 && (
            <div style={{ fontSize: "12px", color: "#8A8A8A", padding: "8px" }}>在籍中のメンバーがいません</div>
          )}
        </div>
      </div>
    </div>
  );
}

const navBtn = {
  background: "#FFFFFF", border: "2px solid #1E1E1E", borderRadius: "3px", width: "28px", height: "28px",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};
