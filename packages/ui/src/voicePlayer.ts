/**
 * voicePlayer — 模块级单例语音播放器
 *
 * @description
 * 全局同时只播一条语音：播新停旧。play() 返回该消息是否进入播放态。
 * 订阅 onChange 以刷新气泡播放图标（正在播放的 messageId 或 null）。
 */

let audio: HTMLAudioElement | null = null;
let playingId: string | null = null;
const listeners = new Set<(id: string | null) => void>();

function notify() {
  for (const fn of listeners) fn(playingId);
}

/** 订阅当前播放消息变化，返回取消订阅函数 */
export function subscribeVoicePlayer(fn: (id: string | null) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function currentPlayingId(): string | null {
  return playingId;
}

/** 停止当前播放（若有） */
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
