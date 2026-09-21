/**
 * MomentComposeView 测试
 *
 * 覆盖：字数计数与提交闸门、图片/视频二选一互斥、上传成功后带媒体发布并回信息流。
 *
 * jsdom 默认 locale 钉在 en-US（见 setup.ts），故文案断言用英文。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { MomentComposeView } from "../moments/MomentComposeView";
import * as shared from "@yuanchat/shared";
import { useMomentsStore } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    compressImage: vi.fn(),
    extractVideoMeta: vi.fn(),
    getUploadUrl: vi.fn(),
    uploadToTicket: vi.fn(),
    createPost: vi.fn(),
    showToast: vi.fn(),
  };
});

function pickImage(name = "a.png") {
  const input = screen.getByTestId("moment-image-input") as HTMLInputElement;
  const file = new File(["x"], name, { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
}

function renderCompose() {
  return render(
    <MemoryRouter initialEntries={["/moments/compose"]}>
      <Routes>
        <Route path="/moments" element={<div>feed-probe</div>} />
        <Route path="/moments/compose" element={<MomentComposeView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MomentComposeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom 不实现 createObjectURL：本地预览用得到，打桩成固定串
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    useMomentsStore.setState({ loadFeed: vi.fn(async () => {}) });
    vi.mocked(shared.compressImage).mockResolvedValue({
      blob: new Blob(["x"]),
      width: 100,
      height: 80,
    });
    vi.mocked(shared.getUploadUrl).mockResolvedValue({
      uploadUrl: "https://obj/put",
      objectKey: "images/a.png",
    });
    vi.mocked(shared.uploadToTicket).mockResolvedValue(undefined);
  });

  it("空内容时不能发布，输入后显示字数", () => {
    renderCompose();
    const publish = screen.getByRole("button", { name: "Post" });
    expect(publish).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "今天很开心" } });
    expect(screen.getByText("5/1000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post" })).toBeEnabled();
  });

  it("选了图片后视频入口禁用（二选一）", async () => {
    renderCompose();
    pickImage();
    await waitFor(() => expect(shared.uploadToTicket).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Add video" })).toBeDisabled();
  });

  it("带图片发布：上传成功后提交 media 并回信息流", async () => {
    vi.mocked(shared.createPost).mockResolvedValue({} as shared.MomentPost);
    renderCompose();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "看图" } });
    pickImage();
    await waitFor(() => expect(shared.uploadToTicket).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() =>
      expect(shared.createPost).toHaveBeenCalledWith({
        content: "看图",
        media: [{ key: "images/a.png", w: 100, h: 80 }],
        mediaKind: 1,
        visibility: 0,
      }),
    );
    expect(await screen.findByText("feed-probe")).toBeInTheDocument();
  });

  it("单张上传失败可单独重试，不作废整次发布", async () => {
    vi.mocked(shared.uploadToTicket).mockRejectedValueOnce(new Error("net"));
    renderCompose();
    pickImage();

    const retry = await screen.findByRole("button", { name: "Retry" });
    vi.mocked(shared.uploadToTicket).mockResolvedValue(undefined);
    fireEvent.click(retry);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
  });

  it("上传未完成时不能发布", async () => {
    let release: () => void = () => {};
    vi.mocked(shared.uploadToTicket).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renderCompose();
    pickImage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Post" })).toBeDisabled());
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Post" })).toBeEnabled());
  });

  it("可见性切到仅自己后按 1 提交", async () => {
    vi.mocked(shared.createPost).mockResolvedValue({} as shared.MomentPost);
    renderCompose();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "私密" } });
    fireEvent.click(screen.getByRole("button", { name: "Only me" }));
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() =>
      expect(shared.createPost).toHaveBeenCalledWith({
        content: "私密",
        media: [],
        mediaKind: 0,
        visibility: 1,
      }),
    );
  });
});
