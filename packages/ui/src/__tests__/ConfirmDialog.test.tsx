/**
 * ConfirmDialog 无障碍行为测试
 *
 * 文案按 en-US 书写（setup.ts 把本包 i18n 钉在 en-US）。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "../primitives/ConfirmDialog";

/** 渲染一个打开状态的弹窗，返回两个回调便于断言 */
function setup(danger = false) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <ConfirmDialog
      open
      title="Delete sticker pack"
      message="This cannot be undone."
      danger={danger}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel, view };
}

const cancelBtn = () => screen.getByRole("button", { name: "Cancel" });
const confirmBtn = () => screen.getByRole("button", { name: "Confirm" });

describe("ConfirmDialog", () => {
  it("exposes dialog semantics labelled by its title", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId as string)).toHaveTextContent("Delete sticker pack");
  });

  it("closes on Escape", () => {
    const { onCancel, onConfirm } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("focuses cancel on open so Enter cannot fire a destructive action", () => {
    setup(true);
    expect(document.activeElement).toBe(cancelBtn());
  });

  it("cycles Tab inside the dialog", () => {
    setup();
    confirmBtn().focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(cancelBtn());

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirmBtn());
  });

  it("restores focus to the trigger after close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { view } = setup();
    expect(document.activeElement).not.toBe(trigger);

    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
