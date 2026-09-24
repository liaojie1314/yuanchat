import { describe, it, expect } from "vitest";
import { hashBlob } from "../api/files";

describe("files API", () => {
  it("should hash a blob to SHA-256 hex", async () => {
    const blob = new Blob(["test content"], { type: "text/plain" });
    const hash = await hashBlob(blob);
    expect(hash).toBe("6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72");
    expect(hash).toHaveLength(64);
  });

  it("should return consistent hash for same content", async () => {
    const blob1 = new Blob(["hello"], { type: "text/plain" });
    const blob2 = new Blob(["hello"], { type: "text/plain" });
    const hash1 = await hashBlob(blob1);
    const hash2 = await hashBlob(blob2);
    expect(hash1).toBe(hash2);
  });

  it("should return different hash for different content", async () => {
    const blob1 = new Blob(["hello"], { type: "text/plain" });
    const blob2 = new Blob(["world"], { type: "text/plain" });
    const hash1 = await hashBlob(blob1);
    const hash2 = await hashBlob(blob2);
    expect(hash1).not.toBe(hash2);
  });
});

describe("hashBlob 不依赖安全上下文", () => {
  /**
   * 局域网 IP 直连（`http://192.168.x.x`）下 `crypto.subtle` 为 undefined，
   * 原实现在那里直接 TypeError → 被上层裸 catch 吞成"添加失败"，重试永远失败。
   * 这条用例把 crypto 整体抽掉，确认摘要照样算得出且值不变。
   */
  it("crypto.subtle 不可用时仍能算出正确摘要", async () => {
    const original = globalThis.crypto;
    // @ts-expect-error 故意制造非安全上下文：删掉整个 crypto 对象
    delete globalThis.crypto;
    try {
      const hash = await hashBlob(new Blob(["test content"], { type: "text/plain" }));
      expect(hash).toBe("6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72");
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});
