/**
 * `<html lang>` 与界面语言同步的回归测试
 *
 * 覆盖点：i18n 模块加载时先同步一次（冷启动），之后每次 `changeLanguage` 都跟随。
 * 该包的 vitest 环境是 node，没有 `document`，因此必须在 import 之前打桩。
 */
import { afterAll, describe, expect, it, vi } from "vitest";

// vi.hoisted 跑在所有 import 之前：i18n 模块在求值时就会读一次 document
const documentStub = vi.hoisted(() => {
  const stub = { documentElement: { lang: "" } };
  (globalThis as { document?: unknown }).document = stub;
  return stub;
});

import i18n from "../i18n";

afterAll(async () => {
  await i18n.changeLanguage("zh-CN");
  delete (globalThis as { document?: unknown }).document;
});

describe("html lang 同步", () => {
  it("模块加载时即写入当前语言", () => {
    expect(documentStub.documentElement.lang).toBe(i18n.language);
  });

  it("切换语言后跟随更新", async () => {
    await i18n.changeLanguage("ja-JP");
    expect(documentStub.documentElement.lang).toBe("ja-JP");

    await i18n.changeLanguage("ko-KR");
    expect(documentStub.documentElement.lang).toBe("ko-KR");
  });
});
