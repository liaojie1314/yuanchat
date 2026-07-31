/**
 * Double Ratchet 会话（Signal 协议的消息密钥棘轮）
 *
 * @description
 * 在 X3DH 协商出的共享密钥之上，维护「每条消息一把新密钥」：
 *
 * - **对称棘轮**：每发/收一条消息，链密钥 CK 前进一格派生出消息密钥 MK，
 *   CK 不可回退 → 泄露当前密钥无法解密历史消息（前向保密）
 * - **DH 棘轮**：对方回消息时带上新的棘轮公钥，双方做一次 DH 刷新 root key，
 *   由此重置收发链 → 泄露当前密钥也无法解密未来消息（后向安全/自愈）
 *
 * 乱序与丢包：消息头带 (棘轮公钥, 链内序号 N, 上一条链长度 PN)。
 * 收到超前消息时把中间跳过的消息密钥缓存进 skipped，之后迟到的消息
 * 仍可解密；缓存有上限防内存耗尽攻击。
 *
 * 重放：消息密钥用后即从缓存删除，同一条消息第二次解密必定失败。
 *
 * 本模块只处理密码学状态，不涉及网络/存储；序列化交由 serializeSession
 * 供上层持久化（IndexedDB / SQLite）。
 */
import {
  type KeyPair,
  concatBytes,
  decrypt,
  dh,
  encrypt,
  fromBase64,
  generateDHKeyPair,
  kdf,
  toBase64,
  utf8ToBytes,
  KEY_LEN,
} from "./primitives";

const ROOT_INFO = "YuanChat-DR-Root-v1";
const CHAIN_INFO = "YuanChat-DR-Chain-v1";
const MSG_INFO = "YuanChat-DR-Msg-v1";
const ZERO_SALT = new Uint8Array(KEY_LEN);

/**
 * 跳过密钥缓存上限。
 * 防御：攻击者伪造巨大 N 迫使我们派生海量密钥耗尽内存。
 */
export const MAX_SKIP = 1000;

/** 单条消息的密文与头部 */
export interface RatchetMessage {
  /** 发送方当前棘轮公钥（base64） */
  ratchetKey: string;
  /** 本条在当前发送链中的序号（从 0 起） */
  n: number;
  /** 切换棘轮前上一条发送链的长度，供接收方补齐跳过的密钥 */
  pn: number;
  nonce: string;
  ciphertext: string;
}

/** 跳过消息密钥的缓存键：棘轮公钥 + 序号 */
function skipKey(ratchetKeyB64: string, n: number): string {
  return `${ratchetKeyB64}|${n}`;
}

/** 会话状态（可序列化持久化） */
export interface SessionState {
  /** 根密钥：每次 DH 棘轮更新 */
  rootKey: Uint8Array;
  /** 我方当前棘轮密钥对 */
  sending: KeyPair;
  /** 对方最新棘轮公钥（首条消息发出前可能未知） */
  receivingKey?: Uint8Array;
  /** 发送链密钥 */
  sendChainKey?: Uint8Array;
  /** 接收链密钥 */
  recvChainKey?: Uint8Array;
  /** 发送链已发条数 */
  ns: number;
  /** 接收链已收条数 */
  nr: number;
  /** 切换棘轮前的发送链长度 */
  pn: number;
  /** 跳过（乱序未达）的消息密钥缓存 */
  skipped: Map<string, Uint8Array>;
}

/** 解密失败：密钥不匹配、消息被篡改，或重放（密钥已用掉） */
export class DecryptError extends Error {
  constructor(message = "message decryption failed") {
    super(message);
    this.name = "DecryptError";
  }
}

/** 跳过消息数超限：疑似伪造头部的内存耗尽攻击 */
export class TooManySkippedError extends Error {
  constructor(message = "too many skipped messages") {
    super(message);
    this.name = "TooManySkippedError";
  }
}

/** root key + DH 输出 → 新 root key 与新链密钥 */
function ratchetRoot(
  rootKey: Uint8Array,
  dhOut: Uint8Array,
): { rootKey: Uint8Array; chainKey: Uint8Array } {
  const okm = kdf(dhOut, rootKey, ROOT_INFO, KEY_LEN * 2);
  return { rootKey: okm.slice(0, KEY_LEN), chainKey: okm.slice(KEY_LEN) };
}

/** 链密钥前进一格：返回下一个链密钥与本条消息密钥 */
function ratchetChain(chainKey: Uint8Array): {
  nextChainKey: Uint8Array;
  messageKey: Uint8Array;
} {
  return {
    nextChainKey: kdf(chainKey, ZERO_SALT, CHAIN_INFO, KEY_LEN),
    messageKey: kdf(chainKey, ZERO_SALT, MSG_INFO, KEY_LEN),
  };
}

