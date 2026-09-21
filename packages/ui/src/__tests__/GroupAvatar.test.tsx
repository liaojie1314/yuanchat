/**
 * GroupAvatar 测试：微信式成员头像拼合
 *
 * 覆盖 3-9 人的分行规则、10 人只取前 9、部分成员无头像的兜底格，
 * 以及群设了自己的头像时不拼合。
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { GroupAvatar } from "../primitives/GroupAvatar";

/** n 个成员头像 URL；`blanks` 里的下标置空串（该成员没设头像） */
function avatars(n: number, blanks: number[] = []): string[] {
  return Array.from({ length: n }, (_, i) =>
    blanks.indexOf(i) >= 0 ? "" : "https://cdn/" + i + ".png",
  );
}

function renderGroup(list: string[], src?: string | null) {
  const { container } = render(<GroupAvatar name="产品研发群" src={src} avatars={list} />);
  const root = container.querySelector("[data-group-rows]");
  return {
    container,
    rows: root ? root.getAttribute("data-group-rows") : null,
    tiles: container.querySelectorAll("[data-group-tile]").length,
    images: container.querySelectorAll("[data-group-tile] img").length,
    fallbacks: container.querySelectorAll("[data-group-fallback]").length,
  };
}

describe("GroupAvatar", () => {
  // 微信规则：1 居中 / 2 并排 / 3 上 1 下 2 / 4 田字 / 5 上 2 下 3 / 6 两行三列 /
  // 7-9 三行三列，不足的一行补在最上且居中
  const CASES: { n: number; rows: string; tiles: number }[] = [
    { n: 3, rows: "1,2", tiles: 3 },
    { n: 4, rows: "2,2", tiles: 4 },
    { n: 5, rows: "2,3", tiles: 5 },
    { n: 6, rows: "3,3", tiles: 6 },
    { n: 7, rows: "1,3,3", tiles: 7 },
    { n: 8, rows: "2,3,3", tiles: 8 },
    { n: 9, rows: "3,3,3", tiles: 9 },
    // 超过 9 个只取前 9
    { n: 10, rows: "3,3,3", tiles: 9 },
  ];

  CASES.forEach(({ n, rows, tiles }) => {
    it(n + " 人按 " + rows + " 分行，渲染 " + tiles + " 格", () => {
      const got = renderGroup(avatars(n));
      expect(got.rows).toBe(rows);
      expect(got.tiles).toBe(tiles);
    });
  });

  it("1 人与 2 人也成立（单格 / 并排两格）", () => {
    expect(renderGroup(avatars(1)).rows).toBe("1");
    expect(renderGroup(avatars(2)).rows).toBe("2");
  });

  it("部分成员没头像时该格退纯色块，其余照常出图", () => {
    const got = renderGroup(avatars(5, [1, 3]));
    expect(got.tiles).toBe(5);
    expect(got.images).toBe(3);
    expect(got.fallbacks).toBe(2);
  });

  it("群设了自己的头像时不拼合", () => {
    const got = renderGroup(avatars(6), "https://cdn/group.png");
    expect(got.rows).toBeNull();
    expect(got.tiles).toBe(0);
  });

  it("既没群头像也没成员头像时退回首字母", () => {
    const { container } = render(<GroupAvatar name="产品研发群" avatars={[]} />);
    expect(container.querySelectorAll("[data-group-tile]")).toHaveLength(0);
    expect(container.textContent).toContain("产品");
  });

  it("成员全都没设头像时仍按人数拼格", () => {
    const got = renderGroup(["", "", ""]);
    expect(got.rows).toBe("1,2");
    expect(got.fallbacks).toBe(3);
  });

  // 空头像格靠成员昵称首字兜底：两列及以内才写字（三列的格子只有外框 1/3 宽，写字必糊）
  it("空格子取该成员昵称首字，不是群名首字", () => {
    const { container } = render(
      <GroupAvatar
        name="产品研发群"
        avatars={["", "https://cdn/1.png", ""]}
        names={["陈曦", "林墨", "苏晴"]}
      />,
    );
    const texts = Array.from(container.querySelectorAll("[data-group-fallback]")).map(
      (el) => el.textContent,
    );
    expect(texts).toEqual(["陈", "苏"]);
  });

  it("同一昵称在不同群里配色一致，同群不同人配色不同", () => {
    const colorsOf = (groupName: string) =>
      Array.from(
        render(
          <GroupAvatar name={groupName} avatars={["", ""]} names={["陈曦", "林墨"]} />,
        ).container.querySelectorAll("[data-group-fallback]"),
      ).map((el) => (el as HTMLElement).style.backgroundColor);

    const a = colorsOf("产品研发群");
    const b = colorsOf("设计组");
    expect(a[0]).toBe(b[0]); // 陈曦 换个群仍是同一个色
    expect(a[0]).not.toBe(a[1]); // 同群里两个人不撞色
  });

  it("没传 names 时退回群名首字（旧调用方不炸）", () => {
    const { container } = render(<GroupAvatar name="产品研发群" avatars={["", ""]} />);
    const texts = Array.from(container.querySelectorAll("[data-group-fallback]")).map(
      (el) => el.textContent,
    );
    expect(texts).toEqual(["产", "产"]);
  });

  it("names 比 avatars 短时，多出来的格子退回群名首字", () => {
    const { container } = render(
      <GroupAvatar name="产品研发群" avatars={["", "", ""]} names={["陈曦"]} />,
    );
    const texts = Array.from(container.querySelectorAll("[data-group-fallback]")).map(
      (el) => el.textContent,
    );
    expect(texts).toEqual(["陈", "产", "产"]);
  });
});
