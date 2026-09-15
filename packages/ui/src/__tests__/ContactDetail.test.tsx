import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContactDetail } from "../contacts/ContactDetail";
import type { Friend, PublicProfile } from "@yuanchat/shared";

// fetchPublicProfile 返回固定资料，断言信息卡渲染签名 / 性别
const PROFILE: PublicProfile = {
  id: "f1",
  nickname: "阿建",
  avatarUrl: null,
  shortId: 88888,
  bio: "热爱开源",
  gender: 1,
};

const fetchPublicProfile = vi.fn(async () => PROFILE);

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    isMockEnabled: () => false,
    fetchPublicProfile: () => fetchPublicProfile(),
  };
});

const FRIEND: Friend = {
  id: "f1",
  nickname: "阿建",
  avatarUrl: null,
  shortId: 88888,
  conversationId: "c1",
};

// jsdom 默认 locale 为 en-US，所有 t() 文案断言使用英文
describe("ContactDetail", () => {
  beforeEach(() => {
    fetchPublicProfile.mockClear();
    fetchPublicProfile.mockResolvedValue(PROFILE);
  });

  it("renders nickname and yuan id immediately", async () => {
    render(<ContactDetail friend={FRIEND} onMessage={() => {}} />);
    expect(screen.getByText("YuanChat ID")).toBeInTheDocument();
    expect(screen.getByText("88888")).toBeInTheDocument();
    // 等异步资料 settle，避免 act() 警告
    await screen.findByText("热爱开源");
  });

  it("renders bio and gender from fetched profile", async () => {
    render(<ContactDetail friend={FRIEND} onMessage={() => {}} />);
    expect(await screen.findByText("热爱开源")).toBeInTheDocument();
    expect(screen.getByText("Male")).toBeInTheDocument();
  });

  it("hides gender row when gender is secret (0)", async () => {
    fetchPublicProfile.mockResolvedValueOnce({ ...PROFILE, gender: 0, bio: "签名保留" });
    render(<ContactDetail friend={FRIEND} onMessage={() => {}} />);
    // 等资料加载完成（签名出现）后，性别标签行仍不存在
    await screen.findByText("签名保留");
    expect(screen.queryByText("Gender")).toBeNull();
  });

  it("shows failure hint when profile fetch rejects", async () => {
    fetchPublicProfile.mockRejectedValueOnce(new Error("boom"));
    render(<ContactDetail friend={FRIEND} onMessage={() => {}} />);
    expect(await screen.findByText("Failed to load profile")).toBeInTheDocument();
  });
});
