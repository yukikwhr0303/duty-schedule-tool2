import React, { useState } from "react";
import { Calendar, LayoutDashboard } from "lucide-react";
import DutyCalendar from "./DutyCalendar";
import AdminPage from "./AdminPage";
import MemberLoginGate from "./MemberLoginGate";
import AdminLoginGate from "./AdminLoginGate";

const TABS = [
  { key: "calendar", label: "希望入力", Icon: Calendar },
  { key: "admin", label: "管理者用", Icon: LayoutDashboard },
];

export default function App() {
  const [tab, setTab] = useState("calendar");

  return (
    <div style={{ fontFamily: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif" }}>
      <div
        style={{
          position: "sticky", top: 0, zIndex: 100, display: "flex",
          borderBottom: "3px solid #1E1E1E", background: "#FFFFFF",
        }}
      >
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              flex: 1, padding: "12px 6px", border: "none", borderBottom: tab === key ? "3px solid #1E1E1E" : "3px solid transparent",
              marginBottom: "-3px", background: tab === key ? "#F5F5F5" : "#FFFFFF",
              color: "#1E1E1E", fontSize: "12px", fontWeight: 700, cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {tab === "calendar" ? (
        <MemberLoginGate>{(member) => <DutyCalendar member={member} />}</MemberLoginGate>
      ) : (
        <AdminLoginGate>
          <AdminPage />
        </AdminLoginGate>
      )}
    </div>
  );
}
