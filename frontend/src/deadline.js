// 希望入力の募集期間・締切に関する計算。
// ルール: ある月(対象月)の希望は、その前月の「第1月曜日」から募集開始し、
// 同じ週の「金曜日 12:00」が締切。

export function getRecruitmentWindow(targetYear, targetMonth0) {
  // targetMonth0: 0-indexed の対象月(この月の希望を入力する)
  let ry = targetYear;
  let rm = targetMonth0 - 1; // 募集は前月に行う
  if (rm < 0) { rm = 11; ry -= 1; }

  const firstOfMonth = new Date(ry, rm, 1);
  const dow = firstOfMonth.getDay(); // 0=日,1=月,...
  const offsetToMonday = (1 - dow + 7) % 7;
  const firstMonday = new Date(ry, rm, 1 + offsetToMonday);

  const deadline = new Date(firstMonday);
  deadline.setDate(firstMonday.getDate() + 4); // 月+4日=金
  deadline.setHours(12, 0, 0, 0);

  const start = new Date(firstMonday);
  start.setHours(0, 0, 0, 0);

  return { start, deadline };
}

export function getDeadlineStatus(now, targetYear, targetMonth0) {
  const { start, deadline } = getRecruitmentWindow(targetYear, targetMonth0);
  let phase;
  if (now < start) phase = "before";
  else if (now <= deadline) phase = "open";
  else phase = "closed";

  const msLeft = deadline - now;
  const hoursLeft = Math.ceil(msLeft / (1000 * 60 * 60));
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

  return { start, deadline, phase, hoursLeft, daysLeft };
}

export function formatDeadlineLabel(dt) {
  const w = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${dt.getMonth() + 1}/${dt.getDate()}(${w}) ${hh}:${mm}`;
}
