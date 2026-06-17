import { describe, it, expect } from "vitest";
import { getAvatarColor } from "../utils/avatarColor";

describe("getAvatarColor", () => {
  it("returns a hex color string", () => {
    const color = getAvatarColor("张三");
    expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("returns the same color for the same name", () => {
    const a = getAvatarColor("李四");
    const b = getAvatarColor("李四");
    expect(a).toBe(b);
  });

  it("returns different colors for different names (with high probability)", () => {
    // 16 色调色板，不同名字大概率返回不同颜色
    const colors = new Set<string>();
    const names = ["张三", "李四", "王五", "赵六", "孙七", "周八", "吴九", "郑十"];
    for (const name of names) {
      colors.add(getAvatarColor(name));
    }
    // 8 个不同名字中至少应有 2 种不同颜色（极低碰撞概率）
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });

  it("handles empty string gracefully", () => {
    const color = getAvatarColor("");
    expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("handles English names", () => {
    const color = getAvatarColor("John");
    expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("handles very long names", () => {
    const color = getAvatarColor("这是一个非常非常非常长的用户名用来测试哈希函数");
    expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("produces colors only from the known palette", () => {
    // 测试足够多的名字，确保返回的颜色都在 16 色调色板内
    const palette = [
      "#4A90D9",
      "#E85D75",
      "#9B59B6",
      "#2ECC71",
      "#F39C12",
      "#1ABC9C",
      "#E74C3C",
      "#3498DB",
      "#E91E63",
      "#00BCD4",
      "#8BC34A",
      "#FF9800",
      "#7C4DFF",
      "#00BFA5",
      "#FF6D00",
      "#2979FF",
    ];
    for (let i = 0; i < 100; i++) {
      const color = getAvatarColor(`user_${i}`);
      expect(palette).toContain(color);
    }
  });
});
