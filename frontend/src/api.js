// バックエンド(FastAPI)への共通アクセス関数。
// VITE_API_BASE で接続先を切り替えられる(.env参照。未設定時は http://localhost:8000)。
// Render Blueprintではホスト名だけ(例: xxx.onrender.com)が渡ってくるため、
// スキーム(http/https)が付いていなければ https:// を自動補完する。
function normalizeApiBase(raw) {
  if (!raw) return "http://localhost:8000";
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
}

const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE);

// ---------- 簡易認証(身内向け) ----------
// 管理者パスワードはこの端末のlocalStorageに平文で保持し、
// 管理系エンドポイントにはX-Admin-Passwordヘッダーとして毎回添付する。
const ADMIN_PW_KEY = "duty_admin_password";
export const getAdminPassword = () => localStorage.getItem(ADMIN_PW_KEY) || "";
export const setAdminPassword = (pw) => localStorage.setItem(ADMIN_PW_KEY, pw);
export const clearAdminPassword = () => localStorage.removeItem(ADMIN_PW_KEY);
export const isAdminLoggedIn = () => !!getAdminPassword();

const MEMBER_SESSION_KEY = "duty_member_session";
export const getMemberSession = () => {
  try {
    const raw = localStorage.getItem(MEMBER_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};
export const setMemberSession = (member) => localStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(member));
export const clearMemberSession = () => localStorage.removeItem(MEMBER_SESSION_KEY);

async function request(path, options = {}, { admin = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (admin) headers["X-Admin-Password"] = getAdminPassword();
  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ? JSON.stringify(body.detail) : detail;
    } catch (_) {
      /* ignore */
    }
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- members ----------
export const listMembers = () => request("/members");
export const createMember = (data) => request("/members", { method: "POST", body: JSON.stringify(data) }, { admin: true });
export const updateMember = (id, data) => request(`/members/${id}`, { method: "PUT", body: JSON.stringify(data) }, { admin: true });
export const deleteMember = (id) => request(`/members/${id}`, { method: "DELETE" }, { admin: true });
export const memberLogin = (id, pin) => request(`/members/${id}/login`, { method: "POST", body: JSON.stringify({ pin }) });
export const resetMemberPin = (id) => request(`/members/${id}/reset-pin`, { method: "PATCH" }, { admin: true });
export const adminLogin = (password) => request("/auth/admin/login", { method: "POST", body: JSON.stringify({ password }) });

// ---------- availability ----------
export const getAvailability = (memberId, start, end) => {
  const params = new URLSearchParams({ member_id: memberId, start, end });
  return request(`/availability?${params.toString()}`);
};
export const replaceAvailability = (memberId, start, end, entries) =>
  request(`/availability/${memberId}`, {
    method: "PUT",
    body: JSON.stringify({ start, end, entries }),
  });

// ---------- quotas ----------
export const getQuotas = (periodStart, periodDays) => {
  const params = new URLSearchParams({ period_start: periodStart, period_days: periodDays });
  return request(`/quotas?${params.toString()}`);
};
export const replaceQuotas = (periodStart, periodDays, items) =>
  request("/quotas", {
    method: "PUT",
    body: JSON.stringify({ period_start: periodStart, period_days: periodDays, items }),
  }, { admin: true });

// ---------- fixed slots ----------
export const listFixedSlots = (start, end) => {
  const params = new URLSearchParams({ start, end });
  return request(`/fixed-slots?${params.toString()}`);
};
export const createFixedSlot = (data) => request("/fixed-slots", { method: "POST", body: JSON.stringify(data) }, { admin: true });
export const deleteFixedSlot = (id) => request(`/fixed-slots/${id}`, { method: "DELETE" }, { admin: true });

// ---------- schedule ----------
export const runSchedule = (startDate, days) =>
  request("/schedule/run", { method: "POST", body: JSON.stringify({ start_date: startDate, days }) }, { admin: true });
export const listScheduleRuns = () => request("/schedule/runs");
export const getScheduleRun = (id) => request(`/schedule/runs/${id}`);
export const exportUrl = (id, format) => `${API_BASE}/schedule/runs/${id}/export.${format}`;
export const getCandidates = (runId, assignmentId) =>
  request(`/schedule/runs/${runId}/assignments/${assignmentId}/candidates`);
export const patchAssignment = (runId, assignmentId, memberId) =>
  request(`/schedule/runs/${runId}/assignments/${assignmentId}`, {
    method: "PATCH",
    body: JSON.stringify({ member_id: memberId }),
  }, { admin: true });

export { API_BASE };
