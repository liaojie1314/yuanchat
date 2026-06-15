/**
 * LoginPage — 炫彩渐变登录页
 *
 * 视觉亮点：全屏渐变动画 + 浮动 Logo + 玻璃态卡片 + 辉光按钮
 */
import { Button, Input } from "@yuanchat/ui";
import { MessageCircle, Sparkles } from "lucide-react";

export function LoginPage() {
  return (
    <div className="relative flex items-center justify-center min-h-screen overflow-hidden">
      {/* 动态渐变背景 */}
      <div className="absolute inset-0 gradient-shift opacity-50" />

      {/* 装饰光斑 */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl"
        style={{ background: "rgb(var(--md-sys-color-primary)/.12)", animation: "float 6s ease-in-out infinite" }} />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-3xl"
        style={{ background: "rgb(var(--md-sys-color-tertiary)/.12)", animation: "float 8s ease-in-out infinite .5s" }} />

      {/* 玻璃态卡片 */}
      <div className="relative w-full max-w-md mx-6 animate-msg-in">
        <div className="glass-strong rounded-3xl p-10 shadow-elevation-5">
          {/* Logo — 旋转光环 */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              <div className="avatar-glow-ring">
                <div className="relative z-10 inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary text-primary-on shadow-elevation-4">
                  <Sparkles size={36} className="animate-pulse-glow" />
                </div>
              </div>
            </div>
          </div>

          {/* 标题 */}
          <h1 className="text-center text-display-sm font-bold text-on-surface mb-1">
            元聊
          </h1>
          <p className="text-center text-body-md text-on-surface-variant mb-8">
            企业级即时通讯 · Web 版
          </p>

          {/* 表单 */}
          <div className="space-y-4">
            <Input placeholder="手机号或邮箱" type="text" />
            <Input placeholder="密码" type="password" />
            <Button className="w-full py-3.5 text-base font-semibold btn-glow">
              登 录
            </Button>
          </div>

          <p className="text-center text-label-md text-on-surface-variant mt-6">
            还没有账号？{" "}
            <span className="text-primary font-medium cursor-pointer hover:underline">
              立即注册
            </span>
          </p>
        </div>
      </div>

      {/* 底部装饰线 */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-tertiary to-secondary opacity-50" />
    </div>
  );
}
