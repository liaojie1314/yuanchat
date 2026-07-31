/**
 * E2EE 协议单测：X3DH 协商 + Double Ratchet 收发
 *
 * 覆盖重点是「协议组合层」的正确性（原语由 @noble 保证）：
 * 双向往返、棘轮推进、乱序、丢包、重放拒绝、篡改检测、前向保密、
 * OPK 耗尽降级、序列化恢复。
 */
import { describe, it, expect } from "vitest";
import {
  generateIdentityKeyPair,
  generateSignedPreKey,
  generateOneTimePreKeys,
  buildPublicBundle,
  initiateX3DH,
  respondX3DH,
  InvalidBundleError,
  type PublicPreKeyBundle,
} from "../crypto/x3dh";
import {
  initSessionAsSender,
  initSessionAsReceiver,
  encryptMessage,
  decryptMessage,
  serializeSession,
  deserializeSession,
  safetyNumber,
  DecryptError,
  TooManySkippedError,
  type SessionState,
  type RatchetMessage,
} from "../crypto/doubleRatchet";
import { utf8ToBytes, bytesToUtf8, toBase64 } from "../crypto/primitives";

/** 建好一对已完成 X3DH + 会话初始化的 Alice/Bob */
function setupPair(withOneTimeKey = true) {
  const aliceIdentity = generateIdentityKeyPair();
  const bobIdentity = generateIdentityKeyPair();
  const bobSPK = generateSignedPreKey(bobIdentity, 1);
  const bobOPKs = generateOneTimePreKeys(1, 2);

  const bundle: PublicPreKeyBundle = {
    ...buildPublicBundle(bobIdentity, bobSPK),
    ...(withOneTimeKey
      ? { oneTimePreKeyId: bobOPKs[0].id, oneTimePreKeyPublic: bobOPKs[0].keyPair.publicKey }
      : {}),
  };

  // Alice 主动建会话
  const x3dh = initiateX3DH(aliceIdentity, bundle);
  const alice = initSessionAsSender(x3dh.sharedKey, bobSPK.keyPair.publicKey);

  // Bob 收到首条消息头里的 identity/ephemeral 后算出同一密钥
  const bobShared = respondX3DH(
    bobIdentity,
    bobSPK,
    aliceIdentity.dhKeyPair.publicKey,
    x3dh.ephemeralPublicKey,
    withOneTimeKey ? bobOPKs[0] : undefined,
  );
  const bob = initSessionAsReceiver(bobShared, bobSPK.keyPair);

  return { alice, bob, aliceIdentity, bobIdentity, bobSPK, bobOPKs, x3dh, bundle };
}

const say = (s: SessionState, text: string) => encryptMessage(s, utf8ToBytes(text));
const hear = (s: SessionState, m: RatchetMessage) => bytesToUtf8(decryptMessage(s, m));

describe("X3DH", () => {
  it("双方推导出相同的共享密钥（4DH，含一次性预密钥）", () => {
    const { aliceIdentity, bobIdentity, bobSPK, bobOPKs, bundle } = setupPair(true);
    const x3dh = initiateX3DH(aliceIdentity, bundle);
    const bobShared = respondX3DH(
      bobIdentity,
      bobSPK,
      aliceIdentity.dhKeyPair.publicKey,
      x3dh.ephemeralPublicKey,
      bobOPKs[0],
    );
    expect(toBase64(bobShared)).toBe(toBase64(x3dh.sharedKey));
    expect(x3dh.usedOneTimePreKeyId).toBe(bobOPKs[0].id);
  });

  it("一次性预密钥耗尽时降级为 3DH，双方仍一致", () => {
    const aliceIdentity = generateIdentityKeyPair();
    const bobIdentity = generateIdentityKeyPair();
    const bobSPK = generateSignedPreKey(bobIdentity, 1);
    const bundle = buildPublicBundle(bobIdentity, bobSPK) as PublicPreKeyBundle;

    const x3dh = initiateX3DH(aliceIdentity, bundle);
    const bobShared = respondX3DH(
      bobIdentity,
      bobSPK,
      aliceIdentity.dhKeyPair.publicKey,
      x3dh.ephemeralPublicKey,
      undefined,
    );
    expect(toBase64(bobShared)).toBe(toBase64(x3dh.sharedKey));
    expect(x3dh.usedOneTimePreKeyId).toBeUndefined();
  });

  it("signed prekey 签名被篡改时拒绝建会话（挡服务器中间人）", () => {
    const aliceIdentity = generateIdentityKeyPair();
    const bobIdentity = generateIdentityKeyPair();
    const bobSPK = generateSignedPreKey(bobIdentity, 1);
    const bundle = buildPublicBundle(bobIdentity, bobSPK) as PublicPreKeyBundle;

    // 攻击者替换 SPK 公钥为自己的，但无法伪造 Bob 的签名
    const evil = generateSignedPreKey(generateIdentityKeyPair(), 1);
    const tampered = { ...bundle, signedPreKeyPublic: evil.keyPair.publicKey };

    expect(() => initiateX3DH(aliceIdentity, tampered)).toThrow(InvalidBundleError);
  });

  it("不同会话的共享密钥互不相同（ephemeral 保证）", () => {
    const { aliceIdentity, bundle } = setupPair(true);
    const a = initiateX3DH(aliceIdentity, bundle);
    const b = initiateX3DH(aliceIdentity, bundle);
    expect(toBase64(a.sharedKey)).not.toBe(toBase64(b.sharedKey));
  });
});

