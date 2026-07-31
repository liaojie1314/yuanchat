/**
 * X3DH（Extended Triple Diffie-Hellman）初始密钥协商
 *
 * @description
 * 解决「首次给离线对方发消息」的密钥协商：接收方预先上传公钥 bundle
 * 到服务器，发送方取一份就能单方面算出共享密钥并立即发消息，
 * 无需对方在线。
 *
 * 密钥角色：
 * - **IK**（identity key）：长期身份密钥，代表「我是谁」
 * - **SPK**（signed prekey）：中期密钥，由 IK 的签名密钥签名以证明归属，
 *   定期轮换
 * - **OPK**（one-time prekey）：一次性密钥，服务端取走一个即删，
 *   提供额外的前向保密
 * - **EK**（ephemeral key）：发送方每次建会话新生成
 *
 * 共享密钥推导（发送方视角，3 或 4 个 DH）：
 *   DH1 = DH(IK_A, SPK_B)   身份 ←→ 中期，认证接收方
 *   DH2 = DH(EK_A, IK_B)    临时 ←→ 身份，认证发送方
 *   DH3 = DH(EK_A, SPK_B)   临时 ←→ 中期，前向保密
 *   DH4 = DH(EK_A, OPK_B)   临时 ←→ 一次性（OPK 存在时）
 *   SK  = HKDF(DH1 || DH2 || DH3 [|| DH4])
 *
 * 注意 X25519 与 Ed25519 密钥不可互换，故身份密钥同时持有两套：
 * dhKeyPair（X25519，参与 DH）与 signKeyPair（Ed25519，签 SPK）。
 */
import {
  type KeyPair,
  concatBytes,
  dh,
  generateDHKeyPair,
  generateSigningKeyPair,
  kdf,
  sign,
  verify,
  KEY_LEN,
} from "./primitives";

/** HKDF info 串：绑定协议用途，避免跨协议密钥复用 */
const X3DH_INFO = "YuanChat-X3DH-v1";
/** HKDF salt：32 字节零盐（Signal 规范做法，IKM 前置 0xFF 段已提供域分离） */
const ZERO_SALT = new Uint8Array(KEY_LEN);

/** 本机长期身份密钥（需持久化，丢失即无法解密历史） */
export interface IdentityKeyPair {
  /** X25519：参与 DH 计算 */
  dhKeyPair: KeyPair;
  /** Ed25519：给 signed prekey 签名 */
  signKeyPair: KeyPair;
}

/** 中期 signed prekey（定期轮换） */
export interface SignedPreKey {
  id: number;
  keyPair: KeyPair;
  /** 用 identity 的 Ed25519 私钥对 publicKey 的签名 */
  signature: Uint8Array;
}

/** 一次性 prekey */
export interface OneTimePreKey {
  id: number;
  keyPair: KeyPair;
}

/** 上传到服务器的公开 bundle（不含任何私钥） */
export interface PublicPreKeyBundle {
  identityDHPublicKey: Uint8Array;
  identitySignPublicKey: Uint8Array;
  signedPreKeyId: number;
  signedPreKeyPublic: Uint8Array;
  signedPreKeySignature: Uint8Array;
  /** 服务端每次分发取走一个；耗尽时为 undefined（协商降级为 3DH） */
  oneTimePreKeyId?: number;
  oneTimePreKeyPublic?: Uint8Array;
}

/** X3DH 协商结果 */
export interface X3DHResult {
  /** 32 字节共享密钥，作为 Double Ratchet 的初始 root key */
  sharedKey: Uint8Array;
  /** 发送方的一次性公钥，需随首条消息发给接收方 */
  ephemeralPublicKey: Uint8Array;
  /** 用掉的 OPK id，接收方据此找对应私钥 */
  usedOneTimePreKeyId?: number;
}

/** 生成长期身份密钥对 */
export function generateIdentityKeyPair(): IdentityKeyPair {
  return { dhKeyPair: generateDHKeyPair(), signKeyPair: generateSigningKeyPair() };
}

/** 生成并签名一个 signed prekey */
export function generateSignedPreKey(identity: IdentityKeyPair, id: number): SignedPreKey {
  const keyPair = generateDHKeyPair();
  return {
    id,
    keyPair,
    signature: sign(keyPair.publicKey, identity.signKeyPair.secretKey),
  };
}

