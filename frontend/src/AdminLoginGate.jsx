import React, { useState } from "react";
import { LogOut } from "lucide-react";
import { adminLogin, setAdminPassword, clearAdminPassword, isAdminLoggedIn } from "./api";

// 管理者向けの簡易ログインゲート。全員共通の1つのパスワードで確認する。
// 一度ログインするとこの端末のlocalStorageに記憶され、以降は自動的に管理操作が行える(身内向けの簡易な仕組み)。
export default function AdminLoginGate({ children }) {
  const [loggedIn, setLoggedIn] = useState(() => isAdminLoggedIn());
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminLogin(password);
      setAdminPassword(password);
      setLoggedIn(true);
      setPassword("");
    } catch (e) {
      setError(e.message.includes("401") ? "パスワードが正しくありません" : e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loggedIn) {
    return (
      <div>
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "flex-end",
            padding: "8px 14px", background: "#F5F5F5", borderBottom: "2px solid #1E1E1E",
            fontSize: "12px", color: "#6B6B6B",
          }}
        >
          <button
            onClick={() => { clearAdminPassword(); setLoggedIn(false); }}
            style={{
              display: "flex", alignItems: "center", gap: "4px", background: "none",
              border: "1.5px solid #1E1E1E", borderRadius: "3px", padding: "4px 8px",
              fontSize: "11px", color: "#1E1E1E", cursor: "pointer",
            }}
          >
            <LogOut size={12} /> 管理者ログアウト
          </button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", fontFamily: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif", color: "#1E1E1E", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 14px" }}>
      <style>{`
        .poke-window { background: #FFFFFF; border: 3px solid #1E1E1E; border-radius: 4px; box-shadow: 0 3px 0 #1E1E1E; }
      `}</style>
      <div className="poke-window" style={{ width: "100%", maxWidth: "360px", padding: "20px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "14px" }}>管理者ログイン</div>
        <div style={{ fontSize: "11px", color: "#8A8A8A", marginBottom: "6px" }}>管理者パスワード</div>
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="パスワードを入力"
          autoFocus
          style={{ width: "100%", padding: "10px 12px", border: "2px solid #1E1E1E", borderRadius: "3px", fontSize: "14px", fontFamily: "inherit", outline: "none", marginBottom: "14px", boxSizing: "border-box" }}
        />
        {error && <div style={{ fontSize: "12px", color: "#EE1515", marginBottom: "10px" }}>{error}</div>}
        <button
          onClick={submit}
          disabled={busy || !password}
          style={{
            width: "100%", padding: "12px", border: "3px solid #1E1E1E", borderRadius: "3px",
            background: "#223A70", color: "#FFFFFF", fontWeight: 700, fontSize: "14px",
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: "inherit",
          }}
        >
          ▶ {busy ? "確認中..." : "管理者としてログイン"}
        </button>
        <div style={{ fontSize: "11px", color: "#8A8A8A", marginTop: "12px", lineHeight: 1.6 }}>
          全員共通の1つのパスワードです。ログイン状態はこの端末に保存されます。
        </div>
      </div>
    </div>
  );
}
