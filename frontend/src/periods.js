// 募集・回数設定・自動割当で使う「期間」の定義。
// 基本は月単位だが、年末年始だけ官公庁の休みに合わせて分ける:
//   12月      : 12/1  〜 12/28
//   年末年始  : 12/29 〜 翌1/3   (12月の締切と同じ)
//   1月       : 1/4   〜 1/31    (通常の1月の締切)
// 期間は { year, month(1-12), kind: "month" | "ny" } で表す。
//   kind "ny" は「year年12月29日〜(year+1)年1月3日」。それ以外の月は kind "month"。
import { isoDate, daysInMonth, pad2 } from "./holidays";

export const NY_START = { month: 12, day: 29 };
export const NY_END = { month: 1, day: 3 };

export const monthPeriod = (year, month) => ({ year, month, kind: "month" });
export const nyPeriod = (year) => ({ year, month: 12, kind: "ny" });

export function periodRange(p) {
  if (p.kind === "ny") {
    return { start: isoDate(p.year, 12, 29), end: isoDate(p.year + 1, 1, 3), days: 6 };
  }
  if (p.month === 12) return { start: isoDate(p.year, 12, 1), end: isoDate(p.year, 12, 28), days: 28 };
  if (p.month === 1) {
    const last = daysInMonth(p.year, 1);
    return { start: isoDate(p.year, 1, 4), end: isoDate(p.year, 1, last), days: last - 3 };
  }
  const last = daysInMonth(p.year, p.month);
  return { start: isoDate(p.year, p.month, 1), end: isoDate(p.year, p.month, last), days: last };
}

// その期間の日付(Date)を順に並べたもの
export function periodDates(p) {
  const { start, days } = periodRange(p);
  const s = new Date(start + "T00:00:00");
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(s);
    d.setDate(s.getDate() + i);
    return d;
  });
}

export function periodLabel(p, withRange = false) {
  if (p.kind === "ny") return withRange ? "年末年始(12/29〜1/3)" : "年末年始";
  if (!withRange) return `${p.month}月`;
  const r = periodRange(p);
  const e = new Date(r.end + "T00:00:00");
  const s = new Date(r.start + "T00:00:00");
  if (p.month === 12) return `12月(12/1〜12/${e.getDate()})`;
  if (p.month === 1) return `1月(1/${s.getDate()}〜1/${e.getDate()})`;
  return `${p.month}月`;
}

// 画面の見出し用: "2026/12" "2026/年末年始" "2027/01"
export function periodTitle(p) {
  return p.kind === "ny" ? `${p.year}/年末年始` : `${p.year}/${pad2(p.month)}`;
}

export function periodKey(p) {
  return p.kind === "ny" ? `${p.year}-ny` : `${p.year}-${p.month}`;
}

export function shiftPeriod(p, delta) {
  let cur = p;
  const step = delta > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(delta); i++) {
    if (step > 0) {
      if (cur.kind === "ny") cur = monthPeriod(cur.year + 1, 1);
      else if (cur.month === 12) cur = nyPeriod(cur.year);
      else cur = monthPeriod(cur.year, cur.month + 1);
    } else {
      if (cur.kind === "ny") cur = monthPeriod(cur.year, 12);
      else if (cur.month === 1) cur = nyPeriod(cur.year - 1);
      else cur = monthPeriod(cur.year, cur.month - 1);
    }
  }
  return cur;
}

// 指定した年の期間一覧(1月〜12月、最後に年末年始)
export function periodsOfYear(year) {
  return [...Array.from({ length: 12 }, (_, i) => monthPeriod(year, i + 1)), nyPeriod(year)];
}

// ある日付が含まれる期間
export function periodContaining(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const y = date.getFullYear();
  if (m === 12 && d >= 29) return nyPeriod(y);
  if (m === 1 && d <= 3) return nyPeriod(y - 1);
  return monthPeriod(y, m);
}

// 今まさに募集している対象(=「翌月」)。12月の間は1月(1/4〜)、11月の間は12月(〜12/28)。
export function defaultTargetPeriod(now = new Date()) {
  let y = now.getFullYear();
  let m = now.getMonth() + 2;
  if (m > 12) { m = 1; y += 1; }
  return monthPeriod(y, m);
}

// 締切の基準になる月(0始まり): 年末年始は12月分と同じ締切、それ以外は各月の通常の締切
export function deadlineBasis(p) {
  return { year: p.year, month0: p.kind === "ny" ? 11 : p.month - 1 };
}
