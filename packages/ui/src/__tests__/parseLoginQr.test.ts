/**
 * 扫码登录二维码来源校验单测
 *
 * @description
 * `parseLoginQr` 是纯函数，不需要真机。它是「任意二维码内容不得被当成会话凭据提交」
 * 这条安全约束的唯一执行点，因此负向用例（钓鱼 scheme、空 token）比正向用例更重要。
 */
import { describe, it, expect } from "vitest";
import { parseLoginQr } from "../auth/parseLoginQr";

describe("parseLoginQr", () => {
  it("接受本应用二维码并取出 token", () => {
    expect(parseLoginQr("yuanchat://login?t=abc123")).toBe("abc123");
  });

  it("对 token 做 URL 解码", () => {
    expect(parseLoginQr("yuanchat://login?t=a%2Fb%3Dc")).toBe("a/b=c");
  });

  it.each([
    ["https://evil.example/?t=abc", "他站 https 链接"],
    ["yuanchat://login?t=", "token 为空"],
    ["", "空字符串"],
    ["yuanchat://register?t=abc", "同 scheme 但不是登录路径"],
    ["Yuanchat://login?t=abc", "scheme 大小写不符"],
    [" yuanchat://login?t=abc", "前置空格"],
    ["prefix-yuanchat://login?t=abc", "前缀被套壳"],
    ["随便一段文字", "非 URL 文本"],
  ])("拒绝 %s（%s）", (raw) => {
    expect(parseLoginQr(raw)).toBeNull();
  });
});
