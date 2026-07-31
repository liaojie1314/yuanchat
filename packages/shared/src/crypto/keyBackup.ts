/**
 * 密钥备份与恢复（PIN 加密）
 *
 * @description
 * 换设备/清缓存后要恢复历史会话，必须把密钥带走。做法：
 *   PIN --scrypt(salt)--> KEK --AES-GCM--> 加密密钥包 --上传--> 服务器
 *
 * 服务器只拿到密文与盐，**不知道 PIN**，因此无法解密——这是 E2EE
 * 承诺「服务器端无明文」的关键一环。
 *
 * scrypt 参数选 N=2^15/r=8/p=1：约 32MB 内存、数百毫秒，
 * 对 4-6 位 PIN 的暴力破解构成实质成本，同时移动端仍可接受。
 *
 * ⚠️ 局限：PIN 熵很低。攻击者若同时拿到服务器上的备份密文，
 * 离线爆破 6 位数字 PIN 仍是可行的（约 10^6 次 scrypt）。
 * 因此 UI 应引导用户使用较长的 PIN/口令，并提示这一点。
 */
import { scrypt } from "@noble/hashes/scrypt.js";
import { fetchKeyBackup, saveKeyBackup } from "../api/e2ee";
import {
  concatBytes,
  decrypt,
  encrypt,
  fromBase64,
  randomBytes,
  toBase64,
  utf8ToBytes,
  bytesToUtf8,
  KEY_LEN,
  NONCE_LEN,
} from "./primitives";
import {
  loadKeyMaterial,
  loadSession,
  saveKeyMaterial,
  saveSession,
  listSessionPeers,
  type LocalKeyMaterial,
} from "./keyStore";
import { serializeSession, deserializeSession, type SerializedSession } from "./doubleRatchet";

/** scrypt 代价参数（改动会导致旧备份无法解密，故随 version 一同记录） */
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, dkLen: KEY_LEN };
const SALT_LEN = 16;
/** 备份格式版本：将来改参数或结构时递增 */
export const BACKUP_VERSION = 1;

/** 备份包明文结构 */
interface BackupPayload {
  version: number;
  identity: {
    dhPub: string;
    dhSec: string;
    signPub: string;
    signSec: string;
  };
  signedPreKey: { id: number; pub: string; sec: string; signature: string };
  oneTimePreKeys: Array<{ id: number; pub: string; sec: string }>;
  nextOneTimeKeyId: number;
  /** 各会话棘轮状态：恢复后历史加密消息仍可解 */
  sessions: Array<{ peerId: string; state: SerializedSession }>;
}

/** PIN + 盐 → 加密密钥 */
function deriveKEK(pin: string, salt: Uint8Array): Uint8Array {
  return scrypt(utf8ToBytes(pin), salt, SCRYPT_PARAMS);
}

function buildPayload(userId: string, material: LocalKeyMaterial): BackupPayload {
  const sessions = listSessionPeers(userId)
    .map((peerId) => {
      const state = loadSession(userId, peerId);
      return state ? { peerId, state: serializeSession(state) } : null;
    })
    .filter((s): s is { peerId: string; state: SerializedSession } => s !== null);

  return {
    version: BACKUP_VERSION,
    identity: {
      dhPub: toBase64(material.identity.dhKeyPair.publicKey),
      dhSec: toBase64(material.identity.dhKeyPair.secretKey),
      signPub: toBase64(material.identity.signKeyPair.publicKey),
      signSec: toBase64(material.identity.signKeyPair.secretKey),
    },
    signedPreKey: {
      id: material.signedPreKey.id,
      pub: toBase64(material.signedPreKey.keyPair.publicKey),
      sec: toBase64(material.signedPreKey.keyPair.secretKey),
      signature: toBase64(material.signedPreKey.signature),
    },
    oneTimePreKeys: material.oneTimePreKeys.map((k) => ({
      id: k.id,
      pub: toBase64(k.keyPair.publicKey),
      sec: toBase64(k.keyPair.secretKey),
    })),
    nextOneTimeKeyId: material.nextOneTimeKeyId,
    sessions,
  };
}

