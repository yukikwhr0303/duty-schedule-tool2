import React, { useState, useEffect, useCallback } from "react";
import { Plus, X, Pencil, Check, ChevronsUp, ChevronsDown, ChevronUp, ChevronDown, Loader2, KeyRound, Power, Ban } from "lucide-react";
import { listMembers, createMember, updateMember, deleteMember, resetMemberPin, reorderMembers, listNgPairs, createNgPair, deleteNgPair } from "./api";

// ---- 既存プロトタイプと同じトークン(白×黒・角ばった丸み) ----
// bg:#FFFFFF window:#FFFFFF border:#1E1E1E red:#EE1515 yellow:#FFCB05 navy:#223A70

export default function MemberManagement() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [newRank, setNewRank] = useState("A");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  const [ngPairs, setNgPairs] = useState([]);
  const [ngLoading, setNgLoading] = useState(true);
  const [ngError, setNgError] = useState(null);
  const [ngBusy, setNgBusy] = useState(false);
  const [ngA, setNgA] = useState("");
  const [ngB, setNgB] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    listMembers()
      .then(setMembers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const reloadNgPairs = useCallback(() => {
    setNgLoading(true);
    setNgError(null);
    listNgPairs()
      .then(setNgPairs)
      .catch((e) => setNgError(e.message))
      .finally(() => setNgLoading(false));
  }, []);

  useEffect(() => {
    reload();
    reloadNgPairs();
  }, [reload, reloadNgPairs]);

  const seniorCount = members.filter((m) => m.rank === "A" && m.is_active !== false).length;
  const juniorCount = members.filter((m) => m.rank === "B" && m.is_active !== false).length;

  const addMember = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createMember({ name, rank: newRank });
      setMembers((prev) => [...prev, created]);
      setNewName("");
      setNewRank("A");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (id) => {
    setBusy(true);
    setError(null);
    try {
      await deleteMember(id);
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleRank = async (m) => {
    const nextRank = m.rank === "A" ? "B" : "A";
    setError(null);
    // 楽観的更新
    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, rank: nextRank } : x)));
    try {
      await updateMember(m.id, { rank: nextRank });
    } catch (e) {
      setError(e.message);
      reload();
    }
  };

  const moveMember = async (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= members.length || busy) return;
    const reordered = [...members];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
    setMembers(reordered);
    setBusy(true);
    setError(null);
    try {
      const updated = await reorderMembers(reordered.map((m) => m.id));
      setMembers(updated);
    } catch (e) {
      setError(e.message);
      reload();
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (m) => {
    const nextActive = !(m.is_active !== false);
    setError(null);
    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_active: nextActive } : x)));
    try {
      await updateMember(m.id, { is_active: nextActive });
    } catch (e) {
      setError(e.message);
      reload();
    }
  };

  const resetPin = async (m) => {
    if (!window.confirm(`${m.name}さんの暗証番号をリセットしますか？（次回ログイン時に本人が再設定します）`)) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await resetMemberPin(m.id);
      setMembers((prev) => prev.map((x) => (x.id === m.id ? updated : x)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addNgPair = async () => {
    if (!ngA || !ngB || ngA === ngB || ngBusy) return;
    setNgBusy(true);
    setNgError(null);
    try {
      await createNgPair(Number(ngA), Number(ngB));
      setNgA("");
      setNgB("");
      reloadNgPairs();
    } catch (e) {
      setNgError(e.message);
    } finally {
      setNgBusy(false);
    }
  };

  const removeNgPair = async (id) => {
    setNgBusy(true);
    setNgError(null);
    try {
      await deleteNgPair(id);
      setNgPairs((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setNgError(e.message);
    } finally {
      setNgBusy(false);
    }
  };

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditName(m.name);
  };

  const commitEdit = async (id) => {
    const name = editName.trim();
    setEditingId(null);
    if (!name) return;
    setError(null);
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, name } : m)));
    try {
      await updateMember(id, { name });
    } catch (e) {
      setError(e.message);
      reload();
    }
    setEditName("");
  };

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
      `}</style>

      {/* header */}
      <div className="poke-window" style={{ margin: "16px 14px 0", padding: "16px 16px 18px" }}>
        <div className="pf" style={{ fontSize: "13px", color: "#1E1E1E", marginBottom: "10px" }}>
          メンバー管理
        </div>
        <div style={{ display: "flex", gap: "16px", fontSize: "13px", color: "#6B6B6B" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <ChevronsUp size={14} /> 上級医 <b className="pf" style={{ color: "#1E1E1E", fontSize: "16px" }}>{seniorCount}</b>名
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <ChevronsDown size={14} /> 下級医 <b className="pf" style={{ color: "#1E1E1E", fontSize: "16px" }}>{juniorCount}</b>名
          </span>
          {loading && <Loader2 size={14} className="spin" style={{ animation: "spin 1s linear infinite" }} />}
        </div>
      </div>

      {error && (
        <div style={{ margin: "12px 14px 0", padding: "10px 14px", border: "2px solid #EE1515", borderRadius: "3px", background: "#FFF3F3", fontSize: "12px", color: "#B01010" }}>
          エラー: {error}
        </div>
      )}

      {/* add member */}
      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "14px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#6B6B6B", marginBottom: "10px" }}>
          メンバーを追加
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMember()}
            placeholder="氏名を入力"
            style={{
              flex: 1, padding: "10px 12px", border: "2px solid #1E1E1E", borderRadius: "3px",
              fontSize: "14px", fontFamily: "inherit", outline: "none", color: "#1E1E1E",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <RankToggle rank={newRank} onChange={setNewRank} />
          <button
            onClick={addMember}
            disabled={busy}
            className="pf"
            style={{
              flex: 1, background: "#1E1E1E", color: "#FFFFFF", border: "2px solid #1E1E1E",
              borderRadius: "3px", boxShadow: "0 3px 0 #6B6B6B", fontSize: "12px",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}
          >
            <Plus size={14} /> 追加
          </button>
        </div>
      </div>

      {/* member list */}
      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "10px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#6B6B6B", padding: "4px 6px 10px" }}>
          メンバー一覧（タップでA/B切り替え）
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {members.map((m, index) => {
            const active = m.is_active !== false;
            return (
            <div
              key={m.id}
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 10px", border: "1.5px solid #E4E4E4", borderRadius: "3px",
                opacity: active ? 1 : 0.5,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", flexShrink: 0 }}>
                <button
                  onClick={() => moveMember(index, -1)}
                  disabled={busy || index === 0}
                  title="上に移動"
                  style={{ ...iconBtn, padding: "2px", opacity: index === 0 ? 0.3 : 1 }}
                >
                  <ChevronUp size={14} color="#6B6B6B" />
                </button>
                <button
                  onClick={() => moveMember(index, 1)}
                  disabled={busy || index === members.length - 1}
                  title="下に移動"
                  style={{ ...iconBtn, padding: "2px", opacity: index === members.length - 1 ? 0.3 : 1 }}
                >
                  <ChevronDown size={14} color="#6B6B6B" />
                </button>
              </div>

              <button
                onClick={() => toggleRank(m)}
                style={{
                  width: "40px", height: "34px", flexShrink: 0,
                  background: "#1E1E1E",
                  color: "#FFFFFF",
                  border: "2px solid #1E1E1E", borderRadius: "3px",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "1px",
                  cursor: "pointer",
                }}
                title="タップでA/B切り替え"
              >
                {m.rank === "A" ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}
                <span className="pf" style={{ fontSize: "12px" }}>{m.rank}</span>
              </button>

              {editingId === m.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && commitEdit(m.id)}
                  onBlur={() => commitEdit(m.id)}
                  style={{
                    flex: 1, padding: "8px 10px", border: "2px solid #223A70", borderRadius: "3px",
                    fontSize: "14px", fontFamily: "inherit", outline: "none",
                  }}
                />
              ) : (
                <div style={{ flex: 1, fontSize: "15px", fontWeight: 600 }}>{m.name}</div>
              )}

              <span style={{ fontSize: "11px", color: "#8A8A8A", width: "58px" }}>
                {m.rank === "A" ? "上級医" : "下級医"}
              </span>

              <span style={{ fontSize: "10px", color: m.has_pin ? "#6B6B6B" : "#C99A00", width: "56px" }}>
                {m.has_pin ? "PIN設定済" : "PIN未設定"}
              </span>

              <button
                onClick={() => toggleActive(m)}
                disabled={busy}
                title={active ? "休止にする（当直から外す）" : "在籍に戻す"}
                className="pf"
                style={{
                  width: "64px", padding: "6px 0", flexShrink: 0,
                  background: active ? "#FFFFFF" : "#1E1E1E",
                  color: active ? "#6B6B6B" : "#FFFFFF",
                  border: `2px solid ${active ? "#C9C9C9" : "#1E1E1E"}`, borderRadius: "3px",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
                  fontSize: "11px", cursor: "pointer",
                }}
              >
                <Power size={12} />
                {active ? "在籍中" : "休止中"}
              </button>

              <button onClick={() => resetPin(m)} disabled={busy} title="暗証番号をリセット" style={iconBtn}>
                <KeyRound size={14} color="#223A70" />
              </button>

              {editingId === m.id ? (
                <button onClick={() => commitEdit(m.id)} style={iconBtn}>
                  <Check size={15} color="#1E1E1E" />
                </button>
              ) : (
                <button onClick={() => startEdit(m)} style={iconBtn}>
                  <Pencil size={14} color="#6B6B6B" />
                </button>
              )}
              <button onClick={() => removeMember(m.id)} style={iconBtn}>
                <X size={15} color="#EE1515" />
              </button>
            </div>
          );})}
          {!loading && members.length === 0 && (
            <div style={{ padding: "20px", textAlign: "center", fontSize: "13px", color: "#8A8A8A" }}>
              メンバーが登録されていません
            </div>
          )}
        </div>
      </div>

      {/* NGペア設定 */}
      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "14px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#6B6B6B", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
          <Ban size={14} color="#EE1515" /> NGペア設定
        </div>
        <div style={{ fontSize: "11px", color: "#8A8A8A", marginBottom: "10px", lineHeight: 1.6 }}>
          登録した2人は、自動割り当てで同じ日の当直/オンコールの組み合わせにならないようになります（向きは問いません）。
        </div>

        {ngError && (
          <div style={{ marginBottom: "10px", padding: "8px 10px", border: "2px solid #EE1515", borderRadius: "3px", background: "#FFF3F3", fontSize: "12px", color: "#B01010" }}>
            エラー: {ngError}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
          {ngPairs.map((p) => (
            <div
              key={p.id}
              aria-label={`NGペア: ${p.member_a_name} と ${p.member_b_name}`}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "8px 10px", border: "1.5px solid #E4E4E4", borderRadius: "3px",
              }}
            >
              <div style={{ flex: 1, fontSize: "13px", fontWeight: 600 }}>
                {p.member_a_name} <span style={{ color: "#EE1515", fontWeight: 700 }}>×</span> {p.member_b_name}
              </div>
              <button onClick={() => removeNgPair(p.id)} disabled={ngBusy} aria-label={`${p.member_a_name}と${p.member_b_name}のNGペアを削除`} style={iconBtn}>
                <X size={15} color="#EE1515" />
              </button>
            </div>
          ))}
          {!ngLoading && ngPairs.length === 0 && (
            <div style={{ padding: "10px", textAlign: "center", fontSize: "12px", color: "#8A8A8A" }}>
              NGペアは登録されていません
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <select
            value={ngA}
            onChange={(e) => setNgA(e.target.value)}
            style={{
              flex: 1, padding: "9px 8px", border: "2px solid #1E1E1E", borderRadius: "3px",
              fontSize: "13px", fontFamily: "inherit", color: "#1E1E1E", background: "#FFFFFF",
            }}
          >
            <option value="">選択</option>
            {members.map((m) => (
              <option key={m.id} value={m.id} disabled={String(m.id) === ngB}>
                {m.name}
              </option>
            ))}
          </select>
          <span style={{ fontSize: "12px", color: "#8A8A8A" }}>×</span>
          <select
            value={ngB}
            onChange={(e) => setNgB(e.target.value)}
            style={{
              flex: 1, padding: "9px 8px", border: "2px solid #1E1E1E", borderRadius: "3px",
              fontSize: "13px", fontFamily: "inherit", color: "#1E1E1E", background: "#FFFFFF",
            }}
          >
            <option value="">選択</option>
            {members.map((m) => (
              <option key={m.id} value={m.id} disabled={String(m.id) === ngA}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            onClick={addNgPair}
            disabled={!ngA || !ngB || ngA === ngB || ngBusy}
            aria-label="NGペアを登録"
            className="pf"
            style={{
              flexShrink: 0, padding: "9px 12px", background: "#1E1E1E", color: "#FFFFFF",
              border: "2px solid #1E1E1E", borderRadius: "3px", boxShadow: "0 3px 0 #6B6B6B",
              fontSize: "12px", display: "flex", alignItems: "center", gap: "4px",
              cursor: (!ngA || !ngB || ngA === ngB || ngBusy) ? "default" : "pointer",
              opacity: (!ngA || !ngB || ngA === ngB || ngBusy) ? 0.5 : 1,
            }}
          >
            <Plus size={14} /> 登録
          </button>
        </div>
      </div>

      <div style={{ padding: "14px 18px 0", fontSize: "12px", color: "#8A8A8A", lineHeight: 1.7 }}>
        ▶ ここで登録したメンバーが、当直・オンコール希望入力や希望回数設定の画面に反映されます。
      </div>
    </div>
  );
}

function RankToggle({ rank, onChange }) {
  return (
    <div style={{ display: "flex", border: "2px solid #1E1E1E", borderRadius: "3px", overflow: "hidden" }}>
      {[
        { r: "A", Icon: ChevronsUp, label: "上級医" },
        { r: "B", Icon: ChevronsDown, label: "下級医" },
      ].map(({ r, Icon, label }) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          style={{
            width: "72px", padding: "9px 0", border: "none",
            borderLeft: r === "B" ? "2px solid #1E1E1E" : "none",
            background: rank === r ? "#1E1E1E" : "#FFFFFF",
            color: rank === r ? "#FFFFFF" : "#8A8A8A",
            display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
            cursor: "pointer",
          }}
        >
          <Icon size={15} />
          <span className="pf" style={{ fontSize: "10px" }}>{r}</span>
        </button>
      ))}
    </div>
  );
}

const iconBtn = {
  background: "none", border: "none", padding: "6px", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};
