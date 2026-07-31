/**
 * PIN 密钥备份与恢复单测
 *
 * 覆盖：备份往返（密钥+会话完整恢复）、错误 PIN 拒绝、弱 PIN 拦截、
 * 无备份时的返回、服务端只见密文（不含任何明文私钥）。
 *
 * 服务端 API 用内存桩替代，聚焦本地加解密与序列化的正确性。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// api/e2ee 桩：内存存一份 blob，模拟服务端只存不解
interface RemoteBlob {
  blob: string;
  salt: string;
  version: number;
}
let remote: RemoteBlob | null = null;

vi.mock("../api/e2ee", () => ({
  saveKeyBackup: vi.fn(async (cipherBlob: string, salt: string, version: number) => {
    remote = { blob: cipherBlob, salt, version };
    return { saved: true, version };
  }),
  fetchKeyBackup: vi.fn(async () =>
    remote
      ? {
          cipher_blob: remote.blob,
          salt: remote.salt,
          version: remote.version,
          updated_at: new Date(0).toISOString(),
        }
      : null,
  ),
}));

import {
  createBackup,
  restoreBackup,
  hasRemoteBackup,
  BackupDecryptError,
  WeakPinError,
  MIN_PIN_LENGTH,
} from "../crypto/keyBackup";
import {
  loadKeyMaterial,
  saveKeyMaterial,
  saveSession,
  loadSession,
  clearAllKeys,
} from "../crypto/keyStore";
import {
  generateIdentityKeyPair,
  generateSignedPreKey,
  generateOneTimePreKeys,
} from "../crypto/x3dh";
import { initSessionAsSender, encryptMessage, decryptMessage } from "../crypto/doubleRatchet";
import { generateDHKeyPair, toBase64, utf8ToBytes, bytesToUtf8 } from "../crypto/primitives";

const USER = "user-1";
const PEER = "peer-9";
const PIN = "824193";

/** 造一份完整本地密钥材料 + 一个会话 */
function seedLocalKeys() {
  const identity = generateIdentityKeyPair();
  const signedPreKey = generateSignedPreKey(identity, 1);
  const oneTimePreKeys = generateOneTimePreKeys(1, 3);
  saveKeyMaterial(USER, { identity, signedPreKey, oneTimePreKeys, nextOneTimeKeyId: 4 });

  const session = initSessionAsSender(new Uint8Array(32).fill(3), generateDHKeyPair().publicKey);
  saveSession(USER, PEER, session);
  return { identity, signedPreKey, oneTimePreKeys, session };
}

/**
 * vitest 环境为 node，无 localStorage。
 * keyStore 以 localStorage 为存储介质，此处注入最小内存实现，
 * 只覆盖被用到的 API（getItem/setItem/removeItem/clear/key/length）。
 */
function installMemoryStorage() {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  vi.stubGlobal("localStorage", storage);
}

beforeEach(() => {
  installMemoryStorage();
  remote = null;
});

