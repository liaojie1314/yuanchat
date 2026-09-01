/**
 * useStickerBack — 商城页面的安卓返回键语义
 *
 * @description
 * 商城是底部标签根页面之外的第一组 URL 路由页面。系统返回键的默认兜底是
 * 「非根页面一律回聊天页」（见 apps/desktop 的 useAndroidBack：history 被
 * 大量 replace 污染不可靠），对商城会跳过用户来的地方。照设置页子页的
 * 拦截器模式，把返回键引到 target：详情/发布/我的回列表，列表回来源 tab，
 * 编辑回详情。页面卸载时自动注销，页面内自绘返回箭头与其同语义。
 *
 * @param target - 按系统返回键时应回到的路由
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { registerBackInterceptor } from "@yuanchat/shared";

export function useStickerBack(target: string) {
  const navigate = useNavigate();
  useEffect(() => {
    return registerBackInterceptor(() => {
      navigate(target);
      return true;
    });
  }, [navigate, target]);
}
