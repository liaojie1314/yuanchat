/**
 * useBackTo — 非根页面的安卓返回键语义
 *
 * @description
 * URL 子页面（商城详情/发布/我的、朋友圈发布/互动/个人页）的系统返回键默认兜底是
 * 「非根页面一律回聊天页」（见 apps/desktop 的 useAndroidBack：history 被大量
 * replace 污染不可靠），对这些页会跳过用户来的地方。照设置页子页的拦截器模式，
 * 把返回键引到 target。页面卸载时自动注销，页面内自绘返回箭头与其同语义。
 *
 * @param target - 按系统返回键时应回到的路由
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { registerBackInterceptor } from "@yuanchat/shared";

export function useBackTo(target: string) {
  const navigate = useNavigate();
  useEffect(() => {
    return registerBackInterceptor(() => {
      navigate(target);
      return true;
    });
  }, [navigate, target]);
}