/** PIN 太短：熵不足以抵抗离线爆破 */
export class WeakPinError extends Error {
  constructor(message = "pin too short") {
    super(message);
    this.name = "WeakPinError";
  }
}

/** 备份解密失败：PIN 错误或数据损坏 */
export class BackupDecryptError extends Error {
  constructor(message = "backup decryption failed (wrong PIN?)") {
    super(message);
    this.name = "BackupDecryptError";
  }
}

/** PIN 最小长度 */
export const MIN_PIN_LENGTH = 6;

/**
 * 创建备份并上传：本地密钥 + 全部会话 → PIN 加密 → 服务器。
 *
 * @throws WeakPinError PIN 长度不足
 */
export async function createBackup(userId: string, pin: string): Promise<void> {
  if (pin.length < MIN_PIN_LENGTH) throw new WeakPinError();

  const material = loadKeyMaterial(userId);
  if (!material) throw new Error("no local key material to back up");

  const salt = randomBytes(SALT_LEN);
  const kek = deriveKEK(pin, salt);
  const plaintext = utf8ToBytes(JSON.stringify(buildPayload(userId, material)));
  const { nonce, ciphertext } = encrypt(kek, plaintext);

  // blob = nonce || ciphertext（单字段传输，解密端按固定长度切分）
  await saveKeyBackup(toBase64(concatBytes(nonce, ciphertext)), toBase64(salt), BACKUP_VERSION);
}

/**
 * 从服务器恢复备份：拉密文 → PIN 解密 → 写回本地。
 *
 * @returns false 表示服务器没有备份
 * @throws BackupDecryptError PIN 错误或数据损坏
 */
export async function restoreBackup(userId: string, pin: string): Promise<boolean> {
  const remote = await fetchKeyBackup();
  if (!remote) return false;

  const blob = fromBase64(remote.cipher_blob);
  const nonce = blob.slice(0, NONCE_LEN);
  const ciphertext = blob.slice(NONCE_LEN);
  const kek = deriveKEK(pin, fromBase64(remote.salt));

  let payload: BackupPayload;
  try {
    payload = JSON.parse(bytesToUtf8(decrypt(kek, nonce, ciphertext))) as BackupPayload;
  } catch {
    // GCM 认证失败（PIN 错）或 JSON 损坏，都归为同一类失败，
    // 不泄露「PIN 对但数据坏」这类信息
    throw new BackupDecryptError();
  }

  if (payload.version > BACKUP_VERSION) {
    throw new BackupDecryptError("backup created by a newer version");
  }

  saveKeyMaterial(userId, {
    identity: {
      dhKeyPair: {
        publicKey: fromBase64(payload.identity.dhPub),
        secretKey: fromBase64(payload.identity.dhSec),
      },
      signKeyPair: {
        publicKey: fromBase64(payload.identity.signPub),
        secretKey: fromBase64(payload.identity.signSec),
      },
    },
    signedPreKey: {
      id: payload.signedPreKey.id,
      keyPair: {
        publicKey: fromBase64(payload.signedPreKey.pub),
        secretKey: fromBase64(payload.signedPreKey.sec),
      },
      signature: fromBase64(payload.signedPreKey.signature),
    },
    oneTimePreKeys: payload.oneTimePreKeys.map((k) => ({
      id: k.id,
      keyPair: { publicKey: fromBase64(k.pub), secretKey: fromBase64(k.sec) },
    })),
    nextOneTimeKeyId: payload.nextOneTimeKeyId,
  });

  for (const s of payload.sessions) {
    saveSession(userId, s.peerId, deserializeSession(s.state));
  }

  return true;
}

/** 服务器上是否已有备份（引导用户设置 PIN 时判断） */
export async function hasRemoteBackup(): Promise<boolean> {
  return (await fetchKeyBackup()) !== null;
}
