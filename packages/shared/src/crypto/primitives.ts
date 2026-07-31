/**
 * 加密原语封装（@noble 系列，纯 TS 无 WASM）
 *
 * @description
 * 选用 @noble 而非 libsignal-client / libolm 的原因：
 * - libsignal-client 依赖 node-gyp-build 原生插件，浏览器端不可用
 * - libolm 已被 Matrix 弃用且是 WASM，与本项目 es2019 / Chrome 74
 *   WebView 兼容约束冲突
 * @noble/* 是经审计的纯 TS 实现，转译到 es2019 无障碍。
 *
 * 本文件只做「原语 + 编码」的薄封装，协议逻辑在 x3dh.ts / doubleRatchet.ts。
 * 注意 @noble v2 的 API 变化：导出路径带 .js 后缀，随机私钥用
 * randomSecretKey()，hkdf 的 info 必须是 Uint8Array（不接受 string）。
 */
import { x25519, ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";

/** X25519 / Ed25519 密钥对（原始字节） */
export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

// ---------- 编码 ----------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8ToBytes(s: string): Uint8Array {
  return textEncoder.encode(s);
}

export function bytesToUtf8(b: Uint8Array): string {
  return textDecoder.decode(b);
}

/** Uint8Array → base64（密钥/密文的传输与持久化格式） */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** base64 → Uint8Array */
export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** 拼接多段字节 */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** 常量时间比较（避免密钥/MAC 比较的时序侧信道） */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- 随机 ----------

export function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out;
}

// ---------- 非对称 ----------

/** 生成 X25519 密钥对（DH 用：身份密钥、prekey、棘轮密钥） */
export function generateDHKeyPair(): KeyPair {
  const secretKey = x25519.utils.randomSecretKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/** X25519 DH：返回共享密钥（32 字节） */
export function dh(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(secretKey, publicKey);
}

/** 生成 Ed25519 签名密钥对（签 signed prekey 用） */
export function generateSigningKeyPair(): KeyPair {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, secretKey);
}

export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    // 非法点/长度等异常一律视为验签失败，不向上抛
    return false;
  }
}

// ---------- KDF ----------

/**
 * HKDF-SHA256。
 * @param ikm 输入密钥材料
 * @param salt 盐（可空）
 * @param info 上下文串（内部转 bytes：noble v2 要求 Uint8Array）
 * @param length 输出字节数
 */
export function kdf(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array {
  return hkdf(sha256, ikm, salt, utf8ToBytes(info), length);
}

// ---------- 对称加密 ----------

/** AES-256-GCM nonce 长度 */
export const NONCE_LEN = 12;
/** 消息密钥长度 */
export const KEY_LEN = 32;

/**
 * AES-256-GCM 加密。
 * @param aad 附加认证数据（绑定消息头，防止头部被篡改后仍能解密）
 */
export function encrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const nonce = randomBytes(NONCE_LEN);
  const ciphertext = gcm(key, nonce, aad).encrypt(plaintext);
  return { nonce, ciphertext };
}

/**
 * AES-256-GCM 解密。认证失败（密钥错 / 密文或 aad 被改）抛错。
 */
export function decrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  return gcm(key, nonce, aad).decrypt(ciphertext);
}