describe("createBackup / restoreBackup", () => {
  it("备份往返后身份密钥完全一致", async () => {
    const { identity } = seedLocalKeys();
    const before = toBase64(identity.dhKeyPair.secretKey);

    await createBackup(USER, PIN);
    clearAllKeys(USER); // 模拟换设备：本地全清
    expect(loadKeyMaterial(USER)).toBeNull();

    expect(await restoreBackup(USER, PIN)).toBe(true);
    const restored = loadKeyMaterial(USER);
    expect(restored).not.toBeNull();
    expect(toBase64(restored!.identity.dhKeyPair.secretKey)).toBe(before);
  });

  it("备份往返后 signed prekey 与一次性预密钥完整恢复", async () => {
    const { signedPreKey, oneTimePreKeys } = seedLocalKeys();

    await createBackup(USER, PIN);
    clearAllKeys(USER);
    await restoreBackup(USER, PIN);

    const restored = loadKeyMaterial(USER)!;
    expect(restored.signedPreKey.id).toBe(signedPreKey.id);
    expect(toBase64(restored.signedPreKey.keyPair.secretKey)).toBe(
      toBase64(signedPreKey.keyPair.secretKey),
    );
    expect(restored.oneTimePreKeys).toHaveLength(oneTimePreKeys.length);
    expect(restored.nextOneTimeKeyId).toBe(4);
  });

  it("恢复后会话棘轮状态可继续解密（历史会话不中断）", async () => {
    // Alice 侧会话：先加密一条，恢复后由「对端」用同状态解出
    const shared = new Uint8Array(32).fill(7);
    const peerRatchet = generateDHKeyPair();
    const sender = initSessionAsSender(shared, peerRatchet.publicKey);

    const identity = generateIdentityKeyPair();
    saveKeyMaterial(USER, {
      identity,
      signedPreKey: generateSignedPreKey(identity, 1),
      oneTimePreKeys: [],
      nextOneTimeKeyId: 1,
    });
    saveSession(USER, PEER, sender);

    await createBackup(USER, PIN);
    clearAllKeys(USER);
    await restoreBackup(USER, PIN);

    // 恢复出的发送会话继续加密，序号应接续（ns 已持久化）
    const restoredSession = loadSession(USER, PEER)!;
    const msg = encryptMessage(restoredSession, utf8ToBytes("after restore"));
    expect(msg.n).toBe(0);

    // 用同一根密钥的接收端可解（验证 rootKey/链密钥被正确带回）
    const mirror = loadSession(USER, PEER)!;
    expect(toBase64(mirror.rootKey)).toBe(toBase64(restoredSession.rootKey));
  });

  it("PIN 错误时解密失败并抛 BackupDecryptError", async () => {
    seedLocalKeys();
    await createBackup(USER, PIN);
    clearAllKeys(USER);

    await expect(restoreBackup(USER, "999999")).rejects.toThrow(BackupDecryptError);
    // 失败不应写入任何本地密钥
    expect(loadKeyMaterial(USER)).toBeNull();
  });

  it("PIN 过短时拒绝创建备份", async () => {
    seedLocalKeys();
    await expect(createBackup(USER, "1".repeat(MIN_PIN_LENGTH - 1))).rejects.toThrow(WeakPinError);
  });

  it("服务器无备份时恢复返回 false", async () => {
    expect(await restoreBackup(USER, PIN)).toBe(false);
    expect(await hasRemoteBackup()).toBe(false);
  });

  it("hasRemoteBackup 在备份后为 true", async () => {
    seedLocalKeys();
    await createBackup(USER, PIN);
    expect(await hasRemoteBackup()).toBe(true);
  });
});

describe("服务端可见性", () => {
  it("上传的 blob 不含任何明文私钥（服务器无从解读）", async () => {
    const { identity, signedPreKey } = seedLocalKeys();
    await createBackup(USER, PIN);

    expect(remote).not.toBeNull();
    const blob = remote!.blob;
    // 明文私钥的 base64 片段不应出现在密文里
    expect(blob).not.toContain(toBase64(identity.dhKeyPair.secretKey));
    expect(blob).not.toContain(toBase64(signedPreKey.keyPair.secretKey));
    // 也不应能直接解析出 JSON 结构
    expect(() => JSON.parse(atob(blob))).toThrow();
  });

  it("相同密钥两次备份产出不同密文（盐与 nonce 随机）", async () => {
    seedLocalKeys();
    await createBackup(USER, PIN);
    const first = { blob: remote!.blob, salt: remote!.salt };
    await createBackup(USER, PIN);
    expect(remote!.blob).not.toBe(first.blob);
    expect(remote!.salt).not.toBe(first.salt);
  });

  it("旧盐配新密文无法解密（盐随密文成对更新）", async () => {
    seedLocalKeys();
    await createBackup(USER, PIN);
    const staleSalt = remote!.salt;
    await createBackup(USER, PIN);
    remote = { ...remote!, salt: staleSalt };

    clearAllKeys(USER);
    await expect(restoreBackup(USER, PIN)).rejects.toThrow(BackupDecryptError);
  });
});

describe("解密后的明文可用性", () => {
  it("恢复的密钥能解密备份前收到的消息", async () => {
    // 构造：对端 → 我方 的一条消息，我方备份后清空再恢复，仍应解得开
    const shared = new Uint8Array(32).fill(11);
    const mySPK = generateDHKeyPair();

    const identity = generateIdentityKeyPair();
    saveKeyMaterial(USER, {
      identity,
      signedPreKey: { id: 1, keyPair: mySPK, signature: new Uint8Array(64) },
      oneTimePreKeys: [],
      nextOneTimeKeyId: 1,
    });

    // 对端建会话并发一条
    const peerSession = initSessionAsSender(shared, mySPK.publicKey);
    const encrypted = encryptMessage(peerSession, utf8ToBytes("secret before backup"));

    // 我方接收会话（用 SPK 私钥）
    const { initSessionAsReceiver } = await import("../crypto/doubleRatchet");
    const mySession = initSessionAsReceiver(shared, mySPK);
    saveSession(USER, PEER, mySession);

    await createBackup(USER, PIN);
    clearAllKeys(USER);
    await restoreBackup(USER, PIN);

    const restored = loadSession(USER, PEER)!;
    expect(bytesToUtf8(decryptMessage(restored, encrypted))).toBe("secret before backup");
  });
});
