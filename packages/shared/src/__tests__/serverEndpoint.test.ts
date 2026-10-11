// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

import {
  getDefaultServerEndpoint,
  getServerEndpoint,
  getServerEndpointOverride,
  setServerEndpointOverride,
} from "../config/serverEndpoint";

const STORAGE_KEY = "yuanchat.server-endpoint";

describe("serverEndpoint", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("没设自定义地址时用构建期默认值", () => {
    expect(getServerEndpointOverride()).toBeNull();
    expect(getServerEndpoint()).toEqual(getDefaultServerEndpoint());
  });

  it("自定义地址覆盖构建期默认值，且不影响默认值本身", () => {
    const fallback = getDefaultServerEndpoint();
    const custom = { apiBaseUrl: "https://api.example.com", wsUrl: "wss://ws.example.com" };

    setServerEndpointOverride(custom);

    expect(getServerEndpoint()).toEqual(custom);
    // 设置页要靠默认值显示「恢复默认后会切到哪」，它不能被覆盖写坏
    expect(getDefaultServerEndpoint()).toEqual(fallback);
  });

  it("传 null 清除覆盖，回到构建期默认值", () => {
    const fallback = getDefaultServerEndpoint();

    setServerEndpointOverride({
      apiBaseUrl: "https://api.example.com",
      wsUrl: "wss://ws.example.com",
    });
    expect(getServerEndpoint().apiBaseUrl).toBe("https://api.example.com");

    setServerEndpointOverride(null);

    expect(getServerEndpointOverride()).toBeNull();
    expect(getServerEndpoint()).toEqual(fallback);
  });

  it("结尾斜杠会被去掉，避免拼出双斜杠路径", () => {
    setServerEndpointOverride({
      apiBaseUrl: "https://api.example.com/",
      wsUrl: "wss://ws.example.com///",
    });

    expect(getServerEndpoint()).toEqual({
      apiBaseUrl: "https://api.example.com",
      wsUrl: "wss://ws.example.com",
    });
  });

  it("存储里是坏数据时当作没设过，而不是让应用崩掉", () => {
    const fallback = getDefaultServerEndpoint();

    localStorage.setItem(STORAGE_KEY, "{ 不是 JSON");
    expect(getServerEndpointOverride()).toBeNull();

    // 字段缺一半同样视为无效，否则 wsUrl 为 undefined 会拖到建连时才炸
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiBaseUrl: "https://a" }));
    expect(getServerEndpointOverride()).toBeNull();
    expect(getServerEndpoint()).toEqual(fallback);
  });
});