/**
 * 发起方初始化会话（X3DH 之后立即可发消息）。
 *
 * @param sharedKey X3DH 协商出的共享密钥
 * @param theirSignedPreKeyPublic 对方 SPK 公钥，作为对方的初始棘轮公钥
 */
export function initSessionAsSender(
  sharedKey: Uint8Array,
  theirSignedPreKeyPublic: Uint8Array,
): SessionState {
  const sending = generateDHKeyPair();
  const { rootKey, chainKey } = ratchetRoot(
    sharedKey,
    dh(sending.secretKey, theirSignedPreKeyPublic),
  );
  return {
    rootKey,
    sending,
    receivingKey: theirSignedPreKeyPublic,
    sendChainKey: chainKey,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: new Map(),
  };
}

/**
 * 接收方初始化会话。
 *
 * 此时还不知道对方棘轮公钥（要等首条消息），发送链留空；
 * 我方棘轮密钥对就是自己的 SPK（发起方正是用它算的 DH）。
 */
export function initSessionAsReceiver(
  sharedKey: Uint8Array,
  mySignedPreKeyPair: KeyPair,
): SessionState {
  return {
    rootKey: sharedKey,
    sending: mySignedPreKeyPair,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: new Map(),
  };
}

/** 头部作为 AAD 绑定进 GCM，篡改 n/pn/棘轮公钥会导致解密失败 */
function headerAAD(ratchetKey: string, n: number, pn: number): Uint8Array {
  return utf8ToBytes(`${ratchetKey}.${n}.${pn}`);
}

