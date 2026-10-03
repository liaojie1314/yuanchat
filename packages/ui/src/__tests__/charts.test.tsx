/**
 * SVG 图表组件单元测试
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "../charts/Sparkline";
import { LineChart } from "../charts/LineChart";
import { DonutChart } from "../charts/DonutChart";

const pts = [
  { date: "2026-09-01", value: 10 },
  { date: "2026-09-02", value: 20 },
  { date: "2026-09-03", value: 5 },
];

describe("Sparkline", () => {
  it("渲染 polyline", () => {
    const { container } = render(<Sparkline data={pts} aria-label="测试趋势" />);
    expect(container.querySelector("polyline")).toBeTruthy();
  });

  it("空数据不渲染任何图形", () => {
    const { container } = render(<Sparkline data={[]} aria-label="空数据" />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("全零序列不渲染（贴底平线不表达趋势）", () => {
    const { container } = render(
      <Sparkline
        data={[
          { date: "2026-09-01", value: 0 },
          { date: "2026-09-02", value: 0 },
        ]}
        aria-label="全零"
      />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("单点不崩溃", () => {
    const { container } = render(
      <Sparkline data={[{ date: "2026-09-01", value: 42 }]} aria-label="单点" />,
    );
    expect(container.querySelector("polyline")).toBeTruthy();
  });

  it("带 role=img 和 aria-label", () => {
    const { container } = render(<Sparkline data={pts} aria-label="无障碍标签" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("无障碍标签");
  });
});

describe("LineChart", () => {
  const labels = pts.map((p) => p.date);
  const series = [{ key: "msg", label: "消息", values: pts.map((p) => p.value), color: "#5B9BD5" }];

  it("渲染折线 path", () => {
    const { container } = render(
      <LineChart xLabels={labels} series={series} aria-label="折线图" />,
    );
    expect(container.querySelector("path")).toBeTruthy();
  });

  it("空数据不崩溃", () => {
    const { container } = render(
      <LineChart xLabels={[]} series={[{ key: "x", label: "x", values: [] }]} aria-label="空" />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("全为零不崩溃", () => {
    const { container } = render(
      <LineChart
        xLabels={["a", "b", "c"]}
        series={[{ key: "x", label: "x", values: [0, 0, 0] }]}
        aria-label="全零"
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("带 role=img 和 aria-label", () => {
    const { container } = render(
      <LineChart xLabels={labels} series={series} aria-label="图表标签" />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("图表标签");
  });
});

describe("DonutChart", () => {
  const slices = [
    { key: "text", label: "文本", value: 100 },
    { key: "image", label: "图片", value: 40 },
    { key: "file", label: "文件", value: 20 },
  ];

  it("渲染分段弧", () => {
    const { container } = render(<DonutChart slices={slices} aria-label="消息类型" />);
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(3);
  });

  it("空数据渲染占位圆", () => {
    const { container } = render(<DonutChart slices={[]} aria-label="空" />);
    expect(container.querySelector("circle")).toBeTruthy();
    expect(container.querySelector("path")).toBeNull();
  });

  it("超过 6 条聚合", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      key: `k${i}`,
      label: `L${i}`,
      value: i + 1,
    }));
    const { container } = render(<DonutChart slices={many} aria-label="聚合" />);
    // 最多 6 个分段
    expect(container.querySelectorAll("path").length).toBeLessThanOrEqual(6);
  });

  it("带 role=img 和 aria-label", () => {
    const { container } = render(<DonutChart slices={slices} aria-label="饼图标签" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("饼图标签");
  });
});
