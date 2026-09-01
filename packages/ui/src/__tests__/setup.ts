// 初始化 i18n（react-i18next 需要）
import "@yuanchat/design-system/i18n";
import i18n from "i18next";

// jest-dom 断言扩展（toBeInTheDocument 等）
import "@testing-library/jest-dom/vitest";

// 本包用例的 UI 文案断言统一按 en-US 书写。i18n 默认语言取 navigator.language，
// 而 Node 21 起 navigator.language 跟随宿主 ICU 语言环境（中文机器报 zh-CN、
// runner 报 en-US）——不钉死就会出现「本地全绿、远程报错」（AGENTS.md 门禁要求
// 本地以 LANG=C.UTF-8 跑测试的根因即此）。这里显式钉 en-US，让用例与宿主 locale 解耦。
await i18n.changeLanguage("en-US");
