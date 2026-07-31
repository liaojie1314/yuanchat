/**
 * E2EE 会话管理器 — 协议层与消息链路之间的门面
 *
 * @description
 * 对上只暴露四件事：初始化、加密、解密、状态查询；
 * 内部处理密钥生成/上传、prekey 补充、会话建立与持久化。
 *
 * 设计取舍：
 * - **仅单聊**：群聊 E2EE 需要 Sender Key（Megolm 类）方案，v1.1 再做。
 *   群会话调用方不应走本模块。
 * - **灰度开关**：默认关闭，用户在设置里主动开启（isEnabled）。
 *   关闭时消息链路完全走原明文路径，零影响。
 * - **对方未启用则降级**：取 bundle 得 404 时返回 null，调用方发明文。
 *   这是可用性与安全的折中，UI 需明确标示会话是否加密。
 * - **每次收发后落盘会话**：棘轮状态不落盘则刷新页面即无法解密后续消息。
 */
import {
  fetchPreKeyBundle,
  fetchPreKeyCount,
  uploadKeys,
  type RemotePreKeyBundle,
} from "../api/e2ee";
import { fromBase64, toBase64, utf8ToBytes, bytesToUtf8 } from "./primitives";
import {
  buildPublicBundle,
  generateIdentityKeyPair,
  generateOneTimePreKeys,
  generateSignedPreKey,
  initiateX3DH,
  respondX3DH,
  type PublicPreKeyBundle,
} from "./x3dh";
import {
  decryptMessage,
  encryptMessage,
  initSessionAsReceiver,
  initSessionAsSender,
  safetyNumber,
  type RatchetMessage,
  type SessionState,
} from "./doubleRatchet";
import {
  consumeOneTimePreKey,
  isE2EEEnabled,
  loadKeyMaterial,
  loadSession,
  saveKeyMaterial,
  saveSession,
  setE2EEEnabled,
  deleteSession,
  type LocalKeyMaterial,
} from "./keyStore";

/** 一次性预密钥批量生成数量 */
const OTK_BATCH = 100;
/** 剩余量低于此值时补充（避免池空后所有新会话降级为 3DH） */
const OTK_LOW_WATER = 20;

/** 线上传输的 e2ee 消息内容（与服务端 ContentPayload 的 e2ee 字段对应） */
export interface E2EEContent {
  type: "e2ee";
  ratchet_key: string;
  n: number;
  pn: number;
  nonce: string;
  ciphertext: string;
  /** 首条消息才带：接收方据此完成 X3DH */
  identity_key?: string;
  ephemeral_key?: string;
  otk_id?: number;
}

/** 确保本机密钥材料就绪（不存在则生成），并上传公钥 */
export async function initE2EE(userId: string): Promise<LocalKeyMaterial> {
  let material = loadKeyMaterial(userId);

  if (!material) {
    const identity = generateIdentityKeyPair();
    const signedPreKey = generateSignedPreKey(identity, 1);
    const oneTimePreKeys = generateOneTimePreKeys(1, OTK_BATCH);
    material = {
      identity,
      signedPreKey,
      oneTimePreKeys,
      nextOneTimeKeyId: OTK_BATCH + 1,
    };
    saveKeyMaterial(userId, material);

    const pub = buildPublicBundle(identity, signedPreKey);
    await uploadKeys({
      identity_dh_public_key: toBase64(pub.identityDHPublicKey),
      identity_sign_public_key: toBase64(pub.identitySignPublicKey),
      signed_prekey_id: pub.signedPreKeyId,
      signed_prekey_public: toBase64(pub.signedPreKeyPublic),
      signed_prekey_signature: toBase64(pub.signedPreKeySignature),
      one_time_prekeys: oneTimePreKeys.map((k) => ({
        key_id: k.id,
        public_key: toBase64(k.keyPair.publicKey),
      })),
    });
  }

  return material;
}

/**
 * 补充一次性预密钥（剩余量低于水位时）。
 * 池空不会导致失败，只是新会话退化为 3DH，少一层前向保密。
 */
