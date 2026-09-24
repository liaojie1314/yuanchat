import { describe, it, expect } from "vitest";
import {
  validatePassword,
  validateYuanchatId,
  validatePhone,
  validateNickname,
} from "../utils/validation";

describe("validatePassword", () => {
  it("accepts a valid password", () => {
    expect(validatePassword("Abc1234!").valid).toBe(true);
  });

  it("rejects password shorter than 8 characters", () => {
    const r = validatePassword("Ab1!");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.passwordMinLength");
  });

  it("rejects password without uppercase letter", () => {
    const r = validatePassword("abc1234!");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.passwordUppercase");
  });

  it("rejects password without lowercase letter", () => {
    const r = validatePassword("ABC1234!");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.passwordLowercase");
  });

  it("rejects password without digit", () => {
    const r = validatePassword("Abcdefg!");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.passwordDigit");
  });

  it("accepts a password without special character", () => {
    const r = validatePassword("Abcdef12");
    expect(r.valid).toBe(true);
    expect(r.errors).not.toContain("validation.passwordSpecial");
  });

  it("accepts a password of exactly 8 bytes", () => {
    expect(validatePassword("Abcdefg1").valid).toBe(true);
  });

  it("accepts a password of exactly 64 bytes", () => {
    const pw = "Aa1".repeat(21) + "A";
    expect(new TextEncoder().encode(pw).length).toBe(64);
    expect(validatePassword(pw).valid).toBe(true);
  });

  it("rejects a password of 65 bytes", () => {
    const pw = "Aa1".repeat(21) + "Aa";
    expect(new TextEncoder().encode(pw).length).toBe(65);
    const r = validatePassword(pw);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.passwordMaxLength");
  });

  it("measures length in bytes, not UTF-16 code units", () => {
    // 22 个汉字 = 22 个字符但 66 字节，按字符算会放行、被 bcrypt 静默截断
    const pw = "密".repeat(22);
    expect(pw.length).toBe(22);
    expect(new TextEncoder().encode(pw).length).toBe(66);
    expect(validatePassword(pw).errors).toContain("validation.passwordMaxLength");
  });

  it("accepts a multi-byte password within 64 bytes", () => {
    const pw = "Aa1" + "密码密码";
    expect(new TextEncoder().encode(pw).length).toBe(15);
    expect(validatePassword(pw).valid).toBe(true);
  });

  it("rejects password containing a space", () => {
    const r = validatePassword("Abcdef 12");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.passwordNoWhitespace");
  });

  it("rejects password containing a tab", () => {
    expect(validatePassword("Abcdef\t12").errors).toContain("validation.passwordNoWhitespace");
  });

  it("rejects password containing a newline", () => {
    expect(validatePassword("Abcdef\n12").errors).toContain("validation.passwordNoWhitespace");
  });

  it("returns multiple errors for a weak password", () => {
    const r = validatePassword("abc");
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(1);
  });
});

describe("validateYuanchatId", () => {
  it("accepts a valid yuanchat id", () => {
    expect(validateYuanchatId("john_doe").valid).toBe(true);
  });

  it("accepts id with digits", () => {
    expect(validateYuanchatId("user123").valid).toBe(true);
  });

  it("rejects id shorter than 3 characters", () => {
    const r = validateYuanchatId("ab");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.idMinLength");
  });

  it("rejects id with special characters", () => {
    const r = validateYuanchatId("user@name");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.idCharset");
  });

  it("rejects id with Chinese characters", () => {
    const r = validateYuanchatId("用户名");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.idCharset");
  });

  it("rejects empty id", () => {
    const r = validateYuanchatId("   ");
    expect(r.valid).toBe(false);
  });
});

describe("validatePhone", () => {
  it("accepts a valid phone number", () => {
    expect(validatePhone("13812345678").valid).toBe(true);
  });

  it("accepts phone numbers starting with different prefixes", () => {
    expect(validatePhone("15912345678").valid).toBe(true);
    expect(validatePhone("18812345678").valid).toBe(true);
  });

  it("rejects empty phone", () => {
    const r = validatePhone("");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.phoneRequired");
  });

  it("rejects phone with wrong length", () => {
    const r = validatePhone("1381234567");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.phoneFormat");
  });

  it("rejects phone starting with invalid prefix", () => {
    const r = validatePhone("23812345678");
    expect(r.valid).toBe(false);
  });
});

describe("validateNickname", () => {
  it("accepts a valid nickname", () => {
    expect(validateNickname("张三").valid).toBe(true);
  });

  it("accepts nickname at min length (2)", () => {
    expect(validateNickname("张三").valid).toBe(true);
  });

  it("accepts nickname at max length (20)", () => {
    expect(validateNickname("这是一个二十字的昵称测试用户一").valid).toBe(true);
  });

  it("rejects empty nickname", () => {
    const r = validateNickname("");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.nicknameRequired");
  });

  it("rejects nickname shorter than 2", () => {
    const r = validateNickname("张");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.nicknameMinLength");
  });

  it("rejects nickname longer than 20", () => {
    const r = validateNickname("这是一个超过二十个字的昵称来测试一下长度限制");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("validation.nicknameMaxLength");
  });
});
