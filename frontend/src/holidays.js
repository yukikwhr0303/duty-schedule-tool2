// 祝日データ(2025〜2027年)。duty-calendar-prototype.jsx / バックエンド app/holidays.py と同一データ。
// 2028年以降を扱う場合はここに追加が必要(README_引き継ぎ.md参照)。
export const HOLIDAYS = {
  "2025-1-1": "元日", "2025-1-13": "成人の日", "2025-2-11": "建国記念の日",
  "2025-2-23": "天皇誕生日", "2025-2-24": "振替休日", "2025-3-20": "春分の日",
  "2025-4-29": "昭和の日", "2025-5-3": "憲法記念日", "2025-5-4": "みどりの日",
  "2025-5-5": "こどもの日", "2025-5-6": "振替休日", "2025-7-21": "海の日",
  "2025-8-11": "山の日", "2025-9-15": "敬老の日", "2025-9-23": "秋分の日",
  "2025-10-13": "スポーツの日", "2025-11-3": "文化の日", "2025-11-23": "勤労感謝の日",
  "2025-11-24": "振替休日",
  "2026-1-1": "元日", "2026-1-12": "成人の日", "2026-2-11": "建国記念の日",
  "2026-2-23": "天皇誕生日", "2026-3-20": "春分の日", "2026-4-29": "昭和の日",
  "2026-5-3": "憲法記念日", "2026-5-4": "みどりの日", "2026-5-5": "こどもの日",
  "2026-5-6": "振替休日", "2026-7-20": "海の日", "2026-8-11": "山の日",
  "2026-9-21": "敬老の日", "2026-9-22": "国民の休日", "2026-9-23": "秋分の日",
  "2026-10-12": "スポーツの日", "2026-11-3": "文化の日", "2026-11-23": "勤労感謝の日",
  "2027-1-1": "元日", "2027-1-11": "成人の日", "2027-2-11": "建国記念の日",
  "2027-2-23": "天皇誕生日", "2027-3-21": "春分の日", "2027-3-22": "振替休日",
  "2027-4-29": "昭和の日", "2027-5-3": "憲法記念日", "2027-5-4": "みどりの日",
  "2027-5-5": "こどもの日", "2027-7-19": "海の日", "2027-8-11": "山の日",
  "2027-9-20": "敬老の日", "2027-9-23": "秋分の日", "2027-10-11": "スポーツの日",
  "2027-11-3": "文化の日", "2027-11-23": "勤労感謝の日",
};

// 祝日データが用意されている年のみ選択可
export const YEAR_OPTIONS = [2025, 2026, 2027];

export function isHoliday(dt) {
  const k = `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
  return HOLIDAYS[k] || null;
}

export function isWeekendOrHoliday(dt) {
  const w = dt.getDay();
  return w === 0 || w === 6 || !!isHoliday(dt);
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

export function isoDate(year, month1to12, day) {
  return `${year}-${pad2(month1to12)}-${pad2(day)}`;
}

export function countPeriods(startStr, days) {
  if (!startStr || !days) return 0;
  const start = new Date(startStr + "T00:00:00");
  let total = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    total += isWeekendOrHoliday(d) ? 2 : 1;
  }
  return total;
}

export function daysBetweenInclusive(startStr, endStr) {
  const s = new Date(startStr + "T00:00:00");
  const e = new Date(endStr + "T00:00:00");
  return Math.round((e - s) / 86400000) + 1;
}
