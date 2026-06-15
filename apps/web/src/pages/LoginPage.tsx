import { Button, Input } from "@yuanchat/ui";
import { MessageCircle } from "lucide-react";

export function LoginPage() {
  return (
    <div
      className="flex items-center justify-center min-h-screen relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, rgb(var(--md-sys-color-primary-container)/0.5) 0%, rgb(var(--md-sys-color-surface)) 50%, rgb(var(--md-sys-color-tertiary-container)/0.3) 100%)`,
      }}
    >
      {/* 背景装饰圆 */}
      <div
        className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-20"
        style={{ background: `radial-gradient(circle, rgb(var(--md-sys-color-primary)) 0%, transparent 70%)` }}
      />
      <div
        className="absolute -bottom-40 -left-40 w-[30rem] h-[30rem] rounded-full opacity-15"
        style={{ background: `radial-gradient(circle, rgb(var(--md-sys-color-tertiary)) 0%, transparent 70%)` }}
      />

      {/* 登录卡片 */}
      <div className="relative w-full max-w-md p-8">
        <div className="md3-card p-8 shadow-elevation-3">
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center justify-center w-[72px] h-[72px] rounded-3xl mb-5 shadow-elevation-2"
              style={{
                background: `linear-gradient(135deg, rgb(var(--md-sys-color-primary)), rgb(var(--md-sys-color-tertiary)))`,
              }}
            >
              <MessageCircle size={36} color="white" />
            </div>
            <h1 className="text-headline-lg font-semibold text-on-surface">元聊</h1>
            <p className="text-body-md text-on-surface-variant mt-2">
              企业级即时通讯 · Web 版
            </p>
          </div>

          <div className="space-y-4">
            <Input placeholder="手机号或邮箱" type="text" />
            <Input placeholder="密码" type="password" />
            <Button className="w-full">登 录</Button>
          </div>

          <p className="text-center text-label-md text-on-surface-variant mt-6">
            还没有账号？{" "}
            <span className="text-primary font-medium cursor-pointer hover:underline">
              立即注册
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
