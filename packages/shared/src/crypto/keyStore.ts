/**
 * E2EE 本地密钥存储
 *
 * @description
 * 持久化身份密钥、prekey 与各会话的棘轮状态。
 *
 * 存储介质用 localStorage：web 与 Tauri WebView 都可用，且与项目既有
 * zustand persist 一致。局限性要清楚——localStorage 明文可读，
 * 同源脚本（XSS）能拿到私钥。这是浏览器端 E2EE 的固有权衡：
 * 真正的硬件级保护需要平台 keychain，Web 端做不到。缓解手段是
 * PIN 加密备份（keyBackup.ts）确保服务器侧永远拿不到明文密钥。
 *
 * 按账号隔离：key 前缀带 userId，多账号切换互不污染。
 */
import { fromBase64, toBase64, type KeyPair } from "./primitives";
import type { IdentityKeyPair, OneTimePreKey, SignedPreKey } from "./x3dh";
import {
  deserializeSession,
  serializeSession,
  type SerializedSession,
  type SessionState,
} from "./doubleRatchet";

const PREFIX = "yuanchat-e2ee";

const identityKeyOf = (userId: string) => `${PREFIX}:${userId}:identity`;
const sessionKeyOf = (userId: string, peerId: string) => `${PREFIX}:${userId}:session:${peerId}`;
const enabledKeyOf = (userId: string) => `${PREFIX}:${userId}:enabled`;

/** 序列化形态的本机密钥材料 */
interface StoredIdentity {
  identityDHPub: string;
  identityDHSec: string;
  identitySignPub: string;
  identitySignSec: string;
  signedPreKeyId: number;
  signedPreKeyPub: string;
  signedPreKeySec: string;
  signedPreKeySignature: string;
  /** 一次性预密钥：公钥已上传服务端，私钥只在本地 */
  oneTimePreKeys: Array<{ id: number; pub: string; sec: string }>;
  /** 下一个可用的 OTK 序号（补充时递增，避免 id 复用） */
  nextOneTimeKeyId: number;
}

/** 本机完整密钥材料（含私钥） */
export interface LocalKeyMaterial {
  identity: IdentityKeyPair;
  signedPreKey: SignedPreKey;
  oneTimePreKeys: OneTimePreKey[];
  nextOneTimeKeyId: number;
}

function serializeKeyPair(kp: KeyPair): { pub: string; sec: string } {
  return { pub: toBase64(kp.publicKey), sec: toBase64(kp.secretKey) };
}

function deserializeKeyPair(pub: string, sec: string): KeyPair {
  return { publicKey: fromBase64(pub), secretKey: fromBase64(sec) };
}

/** 读本机密钥材料；未初始化返回 null */
export function loadKeyMaterial(userId: string): LocalKeyMaterial | null {
  const raw = localStorage.getItem(identityKeyOf(userId));
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as StoredIdentity;
    return {
      identity: {
        dhKeyPair: deserializeKeyPair(d.identityDHPub, d.identityDHSec),
        signKeyPair: deserializeKeyPair(d.identitySignPub, d.identitySignSec),
      },
      signedPreKey: {
        id: d.signedPreKeyId,
        keyPair: deserializeKeyPair(d.signedPreKeyPub, d.signedPreKeySec),
        signature: fromBase64(d.signedPreKeySignature),
      },
      oneTimePreKeys: d.oneTimePreKeys.map((k) => ({
        id: k.id,
        keyPair: deserializeKeyPair(k.pub, k.sec),
      })),
      nextOneTimeKeyId: d.nextOneTimeKeyId,
    };
  } catch {
    // 存储损坏：视为未初始化，上层会重新生成（旧会话将无法解密）
    return null;
  }
}

/** 写本机密钥材料 */
export function saveKeyMaterial(userId: string, material: LocalKeyMaterial): void {
  const idDH = serializeKeyPair(material.identity.dhKeyPair);
  const idSign = serializeKeyPair(material.identity.signKeyPair);
  const spk = serializeKeyPair(material.signedPreKey.keyPair);
  const stored: StoredIdentity = {
    identityDHPub: idDH.pub,
    identityDHSec: idDH.sec,
    identitySignPub: idSign.pub,
    identitySignSec: idSign.sec,
    signedPreKeyId: material.signedPreKey.id,
    signedPreKeyPub: spk.pub,
    signedPreKeySec: spk.sec,
    signedPreKeySignature: toBase64(material.signedPreKey.signature),
    oneTimePreKeys: material.oneTimePreKeys.map((k) => ({
      id: k.id,
      ...serializeKeyPair(k.keyPair),
    })),
    nextOneTimeKeyId: material.nextOneTimeKeyId,
  };
  localStorage.setItem(identityKeyOf(userId), JSON.stringify(stored));
}

/** 取出并消费指定 id 的一次性预密钥（用后从本地池移除） */
export function consumeOneTimePreKey(userId: string, keyId: number): OneTimePreKey | undefined {
  const material = loadKeyMaterial(userId);
  if (!material) return undefined;
  const idx = material.oneTimePreKeys.findIndex((k) => k.id === keyId);
  if (idx < 0) return undefined;
  const [used] = material.oneTimePreKeys.splice(idx, 1);
  saveKeyMaterial(userId, material);
  return used;
}

/** 读某会话的棘轮状态 */
export function loadSession(userId: string, peerId: string): SessionState | null {
  const raw = localStorage.getItem(sessionKeyOf(userId, peerId));
  if (!raw) return null;
  try {
    return deserializeSession(JSON.parse(raw) as SerializedSession);
  } catch {
    return null;
  }
}

/** 写某会话的棘轮状态（每收发一条消息后都要落盘，否则重启会话即失效） */
export function saveSession(userId: string, peerId: string, state: SessionState): void {
  localStorage.setItem(sessionKeyOf(userId, peerId), JSON.stringify(serializeSession(state)));
}

/** 删除某会话（对方重置密钥导致无法解密时清理重建） */
export function deleteSession(userId: string, peerId: string): void {
  localStorage.removeItem(sessionKeyOf(userId, peerId));
}

/** 列出所有已建立会话的对端 id（备份用） */
export function listSessionPeers(userId: string): string[] {
  const prefix = `${PREFIX}:${userId}:session:`;
  const peers: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) peers.push(key.slice(prefix.length));
  }
  return peers;
}

/** E2EE 开关（灰度：默认关闭，用户主动开启） */
export function isE2EEEnabled(userId: string): boolean {
  return localStorage.getItem(enabledKeyOf(userId)) === "1";
}

export function setE2EEEnabled(userId: string, enabled: boolean): void {
  if (enabled) {
    localStorage.setItem(enabledKeyOf(userId), "1");
  } else {
    localStorage.removeItem(enabledKeyOf(userId));
  }
}

/** 清空该账号的全部 E2EE 数据（登出/重置时用） */
export function clearAllKeys(userId: string): void {
  const prefix = `${PREFIX}:${userId}:`;
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) doomed.push(key);
  }
  for (const key of doomed) localStorage.removeItem(key);
}
