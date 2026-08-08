import React, { useState, useEffect, useCallback } from "react";
import { LogOut } from "lucide-react";
import { listMembers, memberLogin, getMemberSession, setMemberSession, clearMemberSession } from "./api";

// 医局員向けの簡易ログインゲート。氏名を選び、4桁の暗証番号で本人確認する。
// 初回はここで暗証番号を新規設定し、以降は同じ番号で認証する(身内向けの簡易な仕組み)。
export default function MemberLoginGate({ children }) {
  const [session, setSession] = useState(() => getMemberSession());
  const [members, setMembers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (session) return;
    listMembers()
      .then((ms) => {
        setMembers(ms);
        if (ms.length > 0) setSelectedId((prev) => prev ?? ms[0].id);
      })
      .catch((e) => setError(e.message));
  }, [session]);

  const pressDigit = (d) => {
    if (busy) return;
    setError(null);
    setPin((prev) => (prev.length >= 4 ? prev : prev + d));
  };
  const backspace = () => setPin((prev) => prev.slice(0, -1));
  const clearPin = () => setPin("");

  const selectedMember = members.find((m) => m.id === selectedId);

  const submit = useCallback(async () => {
    if (!selectedId || pin.length !== 4 || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await memberLogin(selectedId, pin);
      const m = result.member;
      setMemberSession(m);
      if (result.created_pin) {
        setNotice("暗証番号を新しく設定しました");
      }
      setSession(m);
      setPin("");
    } catch (e) {
      setError(e.message.includes("401") ? "暗証番号が正しくありません" : e.message);
      setPin("");
    } finally {
      setBusy(false);
    }
  }, [selectedId, pin, busy]);

  useEffect(() => {
    if (pin.length === 4) submit();
  }, [pin, submit]);

  if (session) {
    return (
      <div>
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 14px", background: "#F5F5F5", borderBottom: "2px solid #1E1E1E",
            fontSize: "12px", color: "#6B6B6B",
          }}
        >
          <span>
            ログイン中: <b style={{ color: "#1E1E1E" }}>{session.name}</b>
          </span>
          <button
            onClick={() => { clearMemberSession(); setSession(null); }}
            style={{
              display: "flex", alignItems: "center", gap: "4px", background: "none",
              border: "1.5px solid #1E1E1E", borderRadius: "3px", padding: "4px 8px",
              fontSize: "11px", color: "#1E1E1E", cursor: "pointer",
            }}
          >
            <LogOut size={12} /> ログアウト
          </button>
        </div>
        {children(session)}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", fontFamily: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif", color: "#1E1E1E", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 14px" }}>
      <style>{`
        .poke-window { background: #FFFFFF; border: 3px solid #1E1E1E; border-radius: 4px; box-shadow: 0 3px 0 #1E1E1E; }
      `}</style>
      <div className="poke-window" style={{ width: "100%", maxWidth: "360px", padding: "20px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "12px" }}>医局員ログイン</div>

        <div style={{ fontSize: "11px", color: "#8A8A8A", marginBottom: "6px" }}>名前を選択</div>
        <select
          value={selectedId ?? ""}
          onChange={(e) => { setSelectedId(Number(e.target.value)); setPin(""); setError(null); }}
          style={{ width: "100%", padding: "10px 12px", border: "2px solid #1E1E1E", borderRadius: "3px", fontSize: "14px", fontFamily: "inherit", outline: "none", marginBottom: "16px", boxSizing: "border-box" }}
        >
          {members.length === 0 && <option value="">(メンバー未登録)</option>}
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        <div style={{ fontSize: "11px", color: "#8A8A8A", marginBottom: "6px" }}>
          暗証番号(4桁){selectedMember && !selectedMember.has_pin && "（初めての方はここで新しく設定します）"}
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ flex: 1, aspectRatio: "1", border: "2px solid #1E1E1E", borderRadius: "3px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", fontWeight: 700 }}>
              {i < pin.length ? "●" : ""}
            </div>
          ))}
        </div>

        {error && <div style={{ fontSize: "12px", color: "#EE1515", marginBottom: "8px" }}>{error}</div>}
        {notice && !error && <div style={{ fontSize: "12px", color: "#223A70", marginBottom: "8px" }}>{notice}</div>}
        {busy && <div style={{ fontSize: "12px", color: "#8A8A8A", marginBottom: "8px" }}>確認中...</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "6px", marginBottom: "8px" }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} onClick={() => pressDigit(d)} disabled={busy || !selectedId} style={keypadBtn}>{d}</button>
          ))}
          <button onClick={backspace} disabled={busy} style={{ ...keypadBtn, background: "#F1EFE8", fontSize: "12px" }}>削除</button>
          <button onClick={() => pressDigit("0")} disabled={busy || !selectedId} style={keypadBtn}>0</button>
          <button onClick={clearPin} disabled={busy} style={{ ...keypadBtn, background: "#F1EFE8", fontSize: "12px" }}>C</button>
        </div>

        <div style={{ fontSize: "11px", color: "#8A8A8A", marginTop: "10px", lineHeight: 1.6 }}>
          身内向けの簡易な確認です。暗証番号を忘れた場合は管理者にリセットを依頼してください。
        </div>
      </div>
    </div>
  );
}

const keypadBtn = {
  padding: "10px 0", border: "2px solid #1E1E1E", borderRadius: "3px", background: "#FFFFFF",
  fontSize: "16px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
