import React from "react";
import { formatJst } from "./deadline";

// 希望レコード([{date,half,duty_ng,oncall_ng,note}])を、日ごとの短い説明文の配列にする。
// 例: ["5日 当直✕ OC✕", "12日 前半:当直✕ / 後半:OC✕ 「コメント」"]
export function describeRecords(records) {
  if (!records || records.length === 0) return [];
  const byDate = {};
  records.forEach((r) => {
    (byDate[r.date] = byDate[r.date] || []).push(r);
  });
  return Object.keys(byDate).sort().map((date) => {
    const day = Number(date.slice(8, 10));
    const rows = byDate[date];
    const fmt = (r) => {
      const t = [r.duty_ng ? "当直✕" : null, r.oncall_ng ? "OC✕" : null].filter(Boolean).join(" ");
      return t || "可";
    };
    const note = rows.find((r) => r.note)?.note;
    let body;
    if (rows.length === 1 && rows[0].half === "ALL") {
      body = fmt(rows[0]);
    } else {
      const am = rows.find((r) => r.half === "AM");
      const pm = rows.find((r) => r.half === "PM");
      body = `前半:${am ? fmt(am) : "可"} / 後半:${pm ? fmt(pm) : "可"}`;
    }
    return `${day}日 ${body}${note ? ` 「${note}」` : ""}`;
  });
}

const ACTOR_STYLE = {
  member: { label: "本人", bg: "#E8EBF3", color: "#223A70" },
  admin: { label: "管理者による代理編集", bg: "#FFF7E0", color: "#8A6400" },
};

// 履歴(本人の保存・提出・管理者の代理編集)を新しい順に並べて表示する。
export default function AvailabilityHistory({ logs, showMember = false, emptyText = "履歴はまだありません" }) {
  if (!logs || logs.length === 0) {
    return <div style={{ fontSize: "12px", color: "#8A8A8A", padding: "8px 2px" }}>{emptyText}</div>;
  }
  const sorted = [...logs].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {sorted.map((l) => {
        const actor = ACTOR_STYLE[l.actor] || ACTOR_STYLE.member;
        const before = describeRecords(l.before);
        const after = describeRecords(l.after);
        return (
          <div key={l.id} style={{ border: "1.5px solid #E4E4E4", borderRadius: "3px", padding: "8px 10px", fontSize: "12px", background: "#FFFFFF" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
              <span style={{ fontWeight: 700 }}>{formatJst(l.at)}</span>
              {showMember && <span style={{ fontWeight: 700 }}>{l.member_name}</span>}
              <span style={{ padding: "1px 6px", borderRadius: "3px", background: actor.bg, color: actor.color, fontSize: "11px", fontWeight: 700 }}>{actor.label}</span>
              <span style={{ color: "#6B6B6B" }}>{l.action === "submit" ? "提出" : "保存"}</span>
            </div>
            {l.action === "submit" ? (
              <div style={{ color: "#1E1E1E", lineHeight: 1.6 }}>
                <div style={{ color: after.length === 0 ? "#B01010" : "#6B6B6B", fontWeight: after.length === 0 ? 700 : 400 }}>
                  {after.length === 0 ? "提出時点で不可・コメントの入力なし(中身が空)" : `提出時点の内容: ${after.length}日分に不可/コメントあり`}
                </div>
                {after.map((t, i) => <div key={i}>{t}</div>)}
              </div>
            ) : (
              <div style={{ lineHeight: 1.6 }}>
                <div><span style={{ color: "#8A8A8A" }}>変更前: </span>{before.length ? before.join(" ／ ") : "入力なし(全部可)"}</div>
                <div><span style={{ color: "#8A8A8A" }}>変更後: </span>{after.length ? after.join(" ／ ") : "入力なし(全部可)"}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
