/**
 * detectPlatform 的单元测试 —— 钉住四条判定规则。
 *
 * UA 样本取自各平台真实浏览器；weird 是认不出平台的反例。
 */
import { describe, expect, it } from "vitest";
import { detectPlatform } from "../detectPlatform";

const UA = {
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  weird: "Mozilla/5.0 (PlayStation 5)",
};

describe("detectPlatform", () => {
  it("userAgentData 优先于 UA 字符串", () => {
    // UA 说 Linux，uaData 说 Windows → 听 uaData（UA 可被伪装/冻结）
    expect(detectPlatform(UA.linux, "Windows")).toBe("windows");
  });

  it("uaData 缺失时回落 UA 字符串（旧 WebView 没有这个 API）", () => {
    expect(detectPlatform(UA.win)).toBe("windows");
    expect(detectPlatform(UA.mac)).toBe("darwin");
    expect(detectPlatform(UA.linux)).toBe("linux");
  });

  it("Android 必须先于 Linux 判定 —— 安卓 UA 里也含 Linux", () => {
    expect(detectPlatform(UA.android)).toBe("android");
  });

  it("认不出来时返 unknown，不瞎猜", () => {
    expect(detectPlatform(UA.weird)).toBe("unknown");
    expect(detectPlatform("")).toBe("unknown");
  });
});
