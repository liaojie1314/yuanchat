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
    expect(r.errors.some((e) => e.includes("8"))).toBe(true);
  });

  it("rejects password without uppercase letter", () => {
    const r = validatePassword("abc1234!");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("大写"))).toBe(true);
  });

  it("rejects password without lowercase letter", () => {
    const r = validatePassword("ABC1234!");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("小写"))).toBe(true);
  });

  it("rejects password without digit", () => {
    const r = validatePassword("Abcdefg!");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("数字"))).toBe(true);
  });

  it("rejects password without special character", () => {
    const r = validatePassword("Abc12345");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("特殊"))).toBe(true);
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
    expect(r.errors.some((e) => e.includes("3"))).toBe(true);
  });

  it("rejects id with special characters", () => {
    const r = validateYuanchatId("user@name");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("字母"))).toBe(true);
  });

  it("rejects id with Chinese characters", () => {
    const r = validateYuanchatId("用户名");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("字母"))).toBe(true);
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
    expect(r.errors.some((e) => e.includes("请输入"))).toBe(true);
  });

  it("rejects phone with wrong length", () => {
    const r = validatePhone("1381234567");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("格式"))).toBe(true);
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
    expect(r.errors.some((e) => e.includes("请输入"))).toBe(true);
  });

  it("rejects nickname shorter than 2", () => {
    const r = validateNickname("张");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("2"))).toBe(true);
  });

  it("rejects nickname longer than 20", () => {
    const r = validateNickname("这是一个超过二十个字的昵称来测试一下长度限制");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("20"))).toBe(true);
  });
});
