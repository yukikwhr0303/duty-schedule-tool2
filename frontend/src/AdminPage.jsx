import React, { useRef } from "react";
import MemberManagement from "./MemberManagement";
import QuotaSetting from "./QuotaSetting";
import ScheduleRunPanel from "./ScheduleRunPanel";
import MemberAvailabilityViewer from "./MemberAvailabilityViewer";
import MissingSubmissions from "./MissingSubmissions";

const SECTIONS = [
  { id: "members", label: "メンバー管理" },
  { id: "missing", label: "未提出リスト" },
  { id: "availability", label: "個人の希望表" },
  { id: "quota", label: "希望回数設定" },
  { id: "run", label: "自動割当・結果" },
];

export default function AdminPage() {
  const refs = {
    members: useRef(null),
    missing: useRef(null),
    availability: useRef(null),
    quota: useRef(null),
    run: useRef(null),
  };

  const jump = (id) => {
    refs[id].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{ background: "#FFFFFF", minHeight: "100vh", fontFamily: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif", paddingBottom: "24px" }}>
      <div
        style={{
          position: "sticky", top: 0, zIndex: 20, display: "flex", gap: "6px",
          background: "#FFFFFF", borderBottom: "2px solid #1E1E1E", padding: "10px 14px",
        }}
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => jump(s.id)}
            style={{
              border: "1.5px solid #1E1E1E", borderRadius: "3px", padding: "6px 10px",
              fontSize: "11px", background: "#FFFFFF", color: "#1E1E1E", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div ref={refs.members}><MemberManagement /></div>
      <div ref={refs.missing} style={{ marginTop: "8px", borderTop: "8px solid #F5F5F5" }}><MissingSubmissions /></div>
      <div ref={refs.availability} style={{ marginTop: "8px", borderTop: "8px solid #F5F5F5" }}><MemberAvailabilityViewer /></div>
      <div ref={refs.quota} style={{ marginTop: "8px", borderTop: "8px solid #F5F5F5" }}><QuotaSetting /></div>
      <div ref={refs.run} style={{ marginTop: "8px", borderTop: "8px solid #F5F5F5" }}><ScheduleRunPanel /></div>
    </div>
  );
}
