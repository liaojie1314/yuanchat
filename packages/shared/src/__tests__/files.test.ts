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
