import { create } from "zustand";

/** 单条 toast 数据 */
export interface ToastItem {
  id: number;
  kind: "info" | "error";
  text: string;
}

interface ToastState {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
}

let seq = 0;
const AUTO_DISMISS_MS = 3000;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** 全局轻提示：3 秒自动消失，供组件外代码（store/api 回调）直接调用 */
export function showToast(kind: ToastItem["kind"], text: string): void {
  seq += 1;
  const id = seq;
  useToastStore.setState((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
  setTimeout(() => useToastStore.getState().dismiss(id), AUTO_DISMISS_MS);
}
