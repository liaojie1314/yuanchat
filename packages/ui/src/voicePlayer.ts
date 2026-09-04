/**
 * voicePlayer — 模块级单例语音播放器
 *
 * @description
 * 全局同时只播一条语音：播新停旧。play() 返回该消息是否进入播放态。
 * 订阅 onChange 以刷新气泡播放图标与倍速标签（当前播放的 messageId + 当前倍速）。
 *
 * 倍速是**全局且跨播放保持**的：用户调成 1.5x 后，下一条语音仍是 1.5x
 * （与主流 IM 一致），故 stopVoice 不重置 rate，只有 setVoiceRate 才改。
 */

/** 支持的播放倍速（离散档位，不做任意值） */
export type VoiceRate = 1 | 1.5 | 2;

/** 播放器对外状态：当前播放的消息 ID（无则 null）与当前倍速 */
export interface VoicePlayerState {
  playingId: string | null;
  rate: VoiceRate;
}

/** 倍速循环序：1 → 1.5 → 2 → 1（显式表，不用取模算术——档位不等距，算不出来） */
const NEXT_RATE: Record<string, VoiceRate> = { "1": 1.5, "1.5": 2, "2": 1 };

let audio: HTMLAudioElement | null = null;
let playingId: string | null = null;
let rate: VoiceRate = 1;
const listeners = new Set<(state: VoicePlayerState) => void>();

function notify() {
  const state: VoicePlayerState = { playingId, rate };
  for (const fn of listeners) fn(state);
}

/** 订阅播放态变化（播放的消息 ID / 倍速），返回取消订阅函数 */
export function subscribeVoicePlayer(fn: (state: VoicePlayerState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 当前播放态快照（组件初始化 useState 用） */
export function voicePlayerState(): VoicePlayerState {
  return { playingId, rate };
}

export function currentPlayingId(): string | null {
  return playingId;
}

/** 当前倍速 */
export function getVoiceRate(): VoiceRate {
  return rate;
}

/** 循环序里的下一档倍速（1 → 1.5 → 2 → 1） */
export function nextVoiceRate(current: VoiceRate): VoiceRate {
  return NEXT_RATE[String(current)] ?? 1;
}

/**
 * 设置全局倍速。
 *
 * @param next - 目标倍速档位
 * @remarks 正在播放时立即生效（不打断播放，不回到开头），并广播给订阅者刷新标签。
 */
export function setVoiceRate(next: VoiceRate): void {
  rate = next;
  if (audio) audio.playbackRate = next;
  notify();
}

/** 停止当前播放（若有）；不重置倍速 */
export function stopVoice(): void {
  if (audio) {
    audio.pause();
    audio = null;
  }
  if (playingId !== null) {
    playingId = null;
    notify();
  }
}

/**
 * 播放一条语音：同 id 再点 = 停止（toggle）；不同 id = 停旧播新。
 * @returns 播放失败时 reject（调用方 toast）
 */
export async function playVoice(messageId: string, url: string): Promise<void> {
  if (playingId === messageId) {
    stopVoice();
    return;
  }
  stopVoice();
  const el = new Audio(url);
  audio = el;
  playingId = messageId;
  // 新音频默认 1x，须把全局倍速带过来，否则「调了倍速下一条又回 1x」
  el.playbackRate = rate;
  el.onended = () => {
    if (audio === el) stopVoice();
  };
  el.onerror = () => {
    if (audio === el) stopVoice();
  };
  notify();
  try {
    await el.play();
  } catch (err) {
    if (audio === el) stopVoice();
    throw err;
  }
}
