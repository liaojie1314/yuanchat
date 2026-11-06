/** 快捷键编辑真实交互：保存、冲突提示与恢复默认。 */
import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_SEARCH_SHORTCUT, useShortcutStore } from "@yuanchat/shared";
import i18n from "@yuanchat/design-system/i18n";
import { ShortcutSection } from "../settings/ShortcutSection";

beforeEach(() => {
  useShortcutStore.setState({ searchShortcut: DEFAULT_SEARCH_SHORTCUT });
});
it("捕获新组合后保存，保留键报错但不覆盖，恢复默认可撤销", () => {
  render(<ShortcutSection />);
  const input = screen.getByRole("textbox", { name: i18n.t("shortcuts.search") });
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "K", ctrlKey: true, shiftKey: true });
  expect(useShortcutStore.getState().searchShortcut).toEqual({ key: "k", shift: true, alt: false });
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "w", ctrlKey: true });
  expect(screen.getByRole("alert")).toHaveTextContent(i18n.t("shortcuts.reserved"));
  expect(useShortcutStore.getState().searchShortcut.shift).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("shortcuts.reset") }));
  expect(useShortcutStore.getState().searchShortcut).toEqual(DEFAULT_SEARCH_SHORTCUT);
});
