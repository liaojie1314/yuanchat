/**
 * FileProgressBar 的渲染契约测试。
 *
 * 钉三件事：无条目时零渲染（CLS）、确定性进度给 aria-valuenow、
 * 不确定态不给；failed 态把可本地化错误 key 翻译出来。
 * 进度的累计与节流在 shared 的 downloadStore 测试里，这里不重复。
 */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useDownloadStore, useToastStore } from "@yuanchat/shared";
import { FileProgressBar } from "../chat/FileProgressBar";

/** 造一条进度条目（缺省字段按 downloading 初始态补齐） */
function seed(
  id: string,
  e: Partial<{ phase: string; received: number; total: number; errorKey: string }>,
) {
  const entry = { phase: "downloading", received: 0, total: 0, errorKey: undefined, ...e };
  useDownloadStore.setState({ entries: { [id]: entry as never } });
}

describe("FileProgressBar", () => {
  it("无进度条目时不渲染任何东西（零 CLS：气泡高度不因它跳动）", () => {
    useDownloadStore.setState({ entries: {} });
    const { container } = render(<FileProgressBar messageId="none" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("done 与 canceled 也不渲染（完成后进度条让位，不再占一行）", () => {
    seed("m0a", { phase: "done", received: 10, total: 10 });
    seed("m0b", { phase: "canceled", received: 4, total: 10 });
    const a = render(<FileProgressBar messageId="m0a" />);
    expect(a.container).toBeEmptyDOMElement();
    const b = render(<FileProgressBar messageId="m0b" />);
    expect(b.container).toBeEmptyDOMElement();
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