/** 批量生成一次性 prekey（默认一批 100 个，用尽前需补充） */
export function generateOneTimePreKeys(startId: number, count: number): OneTimePreKey[] {
  const keys: OneTimePreKey[] = [];
  for (let i = 0; i < count; i++) {
    keys.push({ id: startId + i, keyPair: generateDHKeyPair() });
  }
  return keys;
}

/** 组装可上传的公开 bundle（此处不含 OPK，OPK 单独批量上传） */
export function buildPublicBundle(
  identity: IdentityKeyPair,
  signedPreKey: SignedPreKey,
): Omit<PublicPreKeyBundle, "oneTimePreKeyId" | "oneTimePreKeyPublic"> {
  return {
    identityDHPublicKey: identity.dhKeyPair.publicKey,
    identitySignPublicKey: identity.signKeyPair.publicKey,
    signedPreKeyId: signedPreKey.id,
    signedPreKeyPublic: signedPreKey.keyPair.publicKey,
    signedPreKeySignature: signedPreKey.signature,
  };
}

/** signed prekey 签名校验失败（服务器可能返回被篡改的 bundle） */
export class InvalidBundleError extends Error {
  constructor(message = "signed prekey signature verification failed") {
    super(message);
    this.name = "InvalidBundleError";
  }
}

/**
 * 发送方：用对方 bundle 计算共享密钥（主动建会话）。
 *
 * 先验 SPK 签名——这是唯一能挡住服务器伪造 bundle 做中间人的检查，
 * 失败必须中止而不能降级。
 */
export function initiateX3DH(
  myIdentity: IdentityKeyPair,
  theirBundle: PublicPreKeyBundle,
): X3DHResult {
  if (
    !verify(
      theirBundle.signedPreKeySignature,
      theirBundle.signedPreKeyPublic,
      theirBundle.identitySignPublicKey,
    )
  ) {
    throw new InvalidBundleError();
  }

  const ephemeral = generateDHKeyPair();

  const dh1 = dh(myIdentity.dhKeyPair.secretKey, theirBundle.signedPreKeyPublic);
  const dh2 = dh(ephemeral.secretKey, theirBundle.identityDHPublicKey);
  const dh3 = dh(ephemeral.secretKey, theirBundle.signedPreKeyPublic);

  const parts = [dh1, dh2, dh3];
  if (theirBundle.oneTimePreKeyPublic) {
    parts.push(dh(ephemeral.secretKey, theirBundle.oneTimePreKeyPublic));
  }

  return {
    sharedKey: kdf(concatBytes(...parts), ZERO_SALT, X3DH_INFO, KEY_LEN),
    ephemeralPublicKey: ephemeral.publicKey,
    usedOneTimePreKeyId: theirBundle.oneTimePreKeyId,
  };
}

/**
 * 接收方：收到首条消息后算出同一个共享密钥（被动建会话）。
 *
 * DH 对儿与发送方镜像对称：发送方的 DH(IK_A, SPK_B) 对应这里的
 * DH(SPK_B, IK_A)，X25519 交换律保证结果一致。
 *
 * @param usedOneTimePreKey 发送方用掉的 OPK 私钥；未用 OPK 时传 undefined，
 *   两侧都退化为 3DH，仍能得到一致结果
 */
export function respondX3DH(
  myIdentity: IdentityKeyPair,
  mySignedPreKey: SignedPreKey,
  theirIdentityDHPublicKey: Uint8Array,
  theirEphemeralPublicKey: Uint8Array,
  usedOneTimePreKey?: OneTimePreKey,
): Uint8Array {
  const dh1 = dh(mySignedPreKey.keyPair.secretKey, theirIdentityDHPublicKey);
  const dh2 = dh(myIdentity.dhKeyPair.secretKey, theirEphemeralPublicKey);
  const dh3 = dh(mySignedPreKey.keyPair.secretKey, theirEphemeralPublicKey);

  const parts = [dh1, dh2, dh3];
  if (usedOneTimePreKey) {
    parts.push(dh(usedOneTimePreKey.keyPair.secretKey, theirEphemeralPublicKey));
  }

  return kdf(concatBytes(...parts), ZERO_SALT, X3DH_INFO, KEY_LEN);
}
