/** 手机搜索路由页：与窗口/弹窗复用搜索内容，返回和结果导航各走一条路。 */
import { useCallback, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { registerBackInterceptor } from "@yuanchat/shared";
import { CommandPalette } from "./CommandPalette";

/** 手机 Web 与 Android 共用的独立搜索页面；会话范围由查询参数传入。 */
export function SearchPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const conversationId = params.get("conversation_id") || undefined;
  const returnTo = (location.state as { searchReturnTo?: string } | null)?.searchReturnTo;
  const onBack = useCallback(() => {
    // 应用入口使用 push，返回复原原路由；直接访问没有返回记录时确定性回聊天。
    if (returnTo) navigate(-1);
    else navigate("/chat", { replace: true });
  }, [navigate, returnTo]);
  useEffect(
    () =>
      registerBackInterceptor(() => {
        onBack();
        return true;
      }),
    [onBack],
  );

  return <CommandPalette variant="page" conversationId={conversationId} onClose={onBack} />;
}
