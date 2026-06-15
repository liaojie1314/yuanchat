import { Button, Input } from "@yuanchat/ui";
import { MessageCircle } from "lucide-react";

export function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-50 dark:bg-slate-900">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-500 text-white mb-4 shadow-glow-brand">
            <MessageCircle size={28} />
          </div>
          <h1 className="text-headline-sm font-semibold text-slate-800 dark:text-white">元聊</h1>
          <p className="text-body-md text-slate-500 dark:text-slate-400 mt-1">企业级即时通讯</p>
        </div>

        {/* 登录表单 */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-elevation-2 space-y-4">
          <Input placeholder="手机号或邮箱" type="text" />
          <Input placeholder="密码" type="password" />
          <Button className="w-full">登 录</Button>
        </div>

        <p className="text-center text-body-sm text-slate-400 mt-5">
          还没有账号？{" "}
          <span className="text-brand-600 dark:text-brand-400 cursor-pointer hover:underline font-medium">立即注册</span>
        </p>
      </div>
    </div>
  );
}
