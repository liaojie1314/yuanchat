/**
 * 通话铃声 — Web Audio 合成（不引音频资源）
 *
 * @description
 * 三种提示音全部现场合成：两个 `OscillatorNode` 经 `GainNode` 做包络。不引 mp3
 * 的理由不是省体积，而是省掉「资源 404 / 解码失败 = 静音来电」这一整类故障。
 *
 * - **来电铃**：440 Hz + 480 Hz 双音，2s 响 / 4s 停 循环，叠 `navigator.vibrate`
 * - **呼出回铃**：450 Hz 单音，1s 响 / 2s 停，增益为来电的 40%
 * - **挂断提示**：单次 200ms 下滑音
 *
 * **唯一致命的失败模式是静音来电** —— 它和「根本没收到来电」在用户看来完全一样。
 * 浏览器 autoplay 策略要求 `AudioContext` 由用户手势创建/恢复：主叫侧的手势是
 * 「点通话按钮」，天然满足；**被叫侧没有任何手势**，`AudioContext` 会停在
 * `suspended`。对策有两层：应用首个 `pointerdown` 预创建并 resume 一个模块级
 * context（{@link primeOnFirstGesture}），以及每次响铃前再 resume 一次兜底。
 *
 * 兼容性：老 WebView 无 `AudioContext` 时全部接口降级为静默 + 仅震动，不抛错。
 */

/** 来电铃：响 2s、停 4s（与系统来电节奏一致，太密会像闹钟） */
const INCOMING_ON_MS = 2000;
const INCOMING_OFF_MS = 4000;
/** 呼出回铃：响 1s、停 2s */
const OUTGOING_ON_MS = 1000;
const OUTGOING_OFF_MS = 2000;
/** 挂断提示音时长 */
const HANGUP_MS = 200;

const INCOMING_GAIN = 0.18;
/** 回铃是给自己听的提示，压到来电的 40%，否则盖住对方接通后的第一句话 */
const OUTGOING_GAIN = INCOMING_GAIN * 0.4;

/** 震动节奏：600ms 震 / 1000ms 停（与来电铃的响停比例大致对齐） */
const VIBRATE_PATTERN = [600, 1000];

/** 包络起落时间：太陡会有「啪」的爆音 */
const ATTACK_S = 0.05;

let ctx: AudioContext | null = null;
let primed = false;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let liveOscs: OscillatorNode[] = [];
let liveGain: GainNode | null = null;

/** 取（或首次创建）模块级 AudioContext；环境不支持时返回 null。 */
function ensureCtx(): AudioContext | null {
  if (ctx !== null) return ctx;
  if (typeof globalThis === "undefined") return null;
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Ctor = g.AudioContext || g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** 震动（不支持的平台静默跳过）。 */
function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate !== "function") return;
  nav.vibrate(pattern);
}

/** 拆掉当前正在发声的节点（下一轮响铃前、以及 stop 时都要做）。 */
function stopNodes(): void {
  for (let i = 0; i < liveOscs.length; i++) {
    const osc = liveOscs[i];
    try {
      osc.stop();
      osc.disconnect();
    } catch {
      /* 已自然停止的节点再 stop 会抛，忽略 */
    }
  }
  liveOscs = [];
  if (liveGain !== null) {
    try {
      liveGain.disconnect();
    } catch {
      /* 同上 */
    }
    liveGain = null;
  }
}

/**
 * 发一段带包络的和声。
 *
 * @param freqs - 同时发声的频率（双音两个、单音一个）
 * @param gainValue - 峰值增益
 * @param durationMs - 发声时长
 */
function playTone(freqs: number[], gainValue: number, durationMs: number): void {
  const audio = ensureCtx();
  if (audio === null) return;
  // 被叫侧没有用户手势，autoplay 策略会让 context 停在 suspended —— 不 resume 就是静音来电
  if (audio.state === "suspended") audio.resume().catch(() => {});

  stopNodes();
  const now = audio.currentTime;
  const endAt = now + durationMs / 1000;

  const gain = audio.createGain();
  gain.gain.value = 0;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gainValue, now + ATTACK_S);
  gain.gain.linearRampToValueAtTime(0, endAt);
  gain.connect(audio.destination);
  liveGain = gain;

  for (let i = 0; i < freqs.length; i++) {
    const osc = audio.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freqs[i];
    osc.connect(gain);
    osc.start();
    osc.stop(endAt);
    liveOscs.push(osc);
  }
}

/** 起一轮循环响铃（每轮先拆上一轮节点，故不会叠音）。 */
function startLoop(freqs: number[], gainValue: number, onMs: number, offMs: number, buzz: boolean) {
  const burst = () => {
    if (buzz) vibrate(VIBRATE_PATTERN);
    playTone(freqs, gainValue, onMs);
    loopTimer = setTimeout(burst, onMs + offMs);
  };
  burst();
}

/**
 * 在应用的首个用户手势上预创建并恢复 AudioContext。
 *
 * @remarks 被叫侧响铃时没有任何手势可用，必须提前借一次。挂在 `pointerdown`
 *   上是浏览器铃声的标准解法，不是本仓特有的绕行。幂等，应用启动时调一次即可。
 */
function primeOnFirstGesture(): void {
  if (primed || typeof document === "undefined") return;
  primed = true;
  const onGesture = () => {
    document.removeEventListener("pointerdown", onGesture);
    const audio = ensureCtx();
    if (audio !== null && audio.state === "suspended") audio.resume().catch(() => {});
  };
  document.addEventListener("pointerdown", onGesture);
}

/** 播放来电铃（双音 + 震动循环）。 */
function playIncoming(): void {
  stop();
  startLoop([440, 480], INCOMING_GAIN, INCOMING_ON_MS, INCOMING_OFF_MS, true);
}

/** 播放呼出回铃（单音循环，不震动 —— 手机就在手里）。 */
function playOutgoing(): void {
  stop();
  startLoop([450], OUTGOING_GAIN, OUTGOING_ON_MS, OUTGOING_OFF_MS, false);
}

/** 播放挂断提示（单次 440→220 下滑音）。 */
function playHangup(): void {
  stop();
  const audio = ensureCtx();
  if (audio === null) return;
  playTone([440], INCOMING_GAIN, HANGUP_MS);
  const osc = liveOscs[0];
  if (osc) {
    const now = audio.currentTime;
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.linearRampToValueAtTime(220, now + HANGUP_MS / 1000);
  }
}

/** 停止一切声音与震动。 */
function stop(): void {
  if (loopTimer !== null) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  stopNodes();
  // 不显式传 0 的话，安卓上 vibrate(pattern) 会一直震到系统超时
  vibrate(0);
}

/** 丢弃模块级 AudioContext（单测隔离 / 登出回收音频资源）。 */
function __reset(): void {
  stop();
  if (ctx !== null) {
    ctx.close().catch(() => {});
    ctx = null;
  }
  primed = false;
}

/**
 * 通话铃声单例。
 *
 * @example
 * ringtone.primeOnFirstGesture();  // 应用启动时
 * ringtone.playIncoming();         // 收到 call.incoming
 * ringtone.stop();                 // 接听 / 拒绝 / 通话结束
 */
export const ringtone = {
  primeOnFirstGesture,
  playIncoming,
  playOutgoing,
  playHangup,
  stop,
  __reset,
};
