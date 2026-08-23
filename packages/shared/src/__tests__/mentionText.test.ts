/**
 * @提及文本工具测试
 *
 * 覆盖整体删除与整体移动的判定边界：尾随空格、昵称前缀重叠、光标落在片段中间、
 * 以及「看着像提及但不是候选昵称」的普通文本必须走默认逐字符处理；
 * 事后修补还要保证只在「单字符删除」这一种输入下动手。
 */
import { describe, it, expect } from "vitest";
import {
  mentionSpanBefore,
  mentionSpanAfter,
  mentionTokenBefore,
  mentionTokenAfter,
  repairMentionDeletion,
} from "../utils/mentionText";

const NAMES = ["Bob", "李雷", "李"];

describe("mentionSpanBefore", () => {
  it("光标停在尾随空格后，连空格一起算作一段", () => {
    const text = "hi @Bob ";
    expect(mentionSpanBefore(text, text.length, NAMES)).toEqual({ start: 3, end: 8 });
  });

  it("光标紧贴昵称末尾（无尾随空格）也命中", () => {
    expect(mentionSpanBefore("hi @Bob", 7, NAMES)).toEqual({ start: 3, end: 7 });
  });

  it("昵称互为前缀时命中更长的那个", () => {
    const text = "@李雷 ";
    expect(mentionSpanBefore(text, text.length, NAMES)).toEqual({ start: 0, end: 4 });
  });

  it("光标落在片段中间时不命中，交回默认删除", () => {
    expect(mentionSpanBefore("hi @Bob", 6, NAMES)).toBeNull();
  });

  it("普通空格不会被误判成提及尾随空格", () => {
    expect(mentionSpanBefore("hello ", 6, NAMES)).toBeNull();
  });

  it("@ 后面不是候选昵称时不命中", () => {
    expect(mentionSpanBefore("@Carol", 6, NAMES)).toBeNull();
  });

  it("光标在开头时不命中", () => {
    expect(mentionSpanBefore("@Bob", 0, NAMES)).toBeNull();
  });

  it("候选昵称为空时不命中", () => {
    expect(mentionSpanBefore("@Bob ", 5, [])).toBeNull();
  });

  it("连续两个空格时只按默认删除处理", () => {
    expect(mentionSpanBefore("@Bob  ", 6, NAMES)).toBeNull();
  });
});

describe("mentionSpanAfter", () => {
  it("光标紧贴 @ 前方时整段前删，含尾随空格", () => {
    expect(mentionSpanAfter("hi @Bob 在吗", 3, NAMES)).toEqual({ start: 3, end: 8 });
  });

  it("末尾无空格时只删片段本身", () => {
    expect(mentionSpanAfter("hi @Bob", 3, NAMES)).toEqual({ start: 3, end: 7 });
  });

  it("光标后不是提及时不命中", () => {
    expect(mentionSpanAfter("hi @Bob", 0, NAMES)).toBeNull();
  });

  it("光标在末尾时不命中", () => {
    expect(mentionSpanAfter("hi @Bob", 7, NAMES)).toBeNull();
  });
});

describe("mentionTokenBefore", () => {
  it("光标紧贴昵称末尾时命中片段本身", () => {
    expect(mentionTokenBefore("hi @Bob", 7, NAMES)).toEqual({ start: 3, end: 7 });
  });

  it("不吃尾随空格：光标停在空格后不命中（空格自己走一步）", () => {
    expect(mentionTokenBefore("hi @Bob ", 8, NAMES)).toBeNull();
  });

  it("昵称互为前缀时命中更长的那个", () => {
    expect(mentionTokenBefore("@李雷", 3, NAMES)).toEqual({ start: 0, end: 3 });
  });

  it("光标落在片段中间时不命中", () => {
    expect(mentionTokenBefore("hi @Bob", 6, NAMES)).toBeNull();
  });

  it("光标在开头时不命中", () => {
    expect(mentionTokenBefore("@Bob", 0, NAMES)).toBeNull();
  });

  it("非候选昵称不命中", () => {
    expect(mentionTokenBefore("@Carol", 6, NAMES)).toBeNull();
  });
});

describe("mentionTokenAfter", () => {
  it("光标紧贴 @ 前方时命中片段本身", () => {
    expect(mentionTokenAfter("hi @Bob 在吗", 3, NAMES)).toEqual({ start: 3, end: 7 });
  });

  it("不吃尾随空格", () => {
    expect(mentionTokenAfter("@Bob 在吗", 0, NAMES)).toEqual({ start: 0, end: 4 });
  });

  it("光标后不是提及时不命中", () => {
    expect(mentionTokenAfter("hi @Bob", 0, NAMES)).toBeNull();
  });

  it("光标在末尾时不命中", () => {
    expect(mentionTokenAfter("hi @Bob", 7, NAMES)).toBeNull();
  });

  it("候选昵称为空时不命中", () => {
    expect(mentionTokenAfter("@Bob", 0, [])).toBeNull();
  });
});

describe("repairMentionDeletion", () => {
  it("退格啃掉尾随空格时，整段提及一并删除", () => {
    expect(repairMentionDeletion("hi @Bob ", "hi @Bob", 7, NAMES)).toEqual({
      value: "hi ",
      caret: 3,
    });
  });

  it("退格啃掉昵称末字符时，整段提及一并删除", () => {
    expect(repairMentionDeletion("hi @Bob", "hi @Bo", 6, NAMES)).toEqual({
      value: "hi ",
      caret: 3,
    });
  });

  it("Delete 啃掉 @ 时，整段提及连尾随空格一并删除", () => {
    expect(repairMentionDeletion("hi @Bob 在吗", "hi Bob 在吗", 3, NAMES)).toEqual({
      value: "hi 在吗",
      caret: 3,
    });
  });

  it("中文昵称同样整段删除", () => {
    expect(repairMentionDeletion("@李雷 ", "@李雷", 3, NAMES)).toEqual({ value: "", caret: 0 });
  });

  it("删的是提及之外的字符时不改写", () => {
    expect(repairMentionDeletion("hi @Bob 在吗", "hi @Bob 在", 9, NAMES)).toBeNull();
  });

  it("紧邻提及但不属于提及的字符不改写", () => {
    expect(repairMentionDeletion("@Bob x", "@Bob ", 5, NAMES)).toBeNull();
  });

  it("输入字符（文本变长）不改写", () => {
    expect(repairMentionDeletion("hi", "hix", 3, NAMES)).toBeNull();
  });

  it("选区整段删除（一次少多个字符）不改写", () => {
    expect(repairMentionDeletion("@Bob ", "", 0, NAMES)).toBeNull();
  });

  it("输入法候选替换（长度差一但内容改动）不改写", () => {
    expect(repairMentionDeletion("@Bob哈哈", "@Bob呵", 5, NAMES)).toBeNull();
  });

  it("候选昵称为空时不改写", () => {
    expect(repairMentionDeletion("@Bob ", "@Bob", 4, [])).toBeNull();
  });
});
