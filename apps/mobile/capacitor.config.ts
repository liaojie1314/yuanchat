import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.yuanchat.mobile",
  appName: "元聊 YuanChat",
  webDir: "dist",
  server: {
    // 开发模式：连接 Vite dev server
    // 生产构建时注释掉此配置
    // url: "http://192.168.x.x:5174",
    cleartext: true,
  },
  plugins: {
    StatusBar: {
      style: "dark",
    },
  },
};

export default config;
