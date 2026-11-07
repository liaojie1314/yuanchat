/** 桌面检查更新使用稳定匿名灰度桶，插件异常不直接暴露给用户。 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@yuanchat/design-system/i18n";
const check = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
import { UpdateChecker } from "../components/UpdateChecker";

beforeEach(() => {
  check.mockReset();
  localStorage.setItem("yuanchat-device-uid", "hello");
});
afterEach(() => cleanup());

it("多次检查均传递相同 FNV 灰度桶，不传唯一设备 ID", async () => {
  check.mockResolvedValue(null);
  render(
    <MemoryRouter>
      <UpdateChecker />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("update.check") }));
  await waitFor(() =>
    expect(check).toHaveBeenCalledWith({
      headers: { "X-YuanChat-Update-Cohort": "23" },
      timeout: 10_000,
    }),
  );
  await screen.findByText(i18n.t("update.upToDate"));
  fireEvent.click(screen.getByRole("button", { name: i18n.t("update.check") }));
  await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
  expect(check.mock.calls[1]).toEqual([
    { headers: { "X-YuanChat-Update-Cohort": "23" }, timeout: 10_000 },
  ]);
});

it("插件检查失败展示翻译，不展示原始异常", async () => {
  check.mockRejectedValue(new Error("private-path: TLS failure"));
  render(
    <MemoryRouter>
      <UpdateChecker />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("update.check") }));
  await screen.findByText(i18n.t("update.failed"));
  expect(screen.queryByText(/private-path/)).toBeNull();
});

it("关于页深链自动检查更新，而不是只有一个未工作的按钮", async () => {
  check.mockResolvedValue(null);
  render(
    <MemoryRouter initialEntries={["/settings?section=about&checkUpdate=1"]}>
      <UpdateChecker />
    </MemoryRouter>,
  );
  await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  await screen.findByText(i18n.t("update.upToDate"));
});
