/**
 * FileProgressBar 的渲染契约测试。
 *
 * 无条目/完成/取消仍保留占位，有进度时提供正确的 ARIA，长错误可完整阅读。
 * JSDOM 不计算布局；消息高度与下方锚点位置由浏览器 E2E 实测。
 * 进度的累计与节流在 shared 的 downloadStore 测试里，这里不重复。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  setFileSink,
  __resetFileSink,
  useDownloadStore,
  useToastStore,
  type DownloadEntry,
} from "@yuanchat/shared";
import i18n from "@yuanchat/design-system/i18n";
import { FileProgressBar } from "../chat/FileProgressBar";

/** 造一条进度条目（缺省字段按 downloading 初始态补齐） */
function seed(id: string, e: Partial<DownloadEntry>) {
  const entry: DownloadEntry = { phase: "downloading", received: 0, total: 0, ...e };
  useDownloadStore.setState({ entries: { [id]: entry } });
}

describe("FileProgressBar", () => {
  beforeEach(() => setFileSink({ save: vi.fn() }));
  afterEach(() => __resetFileSink());

  it("Web 完成提示使用真实目录名和文件名，不显示不透明保存引用", () => {
    setFileSink({ save: vi.fn(), describe: () => "Downloads / a.pdf", revealTarget: "location" });
    useToastStore.setState({ toasts: [] });
    seed("web-location", { phase: "done", savedPath: "browser-download:1" });
    render(<FileProgressBar messageId="web-location" />);
    expect(useToastStore.getState().toasts.map((toast) => toast.text)).toEqual([
      "Saved to Downloads / a.pdf",
    ]);
  });
  it("无进度条目时保留空占位，不向辅助技术宣读进度", () => {
    useDownloadStore.setState({ entries: {} });
    render(<FileProgressBar messageId="none" />);
    expect(screen.getByTestId("file-progress-slot")).toBeEmptyDOMElement();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it.each(["done", "canceled"] as const)("%s 清掉进度内容但保留消息内占位", (phase) => {
    seed("m0", { phase, received: 10, total: 10 });
    render(<FileProgressBar messageId="m0" />);
    expect(screen.getByTestId("file-progress-slot")).toBeEmptyDOMElement();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("下载全生命周期共用同一个占位，只切换其内部内容", () => {
    useDownloadStore.setState({ entries: {} });
    render(<FileProgressBar messageId="lifecycle" />);
    const slot = screen.getByTestId("file-progress-slot");
    for (const phase of ["downloading", "saving", "done", "canceled", "failed"] as const) {
      act(() => seed("lifecycle", { phase, received: 1, total: 4 }));
      expect(screen.getByTestId("file-progress-slot")).toBe(slot);
      if (phase === "done" || phase === "canceled") {
        expect(within(slot).queryByRole("progressbar")).toBeNull();
      } else {
        expect(within(slot).getByRole("progressbar")).toBeInTheDocument();
      }
    }
    act(() => useDownloadStore.setState({ entries: {} }));
    expect(screen.getByTestId("file-progress-slot")).toBe(slot);
    expect(slot).toBeEmptyDOMElement();
  });

  it("长错误可点击完整阅读，弹窗脱离虚拟消息列且可以关闭", () => {
    const error = i18n.t("download.directoryPermissionRequired");
    seed("long-error", { phase: "failed", errorKey: "download.directoryPermissionRequired" });
    const { container } = render(<FileProgressBar messageId="long-error" />);
    fireEvent.click(screen.getByRole("button", { name: error }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(error)).toBeVisible();
    expect(container).not.toContainElement(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: i18n.t("common.close") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("file-progress-slot")).toBeInTheDocument();
  });

  it("有 total 时按百分比给出 aria-valuenow", () => {
    seed("m1", { phase: "downloading", received: 30, total: 120 });
    render(<FileProgressBar messageId="m1" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("total 为 0 时是不确定态，不给 aria-valuenow", () => {
    seed("m2", { phase: "downloading", received: 999, total: 0 });
    render(<FileProgressBar messageId="m2" />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });

  it("failed 态显示错误文案而不是静默卡住", () => {
    seed("m3", { phase: "failed", received: 10, total: 20, errorKey: "chat.file.downloadFailed" });
    render(<FileProgressBar messageId="m3" />);
    // 测试语言固定 en-US（见 setup.ts）："Download failed, please retry"
    expect(screen.getByText(/download failed/i)).toBeInTheDocument();
  });

  it("saving 态显示保存中文案", () => {
    seed("m4", { phase: "saving", received: 10, total: 10 });
    render(<FileProgressBar messageId="m4" />);
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
  });

  it("完成且拿得到落盘路径时弹一次「已保存到」toast（安卓用户触达文件的唯一线索）", () => {
    // toastStore 是全局单例且 3 秒后才自动消失，先清掉其他用例留下的提示
    useToastStore.setState({ toasts: [] });
    seed("m5", { phase: "downloading", received: 5, total: 10 });
    render(<FileProgressBar messageId="m5" />);
    expect(useToastStore.getState().toasts).toHaveLength(0);

    act(() => {
      useDownloadStore.setState({
        entries: {
          m5: { phase: "done", received: 10, total: 10, savedPath: "/data/a.pdf" } as never,
        },
      });
    });
    const texts = useToastStore.getState().toasts.map((x) => x.text);
    expect(texts).toEqual(["Saved to /data/a.pdf"]);

    // 重渲染不再重复弹（聊天层与相册层同时挂载同一条也只弹一次）
    act(() => {
      useDownloadStore.setState({
        entries: {
          m5: { phase: "done", received: 10, total: 10, savedPath: "/data/a.pdf" } as never,
        },
      });
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("web 实现拿不到路径（savedPath 缺省）时完成不弹 toast", () => {
    useToastStore.setState({ toasts: [] });
    seed("m6", { phase: "downloading", received: 5, total: 10 });
    render(<FileProgressBar messageId="m6" />);
    act(() => {
      useDownloadStore.setState({
        entries: { m6: { phase: "done", received: 10, total: 10 } as never },
      });
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
