/**
 * Sentry 初始化与异常上报 — 单点封装
 *
 * @description
 * 只在 production 模式且配置了 DSN 时真正初始化 Sentry SDK。
 * 开发环境或未配置 DSN 时，captureException 回退到 console.error。
 * 上层调用 initSentry 一次（在 main.tsx），之后任意处调 captureException。
 */
import * as Sentry from "@sentry/react";

let initialized = false;

/** 仅供测试重置状态 */
export function __resetSentry() {
  initialized = false;
}

export function initSentry(opts: { dsn?: string; release: string; environment: string }) {
  if (!opts.dsn) return;
  Sentry.init({
    dsn: opts.dsn,
    release: opts.release,
    environment: opts.environment,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
  initialized = true;
}

export function captureException(err: unknown, ctx?: Record<string, unknown>) {
  if (initialized) {
    Sentry.captureException(err, { extra: ctx });
  } else {
    console.error("[captureException]", err, ctx);
  }
}