export async function replenishOneTimeKeys(userId: string): Promise<number> {
  const material = loadKeyMaterial(userId);
  if (!material) return 0;

  const { remaining } = await fetchPreKeyCount();
  if (remaining >= OTK_LOW_WATER) return remaining;

  const fresh = generateOneTimePreKeys(material.nextOneTimeKeyId, OTK_BATCH);
  material.oneTimePreKeys.push(...fresh);
  material.nextOneTimeKeyId += OTK_BATCH;
  saveKeyMaterial(userId, material);

  const pub = buildPublicBundle(material.identity, material.signedPreKey);
  const res = await uploadKeys({
    identity_dh_public_key: toBase64(pub.identityDHPublicKey),
    identity_sign_public_key: toBase64(pub.identitySignPublicKey),
    signed_prekey_id: pub.signedPreKeyId,
    signed_prekey_public: toBase64(pub.signedPreKeyPublic),
    signed_prekey_signature: toBase64(pub.signedPreKeySignature),
    one_time_prekeys: fresh.map((k) => ({
      key_id: k.id,
      public_key: toBase64(k.keyPair.publicKey),
    })),
  });
  return res.one_time_prekeys_remaining;
}

/** 远端 bundle（snake_case base64）→ 协议层结构 */
function toProtocolBundle(remote: RemotePreKeyBundle): PublicPreKeyBundle {
  return {
    identityDHPublicKey: fromBase64(remote.identity_dh_public_key),
    identitySignPublicKey: fromBase64(remote.identity_sign_public_key),
    signedPreKeyId: remote.signed_prekey_id,
    signedPreKeyPublic: fromBase64(remote.signed_prekey_public),
    signedPreKeySignature: fromBase64(remote.signed_prekey_signature),
    oneTimePreKeyId: remote.one_time_prekey_id,
    oneTimePreKeyPublic: remote.one_time_prekey_public
      ? fromBase64(remote.one_time_prekey_public)
      : undefined,
  };
}

/** 首条消息需要附带的 X3DH 头（会话建立后不再发送） */
interface PendingX3DHHeader {
  identity_key: string;
  ephemeral_key: string;
  otk_id?: number;
}

/**
 * 待发首条消息的 X3DH 头缓存。
 *
 * 会话建立与首条消息发送是两步；头信息只对首条有效，
 * 发出后即清除（后续消息靠棘轮公钥推进，不需要重复 X3DH）。
 */
const pendingHeaders = new Map<string, PendingX3DHHeader>();

const headerCacheKey = (userId: string, peerId: string) => `${userId}|${peerId}`;

/**
 * 加密一条发给对端的文本。
 *
 * @returns null 表示无法加密（未启用 / 对方未启用），调用方发明文
 */
export async function encryptFor(
  userId: string,
  peerId: string,
  text: string,
): Promise<E2EEContent | null> {
  if (!isE2EEEnabled(userId)) return null;

  const material = loadKeyMaterial(userId);
  if (!material) return null;

  let session = loadSession(userId, peerId);

  // 首次给该对端发消息：取 bundle 做 X3DH
  if (!session) {
    const remote = await fetchPreKeyBundle(peerId);
    if (!remote) return null; // 对方未启用 E2EE → 降级明文

    const bundle = toProtocolBundle(remote);
    // initiateX3DH 内部验签，失败抛 InvalidBundleError（不静默降级：
    // 验签失败意味着可能有中间人，宁可发不出也不能降级明文）
    const x3dh = initiateX3DH(material.identity, bundle);
    session = initSessionAsSender(x3dh.sharedKey, bundle.signedPreKeyPublic);

    pendingHeaders.set(headerCacheKey(userId, peerId), {
      identity_key: toBase64(material.identity.dhKeyPair.publicKey),
      ephemeral_key: toBase64(x3dh.ephemeralPublicKey),
      otk_id: x3dh.usedOneTimePreKeyId,
    });
  }

  const msg = encryptMessage(session, utf8ToBytes(text));
  saveSession(userId, peerId, session);

  const cacheKey = headerCacheKey(userId, peerId);
  const header = pendingHeaders.get(cacheKey);
  pendingHeaders.delete(cacheKey);

  return {
    type: "e2ee",
    ratchet_key: msg.ratchetKey,
    n: msg.n,
    pn: msg.pn,
    nonce: msg.nonce,
    ciphertext: msg.ciphertext,
    ...(header ?? {}),
  };
}

