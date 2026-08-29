import { QrLoginScreen } from "@yuanchat/ui";

/** 扫码登录页 —— web 端无窗口顶栏，登录成功后由路由守卫自动进主界面 */
export function QrLoginPage() {
  return <QrLoginScreen />;
}
