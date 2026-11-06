/** 真实版本页交互：失败不能伪装成已修改灰度，也不能产生未处理拒绝。 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@yuanchat/design-system/i18n";
import { ApiError } from "@yuanchat/shared";
const api = vi.hoisted(() => ({
  listReleases: vi.fn(),
  updateRelease: vi.fn(),
  publishRelease: vi.fn(),
  rollbackRelease: vi.fn(),
  createRelease: vi.fn(),
}));
vi.mock("../api", async (original) => ({ ...(await original<object>()), ...api }));
import { ReleasesPage } from "../pages/Releases";

let root: Root;
let host: HTMLDivElement;
const release = {
  id: "r1",
  platform: "linux",
  arch: "x86_64",
  version: "0.9.0",
  channel: "stable",
  rollout: 100,
  mandatory: false,
  size: 10,
  notes: "",
  object_key: "releases/test.AppImage",
  status: "draft",
  created_at: "2026-11-03T00:00:00Z",
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  Object.values(api).forEach((fn) => fn.mockReset());
  api.listReleases.mockResolvedValue({ list: [release], total: 1 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function mount() {
  await act(async () => root.render(<ReleasesPage />));
  await act(async () => vi.runOnlyPendingTimersAsync());
}
function button(key: string) {
  const found = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === i18n.t(key),
  );
  if (!found) throw new Error(`missing button: ${key}`);
  return found;
}
async function editRollout(value: string) {
  const input = host.querySelector<HTMLInputElement>("tbody input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  return input;
}

it("灰度提交失败恢复服务端原值，并给出可见错误", async () => {
  api.updateRelease.mockRejectedValue(new Error("503 internal path"));
  await mount();
  const input = await editRollout("0");
  expect(input.value).toBe("100");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    i18n.t("admin.releases.actionFailed"),
  );
});

it.each(["", "0.5"])("灰度输入 %s 不会当成合法整数提交", async (value) => {
  api.updateRelease.mockResolvedValue({ updated: true });
  await mount();
  const input = await editRollout(value);
  expect(api.updateRelease).not.toHaveBeenCalled();
  expect(input.value).toBe("100");
});

it.each(["publish", "rollback"])("%s 失败保留版本状态并允许重新确认", async (action) => {
  if (action === "rollback")
    api.listReleases.mockResolvedValue({ list: [{ ...release, status: "published" }], total: 1 });
  const call = action === "publish" ? api.publishRelease : api.rollbackRelease;
  call.mockRejectedValueOnce(new Error("503 backend unavailable"));
  await mount();
  await act(async () => button(`admin.releases.${action}`).click());
  await act(async () => button("common.confirm").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    i18n.t("admin.releases.actionFailed"),
  );
  call.mockResolvedValue({ status: action === "publish" ? "published" : "rolled_back" });
  await act(async () => button(`admin.releases.${action}`).click());
  await act(async () => button("common.confirm").click());
  expect(call).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("重复登记使用翻译提示，不展示后端原始异常", async () => {
  api.createRelease.mockRejectedValue(new ApiError(409, "raw backend duplicate"));
  await mount();
  await act(async () => button("admin.releases.create").click());
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    i18n.t("admin.releases.duplicate"),
  );
  expect(host.querySelector("form")).not.toBeNull();
});