/** 解密结果：明文，或失败原因（UI 需区分「等待密钥」与「彻底失败」） */
export type DecryptOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: "no-session" | "failed" };

/**
 * 解密收到的密文。
 *
 * 首条消息（带 identity_key/ephemeral_key）会就地完成 X3DH 建会话。
 */
export function decryptFrom(userId: string, peerId: string, content: E2EEContent): DecryptOutcome {
  const material = loadKeyMaterial(userId);
  if (!material) return { ok: false, reason: "no-session" };

  let session = loadSession(userId, peerId);

  // 对方发来首条消息：用其 identity + ephemeral 完成 X3DH
  if (!session) {
    if (!content.identity_key || !content.ephemeral_key) {
      // 没有会话又没有 X3DH 头 → 无从建立（可能是本地密钥被清过）
      return { ok: false, reason: "no-session" };
    }
    const usedOtk =
      content.otk_id !== undefined ? consumeOneTimePreKey(userId, content.otk_id) : undefined;
    const shared = respondX3DH(
      material.identity,
      material.signedPreKey,
      fromBase64(content.identity_key),
      fromBase64(content.ephemeral_key),
      usedOtk,
    );
    session = initSessionAsReceiver(shared, material.signedPreKey.keyPair);
  }

  const msg: RatchetMessage = {
    ratchetKey: content.ratchet_key,
    n: content.n,
    pn: content.pn,
    nonce: content.nonce,
    ciphertext: content.ciphertext,
  };

  try {
    const plaintext = decryptMessage(session, msg);
    saveSession(userId, peerId, session);
    return { ok: true, text: bytesToUtf8(plaintext) };
  } catch {
    // 失败不落盘（避免把坏状态固化）；重放/篡改/密钥不符都走这里
    return { ok: false, reason: "failed" };
  }
}

/** 当前账号是否已开启 E2EE */
export function isEnabled(userId: string): boolean {
  return isE2EEEnabled(userId);
}

/** 开启 E2EE：确保密钥就绪并上传公钥 */
export async function enableE2EE(userId: string): Promise<void> {
  await initE2EE(userId);
  setE2EEEnabled(userId, true);
}

/**
 * 关闭 E2EE。
 * 保留本地密钥与会话——否则已收的加密历史将永久无法解密。
 */
export function disableE2EE(userId: string): void {
  setE2EEEnabled(userId, false);
}

/** 与某对端是否已建立加密会话（UI 锁图标依据） */
export function hasSession(userId: string, peerId: string): boolean {
  return loadSession(userId, peerId) !== null;
}

/** 重置与某对端的会话（对方换设备导致无法解密时手动重建） */
export function resetSession(userId: string, peerId: string): void {
  deleteSession(userId, peerId);
  pendingHeaders.delete(headerCacheKey(userId, peerId));
}

/**
 * 计算与对端的安全指纹（60 位数字，两端应一致）。
 *
 * @returns null 表示尚未取到对端身份公钥
 */
export async function computeSafetyNumber(userId: string, peerId: string): Promise<string | null> {
  const material = loadKeyMaterial(userId);
  if (!material) return null;
  const remote = await fetchPreKeyBundle(peerId);
  if (!remote) return null;
  return safetyNumber(
    material.identity.dhKeyPair.publicKey,
    fromBase64(remote.identity_dh_public_key),
  );
}

/** 导出本机身份公钥（备份/展示用） */
export function myIdentityPublicKey(userId: string): string | null {
  const material = loadKeyMaterial(userId);
  return material ? toBase64(material.identity.dhKeyPair.publicKey) : null;
}

export type { SessionState };
