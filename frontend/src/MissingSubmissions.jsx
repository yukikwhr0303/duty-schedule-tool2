import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { listMembers, getSubmissions } from "./api";
import { getDeadlineStatus, formatDeadlineLabel } from "./deadline";
import { daysInMonth, isoDate } from "./holidays";

// 「翌月」= 今まさに募集・入力してもらっている対象月、として扱う。
// (募集期間は対象月の前月の第1月曜〜金曜正午なので、通常は「今日から見て翌月」が入力対象月になる)
function getTargetMonth(now) {
  let y = now.getFullYear();
  let m0 = now.getMonth() + 1; // 0-indexed, 翌月
  if (m0 > 11) { m0 = 0; y += 1; }
  return { year: y, month0: m0 };
}

export default function MissingSubmissions() {
  const [members, setMembers] = useState([]);
  const [submittedIds, setSubmittedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { year: targetYear, month0: targetMonth0 } = getTargetMonth(new Date());
  const monthLabel = `${targetYear}/${String(targetMonth0 + 1).padStart(2, "0")}`;
  const periodStart = isoDate(targetYear, targetMonth0 + 1, 1);
  const periodDays = daysInMonth(targetYear, targetMonth0 + 1);
  const deadlineStatus = getDeadlineStatus(new Date(), targetYear, targetMonth0);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([listMembers(), getSubmissions(periodStart, periodDays)])
      .then(([ms, subs]) => {
        setMembers(ms.filter((m) => m.is_active !== false));
        setSubmittedIds(new Set(subs.map((s) => s.member_id)));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [periodStart, periodDays]);

  useEffect(() => {
    reload();
  }, [reload]);

  const missing = members.filter((m) => !submittedIds.has(m.id));

  return (
    <div style={{ background: "#FFFFFF", fontFamily: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif", color: "#1E1E1E" }}>
      <style>{`
        .pf { font-weight: 700; }
        .poke-window { background: #FFFFFF; border: 3px solid #1E1E1E; border-radius: 4px; box-shadow: 0 3px 0 #1E1E1E; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="poke-window" style={{ margin: "16px 14px 0", padding: "16px" }}>
        <div className="pf" style={{ fontSize: "13px", marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
          未提出リスト（{monthLabel}分）
          {loading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
          <button onClick={reload} title="再読み込み" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", display: "flex" }}>
            <RefreshCw size={14} color="#8A8A8A" />
          </button>
        </div>
        <div style={{ fontSize: "11.5px", color: "#8A8A8A", marginBottom: "12px" }}>
          締切: {formatDeadlineLabel(deadlineStatus.deadline)}
          （{deadlineStatus.phase === "before" && "受付開始前"}
          {deadlineStatus.phase === "open" && `あと${deadlineStatus.daysLeft}日`}
          {deadlineStatus.phase === "closed" && "締切済み"}）
        </div>

        {error && (
          <div style={{ padding: "10px 14px", border: "2px solid #EE1515", borderRadius: "3px", background: "#FFF3F3", fontSize: "12px", color: "#B01010", marginBottom: "10px" }}>
            エラー: {error}
          </div>
        )}

        {!loading && missing.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", border: "2px solid #1E1E1E", borderRadius: "3px", background: "#F3FFF3", fontSize: "12.5px" }}>
            <CheckCircle2 size={16} color="#1E1E1E" />
            在籍中の全員が提出済みです
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "10px 12px", border: "2px solid #EE1515", borderRadius: "3px", background: "#FFF3F3" }}>
            <AlertTriangle size={16} color="#EE1515" style={{ flexShrink: 0, marginTop: "2px" }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {missing.map((m) => (
                <span
                  key={m.id}
                  className="pf"
                  style={{ fontSize: "12px", padding: "4px 9px", border: "1.5px solid #EE1515", borderRadius: "3px", background: "#FFFFFF", color: "#B01010" }}
                >
                  {m.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