describe("Double Ratchet — 基本收发", () => {
  it("Alice → Bob 单条消息往返", () => {
    const { alice, bob } = setupPair();
    const msg = say(alice, "你好 Bob");
    expect(hear(bob, msg)).toBe("你好 Bob");
  });

  it("连续多条消息按序解密", () => {
    const { alice, bob } = setupPair();
    for (let i = 0; i < 5; i++) {
      expect(hear(bob, say(alice, `msg-${i}`))).toBe(`msg-${i}`);
    }
  });

  it("双向对话触发 DH 棘轮，双方持续可解", () => {
    const { alice, bob } = setupPair();

    expect(hear(bob, say(alice, "A1"))).toBe("A1");
    // Bob 回消息 → 用上一步棘轮出的新发送链
    expect(hear(alice, say(bob, "B1"))).toBe("B1");
    expect(hear(bob, say(alice, "A2"))).toBe("A2");
    expect(hear(alice, say(bob, "B2"))).toBe("B2");
    expect(hear(bob, say(alice, "A3"))).toBe("A3");
  });

  it("每条消息使用不同密钥（同一明文产出不同密文）", () => {
    const { alice, bob } = setupPair();
    const m1 = say(alice, "same");
    const m2 = say(alice, "same");
    expect(m1.ciphertext).not.toBe(m2.ciphertext);
    expect(hear(bob, m1)).toBe("same");
    expect(hear(bob, m2)).toBe("same");
  });
});

describe("Double Ratchet — 乱序与丢包", () => {
  it("乱序到达：后发先至，先发的迟到仍可解密", () => {
    const { alice, bob } = setupPair();
    const m1 = say(alice, "first");
    const m2 = say(alice, "second");
    const m3 = say(alice, "third");

    // 先收第三条（跳过 1、2）
    expect(hear(bob, m3)).toBe("third");
    // 迟到的前两条走跳过密钥缓存
    expect(hear(bob, m1)).toBe("first");
    expect(hear(bob, m2)).toBe("second");
  });

  it("跨棘轮乱序：上一链的迟到消息在棘轮切换后仍可解密", () => {
    const { alice, bob } = setupPair();

    const a1 = say(alice, "A1");
    const a2 = say(alice, "A2");
    expect(hear(bob, a1)).toBe("A1"); // a2 暂不投递

    // Bob 回消息触发棘轮，Alice 换链
    const b1 = say(bob, "B1");
    expect(hear(alice, b1)).toBe("B1");
    const a3 = say(alice, "A3"); // 新链，pn=2
    expect(hear(bob, a3)).toBe("A3");

    // 旧链的 a2 现在才到
    expect(hear(bob, a2)).toBe("A2");
  });

  it("永久丢包不影响后续消息", () => {
    const { alice, bob } = setupPair();
    say(alice, "lost-forever"); // 不投递
    expect(hear(bob, say(alice, "after"))).toBe("after");
  });
});