/** 加密一条消息（就地推进发送链） */
export function encryptMessage(state: SessionState, plaintext: Uint8Array): RatchetMessage {
  if (!state.sendChainKey) {
    throw new DecryptError("sending chain not initialized: no message received yet");
  }
  const { nextChainKey, messageKey } = ratchetChain(state.sendChainKey);
  state.sendChainKey = nextChainKey;

  const ratchetKey = toBase64(state.sending.publicKey);
  const n = state.ns;
  state.ns += 1;

  const { nonce, ciphertext } = encrypt(messageKey, plaintext, headerAAD(ratchetKey, n, state.pn));

  return {
    ratchetKey,
    n,
    pn: state.pn,
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
}

/** 把 [nr, until) 区间的消息密钥存进跳过缓存（乱序补偿） */
function skipMessageKeys(state: SessionState, until: number, ratchetKeyB64: string): void {
  if (!state.recvChainKey) return;
  if (until - state.nr > MAX_SKIP) {
    throw new TooManySkippedError();
  }
  while (state.nr < until) {
    const { nextChainKey, messageKey } = ratchetChain(state.recvChainKey);
    state.recvChainKey = nextChainKey;
    state.skipped.set(skipKey(ratchetKeyB64, state.nr), messageKey);
    state.nr += 1;
  }
  // 缓存总量兜底：超限时丢弃最旧的（Map 保持插入序）
  while (state.skipped.size > MAX_SKIP) {
    const oldest = state.skipped.keys().next().value;
    if (oldest === undefined) break;
    state.skipped.delete(oldest);
  }
}

/** 执行一次 DH 棘轮：对方换了棘轮公钥，重置收发链 */
function dhRatchet(state: SessionState, theirRatchetKey: Uint8Array): void {
  // 先结算旧接收链：把对方声明的上一条链剩余密钥补进缓存
  state.pn = state.ns;
  state.ns = 0;
  state.nr = 0;
  state.receivingKey = theirRatchetKey;

  // 用现有私钥与对方新公钥刷新接收链
  const recv = ratchetRoot(state.rootKey, dh(state.sending.secretKey, theirRatchetKey));
  state.rootKey = recv.rootKey;
  state.recvChainKey = recv.chainKey;

  // 换我方棘轮密钥并刷新发送链（下一条发出的消息即用新公钥）
  state.sending = generateDHKeyPair();
  const send = ratchetRoot(state.rootKey, dh(state.sending.secretKey, theirRatchetKey));
  state.rootKey = send.rootKey;
  state.sendChainKey = send.chainKey;
}

/**
 * 解密一条消息（按需触发 DH 棘轮，处理乱序与重放）。
 *
 * @throws DecryptError 密钥不符/被篡改/重放
 * @throws TooManySkippedError 头部声明的序号跳跃过大
 */
export function decryptMessage(state: SessionState, msg: RatchetMessage): Uint8Array {
  const aad = headerAAD(msg.ratchetKey, msg.n, msg.pn);
  const nonce = fromBase64(msg.nonce);
  const ciphertext = fromBase64(msg.ciphertext);

  // 1) 迟到消息：密钥已在跳过缓存里，用完即删（同一条消息无法二次解密）
  const cacheKey = skipKey(msg.ratchetKey, msg.n);
  const cached = state.skipped.get(cacheKey);
  if (cached) {
    state.skipped.delete(cacheKey);
    try {
      return decrypt(cached, nonce, ciphertext, aad);
    } catch {
      throw new DecryptError();
    }
  }

  const theirKey = fromBase64(msg.ratchetKey);
  const isNewRatchet = !state.receivingKey || toBase64(state.receivingKey) !== msg.ratchetKey;

  // 2) 对方换了棘轮公钥：先补齐旧链剩余密钥，再执行 DH 棘轮
  if (isNewRatchet) {
    if (state.recvChainKey && state.receivingKey) {
      skipMessageKeys(state, msg.pn, toBase64(state.receivingKey));
    }
    dhRatchet(state, theirKey);
  }

  if (!state.recvChainKey) {
    throw new DecryptError("receiving chain not initialized");
  }

  // 3) 同链内超前消息：中间的存缓存
  if (msg.n > state.nr) {
    skipMessageKeys(state, msg.n, msg.ratchetKey);
  } else if (msg.n < state.nr) {
    // 序号已过且不在缓存 → 重放或已处理过
    throw new DecryptError("message key already used (replay?)");
  }

  const { nextChainKey, messageKey } = ratchetChain(state.recvChainKey);
  state.recvChainKey = nextChainKey;
  state.nr += 1;

  try {
    return decrypt(messageKey, nonce, ciphertext, aad);
  } catch {
    throw new DecryptError();
  }
}

// ---------- 持久化 ----------

/** 序列化后的会话（JSON 安全，base64 编码字节字段） */
export interface SerializedSession {
  rootKey: string;
  sendingPub: string;
  sendingSec: string;
  receivingKey?: string;
  sendChainKey?: string;
  recvChainKey?: string;
  ns: number;
  nr: number;
  pn: number;
  skipped: Array<[string, string]>;
}

export function serializeSession(state: SessionState): SerializedSession {
  return {
    rootKey: toBase64(state.rootKey),
    sendingPub: toBase64(state.sending.publicKey),
    sendingSec: toBase64(state.sending.secretKey),
    receivingKey: state.receivingKey ? toBase64(state.receivingKey) : undefined,
    sendChainKey: state.sendChainKey ? toBase64(state.sendChainKey) : undefined,
    recvChainKey: state.recvChainKey ? toBase64(state.recvChainKey) : undefined,
    ns: state.ns,
    nr: state.nr,
    pn: state.pn,
    skipped: Array.from(state.skipped.entries()).map(([k, v]) => [k, toBase64(v)]),
  };
}

export function deserializeSession(data: SerializedSession): SessionState {
  return {
    rootKey: fromBase64(data.rootKey),
    sending: {
      publicKey: fromBase64(data.sendingPub),
      secretKey: fromBase64(data.sendingSec),
    },
    receivingKey: data.receivingKey ? fromBase64(data.receivingKey) : undefined,
    sendChainKey: data.sendChainKey ? fromBase64(data.sendChainKey) : undefined,
    recvChainKey: data.recvChainKey ? fromBase64(data.recvChainKey) : undefined,
    ns: data.ns,
    nr: data.nr,
    pn: data.pn,
    skipped: new Map(data.skipped.map(([k, v]) => [k, fromBase64(v)])),
  };
}

/** 安全指纹：身份公钥 → Signal 风格 60 位十进制数字串（分 12 组×5 位） */
export function safetyNumber(myIdentityPub: Uint8Array, theirIdentityPub: Uint8Array): string {
  // 双方拼接顺序固定（字典序），保证两端算出同一串
  const a = toBase64(myIdentityPub);
  const b = toBase64(theirIdentityPub);
  const [first, second] =
    a < b ? [myIdentityPub, theirIdentityPub] : [theirIdentityPub, myIdentityPub];
  const digest = kdf(concatBytes(first, second), ZERO_SALT, "YuanChat-SafetyNumber-v1", 30);

  let out = "";
  for (let i = 0; i < 30; i += 1) {
    // 每字节映射到 2 位十进制，共 60 位
    out += String(digest[i] % 100).padStart(2, "0");
  }
  return out;
}
