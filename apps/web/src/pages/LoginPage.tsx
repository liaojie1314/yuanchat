import { Button, Input } from "@yuanchat/ui";
import { MessageCircle } from "lucide-react";

export function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-500 text-white mb-4 shadow-glow">
            <MessageCircle size={32} />
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-white">元聊</h1>
          <p className="text-sm text-neutral-500 mt-1">企业级即时通讯 · Web 版</p>
        </div>
        <div className="space-y-4">
          <Input placeholder="手机号或邮箱" type="text" />
          <Input placeholder="密码" type="password" />
          <Button className="w-full">登 录</Button>
        </div>
        <p className="text-center text-xs text-neutral-400 mt-6">
          还没有账号？{" "}
          <span className="text-primary-500 cursor-pointer hover:underline">立即注册</span>
        </p>
      </div>
    </div>
  );
}
