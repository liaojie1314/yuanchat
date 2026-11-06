// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetFileSink, getFileSink, setFileSink, uniqueFileName } from "../fileSink";

afterEach(() => {
  __resetFileSink();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("uniqueFileName", () => {
  it("名字没被占用时原样返回", () => {
    expect(uniqueFileName("a.pdf", () => false)).toBe("a.pdf");
  });

  it("被占用时在后缀前递增，不碰扩展名", () => {
    const taken = new Set(["a.pdf", "a (2).pdf"]);
    expect(uniqueFileName("a.pdf", (name) => taken.has(name))).toBe("a (3).pdf");
  });

  it("无扩展名的文件也能递增", () => {
    const taken = new Set(["README"]);
    expect(uniqueFileName("README", (name) => taken.has(name))).toBe("README (2)");
  });

  it("多重扩展名只认最后一段", () => {
    const taken = new Set(["x.tar.gz"]);
    expect(uniqueFileName("x.tar.gz", (name) => taken.has(name))).toBe("x.tar (2).gz");
  });
});

describe("web 默认实现", () => {
  it("未注入时走 <a download> 并回收 blob URL", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    const clicked: HTMLAnchorElement[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = originalCreate(tag);
      if (tag === "a") {
        const anchor = element as HTMLAnchorElement;
        anchor.click = () => clicked.push(anchor);
      }
      return element;
    });

    const path = await getFileSink().save(
      new Uint8Array([1, 2, 3]),
      "report.pdf",
      "application/pdf",
    );

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("report.pdf");
    expect(clicked[0].href).toContain("blob:fake");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    expect(path).toBeNull();
  });

  it("注入后 getFileSink 返回注入的实现", async () => {
    const save = vi.fn().mockResolvedValue("a (2).pdf");
    setFileSink({ save });

    const path = await getFileSink().save(new Uint8Array(), "a.pdf", "application/pdf");

    expect(path).toBe("a (2).pdf");
    expect(save).toHaveBeenCalled();
  });
});
