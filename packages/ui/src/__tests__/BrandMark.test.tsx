/**
 * BrandMark 测试 —— 镂空靠 mask，mask id 必须每个实例唯一
 *
 * SVG 的 id 是文档级而非组件级的：同一页面渲染两个实例时若用固定 id，
 * 后者会覆盖前者的 mask 定义。虽然两份定义内容相同、肉眼看不出问题，
 * 但只要将来给某个实例换形状就会无声串台，所以这条不变量要钉住。
 */
import { render, cleanup } from "@testing-library/react";
import { describe, expect, it, afterEach } from "vitest";
import { BrandMark } from "../primitives/BrandMark";

afterEach(cleanup);

describe("BrandMark", () => {
  it("按 size 渲染方形 SVG，并带可读标签", () => {
    const { getByRole } = render(<BrandMark size={44} />);
    const svg = getByRole("img");
    expect(svg.getAttribute("width")).toBe("44");
    expect(svg.getAttribute("height")).toBe("44");
    expect(svg.getAttribute("aria-label")).toBe("元聊 YuanChat");
  });

  it("多个实例的 mask id 互不相同，且不含冒号", () => {
    const { container } = render(
      <>
        <BrandMark />
        <BrandMark />
      </>,
    );
    const ids = Array.from(container.querySelectorAll("mask")).map((m) => m.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).not.toContain(":");
    // 引用必须指向自己那一份
    const refs = Array.from(container.querySelectorAll("rect[mask]")).map((r) =>
      r.getAttribute("mask"),
    );
    expect(refs).toEqual(ids.map((id) => `url(#${id})`));
  });

  it("「元」字是镂空的：mask 里的笔画涂黑，底色由父容器提供", () => {
    const { container } = render(<BrandMark />);
    const strokes = container.querySelector("mask > g");
    expect(strokes?.getAttribute("stroke")).toBe("black");
    // 图形本体用 currentColor，才能跟着父级文字色走
    expect(container.querySelector("rect[mask]")?.getAttribute("fill")).toBe("currentColor");
  });
});
