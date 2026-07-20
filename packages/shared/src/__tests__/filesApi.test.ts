/**
 * api/files 单元测试
 *
 * 覆盖：
 * - getUploadUrl 请求体拼装（filename/content_type/size）+ category query 透传 + DTO 映射
 * - uploadToTicket PUT 直传（非 2xx 抛错）
 * - getDownloadUrl 内存缓存：同 key 二次调用命中缓存不再 fetch；提前过期后重取
 *
 * 注：compressImage 依赖 canvas/createImageBitmap，node 测试环境不可用，
 * 由批次 E2E 覆盖（见 task-3.4-report 自评）。
 * centerSquareCrop 为纯几何函数（无 canvas 依赖），此处直接单测。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getUploadUrl,
  uploadToTicket,
  getDownloadUrl,
  centerSquareCrop,
  __resetDownloadUrlCache,
} from "../api/files";

/** 桩：一次 apiGet/apiPost 信封响应 */
function mockApiOnce(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve({ code: 0, message: "ok", data }) }),
  );
}

describe("getUploadUrl", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("POSTs filename/content_type/size and maps snake_case ticket", async () => {
    mockApiOnce({
      upload_url: "https://minio.local/put?sig=1",
      object_key: "images/2026/07/abc.png",
      expires_in: 900,
    });
    const ticket = await getUploadUrl("img.jpg", "image/png", 1234);

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/files/upload-url");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({
      filename: "img.jpg",
      content_type: "image/png",
      size: 1234,
    });
    expect(ticket).toEqual({
      uploadUrl: "https://minio.local/put?sig=1",
      objectKey: "images/2026/07/abc.png",
      publicUrl: undefined,
    });
  });

  it("passes ?category= when provided and surfaces public_url", async () => {
    mockApiOnce({
      upload_url: "https://minio.local/put",
      object_key: "avatars/2026/07/x.png",
      public_url: "https://cdn.local/avatars/2026/07/x.png",
      expires_in: 900,
    });
    const ticket = await getUploadUrl("a.png", "image/png", 10, "avatars");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/files/upload-url?category=avatars");
    expect(ticket.publicUrl).toBe("https://cdn.local/avatars/2026/07/x.png");
  });
});

describe("uploadToTicket", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("PUTs the blob to the presigned url with content-type", async () => {
    const put = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", put);
    const blob = new Blob(["x"], { type: "image/png" });

    await uploadToTicket(
      { uploadUrl: "https://minio.local/put?sig=1", objectKey: "k" },
      blob,
      "image/png",
    );

    expect(put).toHaveBeenCalledWith(
      "https://minio.local/put?sig=1",
      expect.objectContaining({ method: "PUT", body: blob }),
    );
    const init = put.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("image/png");
  });

  it("throws on non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(
      uploadToTicket(
        { uploadUrl: "https://minio.local/put", objectKey: "k" },
        new Blob(["x"]),
        "image/png",
      ),
    ).rejects.toThrow();
  });
});

describe("getDownloadUrl (in-memory cache)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    __resetDownloadUrlCache();
  });
  afterEach(() => vi.useRealTimers());

  it("caches by key: second call within TTL does not re-fetch", async () => {
    const f = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          code: 0,
          message: "ok",
          data: { url: "https://get?sig", expires_in: 86400 },
        }),
    });
    vi.stubGlobal("fetch", f);

    const a = await getDownloadUrl("images/2026/07/abc.png");
    const b = await getDownloadUrl("images/2026/07/abc.png");
    expect(a).toBe("https://get?sig");
    expect(b).toBe("https://get?sig");
    expect(f).toHaveBeenCalledTimes(1);
    const call = f.mock.calls[0];
    expect(call[0]).toContain("/api/v1/files/download-url?key=images%2F2026%2F07%2Fabc.png");
  });

  it("re-fetches after the entry expires (5-min early expiry honored)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    const f = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ code: 0, message: "ok", data: { url: "https://u1", expires_in: 600 } }),
    });
    vi.stubGlobal("fetch", f);

    await getDownloadUrl("images/2026/07/exp.png"); // expires_in 600s, early-expire 300s → 有效 300s
    // 299s 后仍命中缓存
    vi.advanceTimersByTime(299_000);
    await getDownloadUrl("images/2026/07/exp.png");
    expect(f).toHaveBeenCalledTimes(1);
    // 越过提前过期点 → 重取
    vi.advanceTimersByTime(2_000);
    await getDownloadUrl("images/2026/07/exp.png");
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("centerSquareCrop (geometry)", () => {
  it("landscape: crops to a centered square of the shorter edge, X offset", () => {
    // 200×120 → 边长 120，水平居中裁 (200-120)/2 = 40
    expect(centerSquareCrop(200, 120, 512)).toEqual({
      sx: 40,
      sy: 0,
      side: 120,
      out: 120,
    });
  });

  it("portrait: crops to a centered square of the shorter edge, Y offset", () => {
    // 120×200 → 边长 120，垂直居中裁 (200-120)/2 = 40
    expect(centerSquareCrop(120, 200, 512)).toEqual({
      sx: 0,
      sy: 40,
      side: 120,
      out: 120,
    });
  });

  it("square smaller than target: keeps native size (no upscale)", () => {
    expect(centerSquareCrop(300, 300, 512)).toEqual({
      sx: 0,
      sy: 0,
      side: 300,
      out: 300,
    });
  });

  it("larger than target: downscales output to the target edge", () => {
    // 1000×800 → 边长 800，居中裁 X 100；输出降到 512
    expect(centerSquareCrop(1000, 800, 512)).toEqual({
      sx: 100,
      sy: 0,
      side: 800,
      out: 512,
    });
  });

  it("odd offsets floor to integer source pixels", () => {
    // 101×100 → 边长 100，(101-100)/2 = 0.5 → floor 0
    expect(centerSquareCrop(101, 100, 512)).toEqual({
      sx: 0,
      sy: 0,
      side: 100,
      out: 100,
    });
  });
});