describe("Double Ratchet — 安全属性", () => {
  it("重放同一条消息被拒绝（密钥用后即弃）", () => {
    const { alice, bob } = setupPair();
    const msg = say(alice, "once");
    expect(hear(bob, msg)).toBe("once");
    expect(() => decryptMessage(bob, msg)).toThrow(DecryptError);
  });

  it("缓存中的迟到消息也只能用一次", () => {
    const { alice, bob } = setupPair();
    const m1 = say(alice, "one");
    const m2 = say(alice, "two");
    hear(bob, m2); // m1 进缓存
    expect(hear(bob, m1)).toBe("one");
    expect(() => decryptMessage(bob, m1)).toThrow(DecryptError);
  });

  it("篡改密文被认证标签检出", () => {
    const { alice, bob } = setupPair();
    const msg = say(alice, "authentic");
    const bad = { ...msg, ciphertext: toBase64(new Uint8Array(32).fill(9)) };
    expect(() => decryptMessage(bob, bad)).toThrow(DecryptError);
  });

  it("篡改消息头（序号）被 AAD 绑定检出", () => {
    const { alice, bob } = setupPair();
    const m1 = say(alice, "one");
    const m2 = say(alice, "two");
    // 把第二条的序号改成 0 冒充第一条：AAD 不符 → 解密失败
    expect(() => decryptMessage(bob, { ...m2, n: m1.n })).toThrow(DecryptError);
  });

  it("前向保密：泄露当前链密钥无法解密已收的历史消息", () => {
    const { alice, bob } = setupPair();
    const old = say(alice, "history");
    hear(bob, old);

    // 用「当前」状态（链已前进）重放历史消息必失败
    expect(() => decryptMessage(bob, old)).toThrow(DecryptError);
  });

  it("陌生棘轮公钥的消息无法解密（非本会话对端）", () => {
    const { alice } = setupPair();
    const other = setupPair();
    const foreign = say(other.alice, "not for you");
    expect(() => decryptMessage(alice, foreign)).toThrow();
  });

  it("序号跳跃过大时拒绝（防内存耗尽）", () => {
    const { alice, bob } = setupPair();
    const msg = say(alice, "x");
    expect(() => decryptMessage(bob, { ...msg, n: 100000 })).toThrow(TooManySkippedError);
  });
});

describe("会话持久化", () => {
  it("序列化 → 反序列化后可继续收发", () => {
    const { alice, bob } = setupPair();
    expect(hear(bob, say(alice, "before"))).toBe("before");

    const restoredBob = deserializeSession(JSON.parse(JSON.stringify(serializeSession(bob))));
    expect(hear(restoredBob, say(alice, "after restore"))).toBe("after restore");
  });

  it("恢复后跳过密钥缓存仍可用（乱序容忍跨重启）", () => {
    const { alice, bob } = setupPair();
    const m1 = say(alice, "one");
    const m2 = say(alice, "two");
    hear(bob, m2); // m1 进缓存

    const restored = deserializeSession(JSON.parse(JSON.stringify(serializeSession(bob))));
    expect(hear(restored, m1)).toBe("one");
  });
});

describe("安全指纹（safety number）", () => {
  it("双方算出同一指纹（顺序无关）", () => {
    const a = generateIdentityKeyPair();
    const b = generateIdentityKeyPair();
    const fromA = safetyNumber(a.dhKeyPair.publicKey, b.dhKeyPair.publicKey);
    const fromB = safetyNumber(b.dhKeyPair.publicKey, a.dhKeyPair.publicKey);
    expect(fromA).toBe(fromB);
    expect(fromA).toMatch(/^\d{60}$/);
  });

  it("身份密钥变化时指纹随之变化（可察觉中间人）", () => {
    const a = generateIdentityKeyPair();
    const b = generateIdentityKeyPair();
    const evil = generateIdentityKeyPair();
    expect(safetyNumber(a.dhKeyPair.publicKey, b.dhKeyPair.publicKey)).not.toBe(
      safetyNumber(a.dhKeyPair.publicKey, evil.dhKeyPair.publicKey),
    );
  });
});
