/** 安卓更新卡须区分唤起安装器与安装完成，错误只展示本地化文案。 */
import { expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import i18n from "@yuanchat/design-system/i18n";
import { OTA_SHA256_MISMATCH, type AndroidUpdate } from "@yuanchat/shared";
import { AndroidUpdateCard } from "../settings/AndroidUpdateCard";

const update: AndroidUpdate = {
  version: "0.9.0",
  notes: "",
  url: "https://example.test/app.apk",
  sha256: "a".repeat(64),
  size: 10,
  mandatory: false,
};

function CurrentSearch() {
  return <output data-testid="current-search">{useLocation().search}</output>;
}

it("消费命令面板的检查深链一次，StrictMode 和后续重渲染不重复请求", async () => {
  const check = vi.fn().mockResolvedValue(null);
  const install = async () => {};
  const renderCard = (version: string) => (
    <StrictMode>
      <MemoryRouter initialEntries={["/settings?section=about&checkUpdate=1"]}>
        <AndroidUpdateCard currentVersion={version} check={check} install={install} />
        <CurrentSearch />
      </MemoryRouter>
    </StrictMode>
  );
  const view = render(renderCard("0.8.0"));
  await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  await screen.findByText(i18n.t("ota.android.upToDate"));
  expect(check).toHaveBeenCalledWith("0.8.0");
  expect(screen.getByTestId("current-search")).toHaveTextContent("?section=about");
  expect(screen.getByTestId("current-search")).not.toHaveTextContent("checkUpdate");
  view.rerender(renderCard("0.8.1"));
  expect(check).toHaveBeenCalledTimes(1);
});

it("唤起系统安装器后允许重新安装，取消安装不会永久锁住卡片", async () => {
  const install = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <AndroidUpdateCard currentVersion="0.8.0" check={async () => update} install={install} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("update.check") }));
  fireEvent.click(await screen.findByRole("button", { name: i18n.t("ota.android.updateNow") }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: i18n.t("ota.android.updateNow") }),
    ).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("ota.android.updateNow") }));
  await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
});

it("网络异常不把底层路径或英文报错当界面文案展示", async () => {
  render(
    <MemoryRouter>
      <AndroidUpdateCard
        currentVersion="0.8.0"
        check={async () => {
          throw new Error("private-path: ECONNREFUSED");
        }}
        install={async () => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("update.check") }));
  await screen.findByText(i18n.t("update.failed"));
  expect(screen.queryByText(/private-path/)).toBeNull();
});

it("SHA256 不匹配展示安全错误，不能进入安装器已打开状态", async () => {
  render(
    <MemoryRouter>
      <AndroidUpdateCard
        currentVersion="0.8.0"
        check={async () => update}
        install={async () => {
          throw new Error(OTA_SHA256_MISMATCH);
        }}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("update.check") }));
  fireEvent.click(await screen.findByRole("button", { name: i18n.t("ota.android.updateNow") }));
  await screen.findByText(i18n.t("ota.android.verifyFailed"));
  expect(screen.queryByText(i18n.t("ota.android.installing"))).toBeNull();
});
