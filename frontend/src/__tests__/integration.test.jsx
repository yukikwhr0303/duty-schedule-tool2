import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemberManagement from "../MemberManagement";
import QuotaSetting from "../QuotaSetting";
import DutyCalendar from "../DutyCalendar";
import ScheduleRunPanel from "../ScheduleRunPanel";
import AdminPage from "../AdminPage";
import MemberLoginGate from "../MemberLoginGate";
import AdminLoginGate from "../AdminLoginGate";
import MemberAvailabilityViewer from "../MemberAvailabilityViewer";
import MissingSubmissions from "../MissingSubmissions";
import SubmissionLog from "../SubmissionLog";
import { formatJst } from "../deadline";
import { setAdminPassword, clearAdminPassword, clearMemberSession } from "../api";

const API_BASE = "http://127.0.0.1:8000";
const ADMIN_PASSWORD = "changeme";

describe("実バックエンドとの結合テスト", () => {
  beforeEach(() => {
    // 既存の画面テストは管理者ログイン済みの状態を前提とする(認証ゲート自体は別テストで検証する)
    setAdminPassword(ADMIN_PASSWORD);
  });
  afterEach(() => cleanup());

  it("メンバー管理画面: 追加したメンバーがバックエンドに保存される", async () => {
    const user = userEvent.setup();
    render(<MemberManagement />);

    await waitFor(() => expect(screen.getByPlaceholderText("氏名を入力")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("氏名を入力"), "テスト太郎");
    await user.click(screen.getByRole("button", { name: /追加/ }));

    // NGペア設定の選択肢にも同名テキストが現れるため、一覧側(先頭)の要素で判定する
    await waitFor(() => expect(screen.getAllByText("テスト太郎")[0]).toBeInTheDocument());

    const res = await fetch(`${API_BASE}/members`);
    const members = await res.json();
    expect(members.some((m) => m.name === "テスト太郎" && m.rank === "A")).toBe(true);
  });

  it("メンバー管理画面: A/Bをタップで切り替えるとバックエンドに反映される", async () => {
    const user = userEvent.setup();
    render(<MemberManagement />);
    await waitFor(() => expect(screen.getAllByText("テスト太郎")[0]).toBeInTheDocument());

    const row = screen.getAllByText("テスト太郎")[0].closest("div");
    const toggleBtn = within(row.parentElement).getByTitle("タップでA/B切り替え");
    await user.click(toggleBtn);

    await waitFor(async () => {
      const res = await fetch(`${API_BASE}/members`);
      const members = await res.json();
      const m = members.find((x) => x.name === "テスト太郎");
      expect(m.rank).toBe("B");
    });
  });

  it("希望回数設定画面: 対象月を選ぶと月単位(1日〜末日)で保存される", async () => {
    const user = userEvent.setup();
    render(<QuotaSetting />);

    await waitFor(() => expect(screen.getByText("テスト太郎")).toBeInTheDocument());

    // 対象月を 2026年9月 に設定
    const comboboxes = screen.getAllByRole("combobox");
    expect(comboboxes.length).toBe(2); // 年, 月
    await user.selectOptions(comboboxes[0], "2026");
    await user.selectOptions(comboboxes[1], "9");

    await waitFor(() => expect(screen.getByText(/9\/1.*〜.*9\/30.*30日間/)).toBeInTheDocument());

    const memberRow = screen.getByText("テスト太郎").closest("div").parentElement;
    const steppers = within(memberRow).getAllByRole("spinbutton");
    expect(steppers.length).toBe(2); // 当直, オンコール

    await user.clear(steppers[0]);
    await user.type(steppers[0], "5");
    await user.clear(steppers[1]);
    await user.type(steppers[1], "2");

    await user.click(screen.getByRole("button", { name: /この期間の希望回数を保存/ }));

    await waitFor(() => expect(screen.getByText(/保存しました/)).toBeInTheDocument());

    const res = await fetch(`${API_BASE}/quotas?period_start=2026-09-01&period_days=30`);
    const quotas = await res.json();
    expect(quotas.some((q) => q.duty_quota === 5 && q.oncall_quota === 2)).toBe(true);
  });

  it("希望回数設定画面: 日単位オプションを開いて期間を変えると、必要枠数が再計算される", async () => {
    const user = userEvent.setup();
    render(<QuotaSetting />);

    await waitFor(() => expect(screen.getByText("テスト太郎")).toBeInTheDocument());
    const comboboxes = screen.getAllByRole("combobox");
    await user.selectOptions(comboboxes[0], "2026");
    await user.selectOptions(comboboxes[1], "9");
    await waitFor(() => expect(screen.getByText(/9\/1.*〜.*9\/30.*30日間/)).toBeInTheDocument());

    await user.click(screen.getByText(/日単位で細かく指定する/));
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBe(2);

    await user.clear(dateInputs[1]);
    await user.type(dateInputs[1], "2026-09-10");

    await waitFor(() => expect(screen.getByText(/9\/1.*〜.*9\/10.*10日間/)).toBeInTheDocument());

    // 対象月を変更すると日単位指定は自動リセットされ、月単位(30日間)に戻る
    await user.selectOptions(comboboxes[1], "10");
    await waitFor(() => expect(screen.getByText(/10\/1.*〜.*10\/31.*31日間/)).toBeInTheDocument());
    expect(screen.queryByText(/日単位で細かく指定する/)).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="date"]').length).toBe(0);
  });

  it("希望入力カレンダー画面: 平日を不可にするとバックエンドに保存される", async () => {
    const user = userEvent.setup();

    // ログインゲートを経由せず、ログイン済みメンバーとして直接カレンダーを開く想定でテストする
    // (ログインゲート自体の挙動は別テストで検証する)
    const res = await fetch(`${API_BASE}/members`);
    const members = await res.json();
    const testMember = members.find((m) => m.name === "テスト太郎") || members[0];

    render(<DutyCalendar member={testMember} />);

    await waitFor(() => expect(screen.getByText("当直・オンコール希望入力")).toBeInTheDocument());

    // 当月のどこかの平日をクリックする(「保存されるか」だけをテストしたいため)
    const dayButtons = screen.getAllByRole("button").filter((b) => /^\d+$/.test(b.textContent || ""));
    expect(dayButtons.length).toBeGreaterThan(0);
    await user.click(dayButtons[0]);

    await waitFor(() => expect(screen.getByText("不可にする枠を選んでください")).toBeInTheDocument());

    await user.click(screen.getAllByText("当直")[0]);
    await user.click(screen.getByRole("button", { name: /^▶\s*保存$/ }));

    await waitFor(() => expect(screen.queryByText("不可にする枠を選んでください")).not.toBeInTheDocument());
  });

  it("自動割当・結果: スタートを実行し、結果カレンダーから手動で担当者を入れ替えられる", async () => {
    const user = userEvent.setup();

    // シナリオ用に上級医1名・下級医1名を追加(直接API経由。管理者操作のためヘッダーが必要)
    const adminHeaders = { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD };
    const seniorRes = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "手動テスト上級医", rank: "A" }),
    });
    const senior = await seniorRes.json();
    const juniorRes = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "手動テスト下級医", rank: "B" }),
    });
    const junior = await juniorRes.json();
    const senior2Res = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "手動テスト上級医2", rank: "A" }),
    });
    const senior2 = await senior2Res.json();
    const junior2Res = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "手動テスト下級医2", rank: "B" }),
    });
    const junior2 = await junior2Res.json();

    // 対象期間: 2026-09-01 〜 2日間(3連続ルールの影響を受けない短さにしておく)。
    // 手動テスト下級医2はquota 0にして、この期間には自動では割り当てられないようにしておく
    // (=入れ替え候補として常に空いている状態を保証するため)。
    await fetch(`${API_BASE}/quotas`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        period_start: "2026-09-01",
        period_days: 2,
        items: [
          { member_id: senior.id, duty_quota: 1, oncall_quota: 1 },
          { member_id: senior2.id, duty_quota: 1, oncall_quota: 1 },
          { member_id: junior.id, duty_quota: 2, oncall_quota: 2 },
          { member_id: junior2.id, duty_quota: 0, oncall_quota: 0 },
        ],
      }),
    });

    render(<ScheduleRunPanel />);

    await waitFor(() => expect(screen.getByText("実行履歴")).toBeInTheDocument());

    const comboboxes = screen.getAllByRole("combobox");
    await user.selectOptions(comboboxes[0], "2026");
    await user.selectOptions(comboboxes[1], "9");

    await user.click(screen.getByText(/日単位で細かく指定する/));
    const dateInputs = document.querySelectorAll('input[type="date"]');
    await user.clear(dateInputs[1]);
    await user.type(dateInputs[1], "2026-09-02");

    await waitFor(() => expect(screen.getByText(/9\/1.*〜.*9\/2.*2日間/)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /スタート/ }));

    await waitFor(() => expect(screen.getByText(/成功/)).toBeInTheDocument(), { timeout: 10000 });

    // 結果カレンダーに担当者名(手動テスト下級医)が表示される(プルダウンの選択中の値として)
    await waitFor(() => expect(screen.getAllByDisplayValue("手動テスト下級医").length).toBeGreaterThan(0));

    // 結果カレンダーのプルダウンで、直接別の下級医候補に入れ替えられる
    const dutySelect = screen.getAllByDisplayValue("手動テスト下級医")[0];
    await user.click(dutySelect);
    await waitFor(() => expect(within(dutySelect).getByText("手動テスト下級医2")).toBeInTheDocument());
    await user.selectOptions(dutySelect, String(junior2.id));

    await waitFor(() => expect(dutySelect.value).toBe(String(junior2.id)));
    // 実行履歴に手動調整済みの印がつく
    await waitFor(() => expect(screen.getByText(/手動調整あり/)).toBeInTheDocument());

    // 出力ボタンは担当回数一覧より後(画面の一番下)に配置されている
    const tallyHeading = screen.getByText("担当回数一覧");
    const exportHeading = screen.getByText("出力");
    const position = tallyHeading.compareDocumentPosition(exportHeading);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // PDF出力は廃止し、Excel出力のみ残っている
    expect(screen.getByText("Excelで出力")).toBeInTheDocument();
    expect(screen.queryByText("PDFで出力")).not.toBeInTheDocument();
  });

  it("管理者ページ: メンバー管理・希望回数設定・自動割当と結果が1ページにまとまっている", async () => {
    render(<AdminPage />);
    await waitFor(() => expect(screen.getAllByText("メンバー管理").length).toBeGreaterThan(0));
    expect(screen.getAllByText("希望回数設定").length).toBeGreaterThan(0);
    expect(screen.getAllByText("自動割当・結果").length).toBeGreaterThan(0);
  });

  it("管理者ログインゲート: 誤ったパスワードは拒否され、正しいパスワードでログインできる", async () => {
    const user = userEvent.setup();
    clearAdminPassword();

    render(
      <AdminLoginGate>
        <div>管理者コンテンツ</div>
      </AdminLoginGate>
    );

    await waitFor(() => expect(screen.getByPlaceholderText("パスワードを入力")).toBeInTheDocument());
    expect(screen.queryByText("管理者コンテンツ")).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("パスワードを入力"), "wrong-password");
    await user.click(screen.getByRole("button", { name: /管理者としてログイン/ }));
    await waitFor(() => expect(screen.getByText("パスワードが正しくありません")).toBeInTheDocument());
    expect(screen.queryByText("管理者コンテンツ")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("パスワードを入力"));
    await user.type(screen.getByPlaceholderText("パスワードを入力"), ADMIN_PASSWORD);
    await user.click(screen.getByRole("button", { name: /管理者としてログイン/ }));
    await waitFor(() => expect(screen.getByText("管理者コンテンツ")).toBeInTheDocument());

    // ログアウトすると再びパスワード入力画面に戻る
    await user.click(screen.getByRole("button", { name: /管理者ログアウト/ }));
    await waitFor(() => expect(screen.getByPlaceholderText("パスワードを入力")).toBeInTheDocument());
  });

  it("医局員ログインゲート: 初回は暗証番号を新規設定し、以後は同じ番号でログインでき、誤った番号は拒否される", async () => {
    const user = userEvent.setup();
    clearMemberSession();

    // テスト専用メンバーを追加(管理者操作のためヘッダーが必要)
    const createRes = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD },
      body: JSON.stringify({ name: "ログインテスト花子", rank: "B" }),
    });
    const newMember = await createRes.json();

    render(<MemberLoginGate>{(m) => <div>ログイン後: {m.name}</div>}</MemberLoginGate>);

    await waitFor(() => expect(screen.getByText(/ログインテスト花子/)).toBeInTheDocument());
    const select = screen.getAllByRole("combobox")[0];
    await user.selectOptions(select, String(newMember.id));

    // 初回: 4桁を入力すると自動的に新規設定される
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "3" }));
    await user.click(screen.getByRole("button", { name: "4" }));

    await waitFor(() => expect(screen.getByText(/ログイン後: ログインテスト花子/)).toBeInTheDocument());

    // ログアウトして、同じ暗証番号で再ログインできることを確認
    await user.click(screen.getByRole("button", { name: /ログアウト/ }));
    await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toBeInTheDocument());
    await user.selectOptions(screen.getAllByRole("combobox")[0], String(newMember.id));
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "3" }));
    await user.click(screen.getByRole("button", { name: "4" }));
    await waitFor(() => expect(screen.getByText(/ログイン後: ログインテスト花子/)).toBeInTheDocument());

    // ログアウトして、間違った暗証番号だと拒否されることを確認
    await user.click(screen.getByRole("button", { name: /ログアウト/ }));
    await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toBeInTheDocument());
    await user.selectOptions(screen.getAllByRole("combobox")[0], String(newMember.id));
    await user.click(screen.getByRole("button", { name: "9" }));
    await user.click(screen.getByRole("button", { name: "9" }));
    await user.click(screen.getByRole("button", { name: "9" }));
    await user.click(screen.getByRole("button", { name: "9" }));
    await waitFor(() => expect(screen.getByText("暗証番号が正しくありません")).toBeInTheDocument());
    expect(screen.queryByText(/ログイン後:/)).not.toBeInTheDocument();
  });

  it("メンバー管理画面: PINリセットボタンで暗証番号未設定に戻せる", async () => {
    const user = userEvent.setup();
    render(<MemberManagement />);

    // NGペア設定の選択肢にも同名テキストが現れるため、一覧側(先頭)の要素で判定する
    await waitFor(() => expect(screen.getAllByText(/ログインテスト花子/)[0]).toBeInTheDocument());
    expect(screen.getByText("PIN設定済")).toBeInTheDocument();

    const row = screen.getAllByText("ログインテスト花子")[0].closest("div").parentElement;
    const resetBtn = within(row).getByTitle("暗証番号をリセット");

    const originalConfirm = window.confirm;
    window.confirm = () => true;
    await user.click(resetBtn);
    window.confirm = originalConfirm;

    await waitFor(() => expect(within(row).getByText("PIN未設定")).toBeInTheDocument());
  });

  it("希望入力カレンダー画面: 締切バナーが表示され、月の対象期間から計算した募集期間が出る", async () => {
    const res = await fetch(`${API_BASE}/members`);
    const members = await res.json();
    const testMember = members[0];

    render(<DutyCalendar member={testMember} />);

    await waitFor(() => expect(screen.getByText(/分の締切/)).toBeInTheDocument());
    // 表示中の月を対象月として募集期間(前月の第1月曜〜金曜12:00)を計算し、状態ラベルが出る
    expect(
      screen.getByText(/受付開始前|締切まであと\d+日|本日.*まで|締切済み/)
    ).toBeInTheDocument();
  });

  it("希望入力カレンダー画面: 「この月をすべて不可にする」でまとめて不可にでき、「全部可に戻す」で元に戻せる", async () => {
    const user = userEvent.setup();

    const createRes = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD },
      body: JSON.stringify({ name: "一括不可テスト三郎", rank: "A" }),
    });
    const bulkMember = await createRes.json();

    render(<DutyCalendar member={bulkMember} />);
    await waitFor(() => expect(screen.getByText("当直・オンコール希望入力")).toBeInTheDocument());

    const originalConfirm = window.confirm;
    window.confirm = () => true;

    await user.click(screen.getByRole("button", { name: "この月をすべて不可にする" }));

    await waitFor(async () => {
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth() + 1;
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const end = `${y}-${String(m).padStart(2, "0")}-28`;
      const r = await fetch(`${API_BASE}/availability?member_id=${bulkMember.id}&start=${start}&end=${end}`);
      const rows = await r.json();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.duty_ng && row.oncall_ng)).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: "全部可に戻す" }));

    await waitFor(async () => {
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth() + 1;
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const end = `${y}-${String(m).padStart(2, "0")}-28`;
      const r = await fetch(`${API_BASE}/availability?member_id=${bulkMember.id}&start=${start}&end=${end}`);
      const rows = await r.json();
      expect(rows.length).toBe(0);
    });

    window.confirm = originalConfirm;
  });

  it("管理者ページ: 個人の希望表を閲覧でき、確認の上で代理編集もできる", async () => {
    const user = userEvent.setup();

    const createRes = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD },
      body: JSON.stringify({ name: "代理編集テスト四郎", rank: "B" }),
    });
    const proxyMember = await createRes.json();

    render(<MemberAvailabilityViewer />);
    await waitFor(() => expect(screen.getByText(/代理編集テスト四郎/)).toBeInTheDocument());

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, String(proxyMember.id));

    // 編集ボタンを押す前は、日付をタップしてもモーダルは開かない(閲覧専用)
    const dayButtons = screen.getAllByRole("button").filter((b) => /^\d+$/.test(b.textContent || ""));
    expect(dayButtons.length).toBeGreaterThan(0);
    await user.click(dayButtons[0]);
    expect(screen.queryByText("不可にする枠を選んでください")).not.toBeInTheDocument();

    const originalConfirm = window.confirm;
    window.confirm = () => true;

    await user.click(screen.getByRole("button", { name: /編集する/ }));
    await waitFor(() => expect(screen.getByText(/編集モードです/)).toBeInTheDocument());

    const dayButtonsAfter = screen.getAllByRole("button").filter((b) => /^\d+$/.test(b.textContent || ""));
    await user.click(dayButtonsAfter[0]);
    await waitFor(() => expect(screen.getByText("不可にする枠を選んでください")).toBeInTheDocument());

    await user.click(screen.getAllByText("当直")[0]);
    await user.click(screen.getByRole("button", { name: /^▶\s*保存$/ }));
    await waitFor(() => expect(screen.queryByText("不可にする枠を選んでください")).not.toBeInTheDocument());

    window.confirm = originalConfirm;

    await waitFor(async () => {
      const r = await fetch(`${API_BASE}/availability?member_id=${proxyMember.id}`);
      const rows = await r.json();
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  it("メンバー管理画面: ▲で並び替えるとバックエンドの表示順に反映される", async () => {
    const user = userEvent.setup();
    const adminHeaders = { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD };
    const r1 = await fetch(`${API_BASE}/members`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "並び替えA", rank: "A" }) });
    const mA = await r1.json();
    const r2 = await fetch(`${API_BASE}/members`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "並び替えB", rank: "A" }) });
    const mB = await r2.json();

    render(<MemberManagement />);
    // NGペア設定の選択肢にも同名テキストが現れるため、一覧側(先頭)の要素で判定する
    await waitFor(() => expect(screen.getAllByText("並び替えB")[0]).toBeInTheDocument());

    const rowB = screen.getAllByText("並び替えB")[0].closest("div").parentElement;
    const upBtn = within(rowB).getByTitle("上に移動");
    await user.click(upBtn);

    await waitFor(async () => {
      const res = await fetch(`${API_BASE}/members`);
      const members = await res.json();
      const idxA = members.findIndex((m) => m.id === mA.id);
      const idxB = members.findIndex((m) => m.id === mB.id);
      expect(idxB).toBeLessThan(idxA);
    });
  });

  it("メンバー管理画面: 在籍ボタンで休止中に切り替わり、バックエンドのis_activeに反映される", async () => {
    const user = userEvent.setup();
    const r = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD },
      body: JSON.stringify({ name: "休止テスト五郎", rank: "B" }),
    });
    const m = await r.json();

    render(<MemberManagement />);
    // NGペア設定の選択肢にも同名テキストが現れるため、一覧側(先頭)の要素で判定する
    await waitFor(() => expect(screen.getAllByText("休止テスト五郎")[0]).toBeInTheDocument());

    const row = screen.getAllByText("休止テスト五郎")[0].closest("div").parentElement;
    const toggleBtn = within(row).getByText("在籍中");
    await user.click(toggleBtn);

    await waitFor(() => expect(within(row).getByText("休止中")).toBeInTheDocument());
    await waitFor(async () => {
      const res = await fetch(`${API_BASE}/members`);
      const members = await res.json();
      const updated = members.find((x) => x.id === m.id);
      expect(updated.is_active).toBe(false);
    });
  });

  it("メンバー管理画面: NGペアを登録・削除でき、バックエンドに反映される", async () => {
    const user = userEvent.setup();
    const adminHeaders = { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD };
    const r1 = await fetch(`${API_BASE}/members`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "NGテスト一郎", rank: "A" }) });
    const mA = await r1.json();
    const r2 = await fetch(`${API_BASE}/members`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "NGテスト二郎", rank: "B" }) });
    const mB = await r2.json();

    render(<MemberManagement />);
    // メンバー一覧の取得(非同期)が完了し、NGペアのselect肢にも選択肢が反映されるまで待つ
    await waitFor(() => expect(screen.getAllByText("NGテスト一郎")[0]).toBeInTheDocument());

    // NGペアの選択肢は「選択」を含め members.length+1 個。値がmember.idの2つのselectを見つける
    const selects = screen.getAllByRole("combobox").filter((s) => s.textContent.includes("NGテスト一郎"));
    const [selA, selB] = selects;
    await user.selectOptions(selA, String(mA.id));
    await user.selectOptions(selB, String(mB.id));

    await user.click(screen.getByRole("button", { name: "NGペアを登録" }));

    const pairRow = await screen.findByLabelText(/NGペア: NGテスト一郎 と NGテスト二郎/);
    expect(pairRow).toBeInTheDocument();

    const res = await fetch(`${API_BASE}/ng-pairs`);
    const pairs = await res.json();
    const created = pairs.find(
      (p) => (p.member_a_id === mA.id && p.member_b_id === mB.id) || (p.member_a_id === mB.id && p.member_b_id === mA.id)
    );
    expect(created).toBeTruthy();

    // 削除
    const deleteBtn = screen.getByRole("button", { name: /NGテスト一郎とNGテスト二郎のNGペアを削除/ });
    await user.click(deleteBtn);

    await waitFor(async () => {
      const res2 = await fetch(`${API_BASE}/ng-pairs`);
      const pairs2 = await res2.json();
      expect(pairs2.some((p) => p.id === created.id)).toBe(false);
    });
  });

  it("希望回数設定画面: ステッパー操作ですぐ上の合計表示が更新される", async () => {
    const user = userEvent.setup();
    const r = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD },
      body: JSON.stringify({ name: "合計表示テスト六郎", rank: "A" }),
    });
    await r.json();

    render(<QuotaSetting />);
    await waitFor(() => expect(screen.getByText("合計表示テスト六郎")).toBeInTheDocument());

    const comboboxes = screen.getAllByRole("combobox");
    await user.selectOptions(comboboxes[0], "2026");
    await user.selectOptions(comboboxes[1], "12");
    await waitFor(() => expect(screen.getByText(/12\/1.*〜.*12\/31.*31日間/)).toBeInTheDocument());

    const memberRow = screen.getByText("合計表示テスト六郎").closest("div").parentElement;
    const steppers = within(memberRow).getAllByRole("spinbutton");
    await user.clear(steppers[0]);
    await user.type(steppers[0], "4");

    // 「当直 合計」は上級医+下級医を合算した値(このテストでは上級医だけ4に設定、下級医は0のまま)。
    // 上部の常時表示ミニ合計と下部の合計チェック欄の2箇所にラベルが出るため、先頭(ミニ合計)を見る
    const dutyTotalLabel = screen.getAllByText("当直 合計")[0];
    const totalsCell = dutyTotalLabel.parentElement;
    await waitFor(() => expect(within(totalsCell).getByText("4")).toBeInTheDocument());
  });

  it("希望入力カレンダー画面: コメントを保存でき、「提出する」で提出済みになる。旧フッターのカウント表示は無い", async () => {
    const user = userEvent.setup();
    const createRes = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD },
      body: JSON.stringify({ name: "コメント提出テスト七郎", rank: "B" }),
    });
    const cm = await createRes.json();

    render(<DutyCalendar member={cm} />);
    await waitFor(() => expect(screen.getByText("当直・オンコール希望入力")).toBeInTheDocument());

    // 旧フッターの「不可あり」カウント表示は無くなっている
    expect(screen.queryByText("不可あり")).not.toBeInTheDocument();
    // まだ未提出
    expect(screen.getByText("この月はまだ提出されていません")).toBeInTheDocument();

    const dayButtons = screen.getAllByRole("button").filter((b) => /^\d+$/.test(b.textContent || ""));
    await user.click(dayButtons[0]);
    await waitFor(() => expect(screen.getByText("不可にする枠を選んでください")).toBeInTheDocument());

    const commentBox = screen.getByPlaceholderText(/学会のため午後不在/);
    await user.type(commentBox, "テストコメント");
    await user.click(screen.getByRole("button", { name: /^▶\s*保存$/ }));
    await waitFor(() => expect(screen.queryByText("不可にする枠を選んでください")).not.toBeInTheDocument());

    await waitFor(async () => {
      const r = await fetch(`${API_BASE}/availability?member_id=${cm.id}`);
      const rows = await r.json();
      expect(rows.some((row) => row.note === "テストコメント")).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: "この内容で提出する" }));
    await waitFor(() => expect(screen.getByText(/提出済み/)).toBeInTheDocument());

    await waitFor(async () => {
      const now = new Date();
      const y = now.getFullYear(), m0 = now.getMonth();
      const start = `${y}-${String(m0 + 1).padStart(2, "0")}-01`;
      const days = new Date(y, m0 + 1, 0).getDate();
      const r = await fetch(`${API_BASE}/availability/submissions?period_start=${start}&period_days=${days}`);
      const subs = await r.json();
      expect(subs.some((s) => s.member_id === cm.id)).toBe(true);
    });
  });

  it("管理者ページ: 個人の希望表を閲覧のみの状態でも当直/オンコールの可否を確認できる", async () => {
    const user = userEvent.setup();
    const createRes = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD },
      body: JSON.stringify({ name: "閲覧確認テスト八郎", rank: "A" }),
    });
    const vm = await createRes.json();

    render(<MemberAvailabilityViewer />);
    await waitFor(() => expect(screen.getByText(/閲覧確認テスト八郎/)).toBeInTheDocument());
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, String(vm.id));

    const dayButtons = screen.getAllByRole("button").filter((b) => /^\d+$/.test(b.textContent || ""));
    await user.click(dayButtons[0]);

    await waitFor(() => expect(screen.getByText("内容を確認できます（閲覧のみ）")).toBeInTheDocument());
    expect(screen.getAllByText("当直").length).toBeGreaterThan(0);
    expect(screen.getAllByText("○ 可").length).toBeGreaterThan(0);
    // 閲覧のみなので、トグル可能なボタンとしては表示されない(静的表示)
    expect(screen.queryByRole("button", { name: /当直/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(screen.queryByText("内容を確認できます（閲覧のみ）")).not.toBeInTheDocument());
  });

  it("管理者ページ: 未提出リストに提出していないメンバーの名前が表示される", async () => {
    const createRes = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD },
      body: JSON.stringify({ name: "未提出確認テスト九郎", rank: "B" }),
    });
    await createRes.json();

    render(<MissingSubmissions />);
    await waitFor(() => expect(screen.getByText(/未提出リスト/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("未提出確認テスト九郎")).toBeInTheDocument());
  });

  it("日時表示: サーバーのUTC時刻が日本時間(+9時間)で表示される", () => {
    expect(formatJst("2026-10-04T13:10:30Z")).toBe("10/4(日) 22:10");
    expect(formatJst("2026-10-04T16:00:00Z")).toBe("10/5(月) 01:00");
  });

  it("提出状況・履歴: 未提出→提出後に提出日時と提出時の内容が見られる", async () => {
    const user = userEvent.setup();
    const adminHeaders = { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD };
    const createRes = await fetch(`${API_BASE}/members`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "履歴確認テスト十郎", rank: "A" }) });
    const hm = await createRes.json();

    const now = new Date();
    let ty = now.getFullYear(), tm0 = now.getMonth() + 1;
    if (tm0 > 11) { tm0 = 0; ty += 1; }
    const start = `${ty}-${String(tm0 + 1).padStart(2, "0")}-01`;
    const nDays = new Date(ty, tm0 + 1, 0).getDate();
    const day5 = `${ty}-${String(tm0 + 1).padStart(2, "0")}-05`;

    render(<SubmissionLog />);
    await waitFor(() => expect(screen.getByText("履歴確認テスト十郎")).toBeInTheDocument());
    expect(within(screen.getByText("履歴確認テスト十郎").closest("button")).getByText("未提出")).toBeInTheDocument();
    cleanup();

    // 中身が空のまま提出 → 管理者が代理で不可を入力
    await fetch(`${API_BASE}/availability/${hm.id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period_start: start, period_days: nDays }) });
    await fetch(`${API_BASE}/availability/${hm.id}`, {
      method: "PUT", headers: adminHeaders,
      body: JSON.stringify({ start: day5, end: day5, entries: [{ date: day5, half: "ALL", duty_ng: true, oncall_ng: false }] }),
    });

    render(<SubmissionLog />);
    const nameEl = await screen.findByText("履歴確認テスト十郎");
    const rowBtn = nameEl.closest("button");
    await waitFor(() => expect(within(rowBtn).getByText(/最終提出/)).toBeInTheDocument());
    expect(within(rowBtn).queryByText("提出時の中身が空")).not.toBeInTheDocument();

    // 名前を押すと、提出日時とその時の内容が出る(提出後の代理編集は含まれない)
    await user.click(rowBtn);
    await waitFor(() => expect(screen.getByText("提出時点で不可・コメントの入力なし(中身が空)")).toBeInTheDocument());
    expect(screen.queryByText(/管理者による代理編集/)).not.toBeInTheDocument();
  });

  it("管理者ページ: 代理編集すると個人の希望表の下に最終の代理変更(変更前の内容つき)が出る", async () => {
    const user = userEvent.setup();
    const createRes = await fetch(`${API_BASE}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PASSWORD },
      body: JSON.stringify({ name: "代理編集履歴テスト十一郎", rank: "B" }),
    });
    const vm = await createRes.json();

    render(<MemberAvailabilityViewer />);
    await waitFor(() => expect(screen.getByText(/代理編集履歴テスト十一郎/)).toBeInTheDocument());
    await user.selectOptions(screen.getByRole("combobox"), String(vm.id));
    window.confirm = () => true;
    await user.click(screen.getByRole("button", { name: /編集する/ }));

    const dayButtons = screen.getAllByRole("button").filter((b) => /^\d+$/.test(b.textContent || ""));
    await user.click(dayButtons[0]);
    await user.click(await screen.findByRole("button", { name: /当直/ }));
    await user.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => expect(screen.getByText(/管理者による代理編集/)).toBeInTheDocument());
    expect(screen.getByText(/変更前:/)).toBeInTheDocument();
    expect(screen.getByText(/1日 当直✕/)).toBeInTheDocument();
  });
});
