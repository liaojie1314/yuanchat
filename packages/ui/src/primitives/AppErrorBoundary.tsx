/**
 * AppErrorBoundary — 全局 React 错误边界
 *
 * @description
 * 捕获子树渲染期间的未捕获异常，上报 Sentry（无 DSN 时 console.error 兜底），
 * 并渲染降级 UI（刷新按钮）防止白屏。
 */
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { captureException } from "@yuanchat/shared";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error, { componentStack: info.componentStack ?? undefined });
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex h-full items-center justify-center">
            <button
              onClick={() => window.location.reload()}
              className="text-on-surface-variant text-body-md"
            >
              出错了，点击刷新
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
