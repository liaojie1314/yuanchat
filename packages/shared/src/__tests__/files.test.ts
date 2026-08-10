/**
 * api/files 单元测试：hashBlob 与已知向量断言
 */
import { describe, it, expect } from "vitest";
import { hashBlob } from "../api/files";

describe("hashBlob", () => {
  it("computes SHA-256 hex digest matching the known 'abc' vector", async () => {
    // "abc" 的 SHA-256 是公开已知向量（可用 `printf 'abc' | sha256sum` 复核），
    // 断言具体值而非仅"跑通不报错"，确保实现真的算对而不只是返回了某个字符串
    const blob = new Blob(["abc"]);
    const hex = await hashBlob(blob);
    expect(hex).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
