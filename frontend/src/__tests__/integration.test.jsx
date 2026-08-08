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

    await waitFor(() => expect(screen.getByText("テスト太郎")).toBeInTheDocument());

    const res = await fetch(`${API_BASE}/members`);
    const members = await res.json();
    expect(members.some((m) => m.name === "テスト太郎" && m.rank === "A")).toBe(true);
  });

  it("メンバー管理画面: A/Bをタップで切り替えるとバックエンドに反映される", async () => {
    const user = userEvent.setup();
    render(<MemberManagement />);
    await waitFor(() => expect(screen.getByText("テスト太郎")).toBeInTheDocument());

    const row = screen.getByText("テスト太郎").closest("div");
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

    // 対象期間: 2026-09-01 〜 3日間。全員1回ずつ希望。
    await fetch(`${API_BASE}/quotas`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        period_start: "2026-09-01",
        period_days: 3,
        items: [
          { member_id: senior.id, duty_quota: 1, oncall_quota: 1 },
          { member_id: senior2.id, duty_quota: 1, oncall_quota: 1 },
          { member_id: junior.id, duty_quota: 2, oncall_quota: 2 },
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
    await user.type(dateInputs[1], "2026-09-03");

    await waitFor(() => expect(screen.getByText(/9\/1.*〜.*9\/3.*3日間/)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /スタート/ }));

    await waitFor(() => expect(screen.getByText(/成功/)).toBeInTheDocument(), { timeout: 10000 });

    // 結果カレンダーに担当者名(手動テスト下級医)が表示される
    await waitFor(() => expect(screen.getAllByText(/手動テスト下級医/).length).toBeGreaterThan(0));

    // 当直の担当者名をタップして手動調整モーダルを開く
    const nameButtons = screen.getAllByText(/手動テスト/);
    await user.click(nameButtons[0]);

    await waitFor(() => expect(screen.getByText(/緑=希望回数より少ない人/)).toBeInTheDocument());

    // 候補者一覧が表示され、担当回数/希望回数が見える(オーバー/アンダーの文字ラベルは出さない仕様)
    await waitFor(() => expect(screen.getAllByText(/(当直|オンコール)\d+\/\d+/).length).toBeGreaterThan(0));
    expect(screen.queryByText("オーバー")).not.toBeInTheDocument();
    expect(screen.queryByText("アンダー")).not.toBeInTheDocument();

    // 出力ボタンは担当回数一覧より後(画面の一番下)に配置されている
    const tallyHeading = screen.getByText("担当回数一覧");
    const exportHeading = screen.getByText("出力");
    const position = tallyHeading.compareDocumentPosition(exportHeading);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    await waitFor(() => expect(screen.getByText(/ログインテスト花子/)).toBeInTheDocument());
    expect(screen.getByText("PIN設定済")).toBeInTheDocument();

    const row = screen.getByText("ログインテスト花子").closest("div").parentElement;
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
});
