import React, { useState, useEffect, useCallback } from "react";
import { Minus, Plus, ChevronsUp, ChevronsDown, AlertTriangle, CheckCircle2, Save, Loader2 } from "lucide-react";
import { listMembers, getQuotas, replaceQuotas } from "./api";
import PeriodPicker from "./PeriodPicker";

export default function QuotaSetting() {
  const [members, setMembers] = useState([]);
  const [period, setPeriod] = useState({ start: null, end: null, days: 0, requiredSlots: 0, valid: true });
  const [quotas, setQuotas] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    listMembers()
      .then(setMembers)
      .catch((e) => setError(e.message));
  }, []);

  const reloadQuotas = useCallback(() => {
    if (!period.start || !period.days || !period.valid) return;
    setLoading(true);
    setError(null);
    getQuotas(period.start, period.days)
      .then((rows) => {
        const byMember = Object.fromEntries(rows.map((r) => [r.member_id, { duty: r.duty_quota, oncall: r.oncall_quota }]));
        setQuotas(byMember);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [period.start, period.days, period.valid]);

  useEffect(() => {
    reloadQuotas();
  }, [reloadQuotas]);

  const seniors = members.filter((m) => m.rank === "A");
  const juniors = members.filter((m) => m.rank === "B");
  const requiredSlots = period.requiredSlots;

  const getQ = (id) => quotas[id] || { duty: 0, oncall: 0 };

  const setQuota = (id, field, delta) => {
    setQuotas((prev) => {
      const cur = prev[id] || { duty: 0, oncall: 0 };
      const next = Math.max(0, (cur[field] || 0) + delta);
      return { ...prev, [id]: { ...cur, [field]: next } };
    });
  };

  const setQuotaValue = (id, field, value) => {
    const n = Math.max(0, parseInt(value, 10) || 0);
    setQuotas((prev) => ({ ...prev, [id]: { ...(prev[id] || { duty: 0, oncall: 0 }), [field]: n } }));
  };

  const sumRank = (list) =>
    list.reduce(
      (acc, m) => {
        const q = getQ(m.id);
        acc.duty += q.duty;
        acc.oncall += q.oncall;
        return acc;
      },
      { duty: 0, oncall: 0 }
    );

  const seniorSum = sumRank(seniors);
  const juniorSum = sumRank(juniors);

  const dutyOk = seniorSum.duty === requiredSlots && juniorSum.duty === requiredSlots;
  const oncallOk = seniorSum.oncall === requiredSlots && juniorSum.oncall === requiredSlots;
  const allOk = requiredSlots > 0 && dutyOk && oncallOk;

  const save = async () => {
    if (!period.valid) return;
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const items = members.map((m) => {
        const q = getQ(m.id);
        return { member_id: m.id, duty_quota: q.duty, oncall_quota: q.oncall };
      });
      await replaceQuotas(period.start, period.days, items);
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
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
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      {/* header */}
      <div className="poke-window" style={{ margin: "16px 14px 0", padding: "16px 16px 18px" }}>
        <div className="pf" style={{ fontSize: "13px", color: "#1E1E1E", marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
          希望回数設定
          {loading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
        </div>
        <div style={{ fontSize: "12px", color: "#6B6B6B", lineHeight: 1.6 }}>
          メンバーごとに当直・オンコールの希望回数を入力してください。
          「スタート」実行時、自動割当エンジンがこの回数になるべく近づけて割り振ります。
        </div>
      </div>

      {error && (
        <div style={{ margin: "12px 14px 0", padding: "10px 14px", border: "2px solid #EE1515", borderRadius: "3px", background: "#FFF3F3", fontSize: "12px", color: "#B01010" }}>
          エラー: {error}
        </div>
      )}

      {/* target period */}
      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "14px" }}>
        <PeriodPicker onChange={setPeriod} />
      </div>

      {/* per-member quota table */}
      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "10px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#6B6B6B", padding: "4px 6px 10px" }}>
          メンバー別 希望回数
        </div>

        <div
          style={{
            position: "sticky", top: "44px", zIndex: 15, background: "#FFFFFF",
            margin: "0 4px 10px", padding: "8px 8px", border: "1.5px solid #1E1E1E", borderRadius: "3px",
            display: "flex", gap: "6px", flexWrap: "wrap",
          }}
        >
          <MiniTotal label="上級医 当直計" value={seniorSum.duty} target={requiredSlots} />
          <MiniTotal label="下級医 当直計" value={juniorSum.duty} target={requiredSlots} />
          <MiniTotal label="上級医 オンコール計" value={seniorSum.oncall} target={requiredSlots} />
          <MiniTotal label="下級医 オンコール計" value={juniorSum.oncall} target={requiredSlots} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 10px 6px", fontSize: "11px", color: "#8A8A8A" }}>
          <div style={{ width: "40px", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>氏名</div>
          <div style={{ width: "112px", textAlign: "center" }}>当直</div>
          <div style={{ width: "112px", textAlign: "center" }}>オンコール</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {members.map((m) => {
            const q = getQ(m.id);
            return (
              <div
                key={m.id}
                style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 10px", border: "1.5px solid #E4E4E4", borderRadius: "3px",
                }}
              >
                <div
                  style={{
                    width: "40px", height: "34px", flexShrink: 0,
                    background: "#1E1E1E", color: "#FFFFFF",
                    border: "2px solid #1E1E1E", borderRadius: "3px",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "1px",
                  }}
                >
                  {m.rank === "A" ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}
                  <span className="pf" style={{ fontSize: "12px" }}>{m.rank}</span>
                </div>

                <div style={{ flex: 1, fontSize: "15px", fontWeight: 600 }}>{m.name}</div>

                <QuotaStepper value={q.duty} onDelta={(d) => setQuota(m.id, "duty", d)} onChange={(v) => setQuotaValue(m.id, "duty", v)} />
                <QuotaStepper value={q.oncall} onDelta={(d) => setQuota(m.id, "oncall", d)} onChange={(v) => setQuotaValue(m.id, "oncall", v)} />
              </div>
            );
          })}
          {members.length === 0 && (
            <div style={{ padding: "20px", textAlign: "center", fontSize: "13px", color: "#8A8A8A" }}>
              メンバーが登録されていません。先にメンバー管理画面で登録してください。
            </div>
          )}
        </div>
      </div>

      {/* balance summary */}
      <div className="poke-window" style={{ margin: "12px 14px 0", padding: "14px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#6B6B6B", marginBottom: "10px" }}>
          合計チェック
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
          <SummaryCell label="上級医 当直合計" value={seniorSum.duty} target={requiredSlots} />
          <SummaryCell label="下級医 当直合計" value={juniorSum.duty} target={requiredSlots} />
          <SummaryCell label="上級医 オンコール合計" value={seniorSum.oncall} target={requiredSlots} />
          <SummaryCell label="下級医 オンコール合計" value={juniorSum.oncall} target={requiredSlots} />
        </div>
        <div
          style={{
            display: "flex", alignItems: "flex-start", gap: "8px", padding: "10px 12px",
            border: `2px solid ${allOk ? "#1E1E1E" : "#EE1515"}`, borderRadius: "3px",
            background: allOk ? "#F3FFF3" : "#FFF3F3", marginBottom: "12px",
          }}
        >
          {allOk ? <CheckCircle2 size={16} color="#1E1E1E" style={{ flexShrink: 0, marginTop: "1px" }} /> : <AlertTriangle size={16} color="#EE1515" style={{ flexShrink: 0, marginTop: "1px" }} />}
          <div style={{ fontSize: "12px", lineHeight: 1.6 }}>
            {requiredSlots === 0 ? (
              "対象期間を設定すると必要枠数が計算されます。"
            ) : allOk ? (
              "各区分の合計が必要枠数と一致しています。この設定でスタートできます。"
            ) : (
              <>
                各区分の合計が必要枠数({requiredSlots}枠)と一致していません。一致しなくても自動割当は実行できますが、
                差分は空欄またはズレとして処理されます。過不足を確認してください。
              </>
            )}
          </div>
        </div>

        <button
          onClick={save}
          disabled={saving || members.length === 0 || !period.valid}
          className="pf"
          style={{
            width: "100%", background: "#1E1E1E", color: "#FFFFFF", border: "2px solid #1E1E1E",
            borderRadius: "3px", boxShadow: "0 3px 0 #6B6B6B", fontSize: "13px", padding: "12px",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            cursor: saving ? "default" : "pointer", opacity: saving || !period.valid ? 0.6 : 1,
          }}
        >
          <Save size={15} /> {saving ? "保存中..." : "この期間の希望回数を保存"}
        </button>
        {savedAt && (
          <div style={{ fontSize: "11px", color: "#1E8A3C", marginTop: "6px", textAlign: "center" }}>
            保存しました({savedAt.toLocaleTimeString("ja-JP")})
          </div>
        )}
      </div>

      <div style={{ padding: "14px 18px 24px", fontSize: "12px", color: "#8A8A8A", lineHeight: 1.7 }}>
        ▶ ここで設定した希望回数は、自動割当エンジンにそのまま渡されます。
        <br />
        ▶ 完全に一致させなくても実行可能です(希望回数からのズレを最小化するソフト制約)。
      </div>
    </div>
  );
}

function QuotaStepper({ value, onDelta, onChange }) {
  return (
    <div style={{ width: "112px", display: "flex", alignItems: "center", border: "2px solid #1E1E1E", borderRadius: "3px", overflow: "hidden", flexShrink: 0 }}>
      <button
        onClick={() => onDelta(-1)}
        style={{ width: "28px", height: "32px", border: "none", background: "#FFFFFF", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <Minus size={13} />
      </button>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pf"
        style={{
          flex: 1, minWidth: 0, textAlign: "center", border: "none", borderLeft: "2px solid #1E1E1E", borderRight: "2px solid #1E1E1E",
          height: "32px", fontSize: "14px", outline: "none", color: "#1E1E1E",
        }}
      />
      <button
        onClick={() => onDelta(1)}
        style={{ width: "28px", height: "32px", border: "none", background: "#FFFFFF", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

function MiniTotal({ label, value, target }) {
  const ok = value === target && target > 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#6B6B6B" }}>
      <span>{label}</span>
      <span className="pf" style={{ fontSize: "13px", color: ok ? "#1E7A34" : "#EE1515" }}>
        {value}
        <span style={{ fontSize: "10px", fontFamily: "inherit", fontWeight: 400, color: "#8A8A8A" }}>/{target || "―"}</span>
      </span>
    </div>
  );
}

function SummaryCell({ label, value, target }) {
  const ok = value === target && target > 0;
  return (
    <div style={{ flex: "1 1 130px", border: "1.5px solid #E4E4E4", borderRadius: "3px", padding: "8px 10px" }}>
      <div style={{ fontSize: "10px", color: "#8A8A8A", marginBottom: "4px" }}>{label}</div>
      <div className="pf" style={{ fontSize: "16px", color: ok ? "#1E1E1E" : "#EE1515" }}>
        {value}
        <span style={{ fontSize: "11px", fontFamily: "inherit", fontWeight: 400, color: "#8A8A8A" }}> / {target || "―"}</span>
      </div>
    </div>
  );
}
