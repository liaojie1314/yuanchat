// 初始化 i18n（react-i18next 需要）
import "@yuanchat/design-system/i18n";
import i18n from "i18next";

// jest-dom 断言扩展（toBeInTheDocument 等）
import "@testing-library/jest-dom/vitest";

// 本包用例的 UI 文案断言统一按 en-US 书写，必须让语言与「默认语言」「宿主 locale」
// 都解耦，否则一改默认语言整包用例全红。
//
// 光调 changeLanguage 不够：themeStore 在 rehydrate 时会把自己的 locale 推给 i18n
// （见 themeStore 的 onRehydrateStorage），而测试环境没有持久化值时它用的是
// detectLocale() 的默认值，于是刚钉好的语言又被改回去。所以这里先把持久化值
// 种成 en-US，让 rehydrate 推的也是 en-US，两条路径一致。
try {
  localStorage.setItem(
    "yuanchat-theme-v2",
    JSON.stringify({ state: { locale: "en-US" }, version: 0 }),
  );
} catch {
  // jsdom 之外（或禁用存储）拿不到 localStorage，退回只钉 i18n
}

// init 是异步的，不等它就 changeLanguage，init 落地时会把语言覆写回 `lng`
if (!i18n.isInitialized) {
  await new Promise<void>((resolve) => i18n.on("initialized", () => resolve()));
}
await i18n.changeLanguage("en-US");
