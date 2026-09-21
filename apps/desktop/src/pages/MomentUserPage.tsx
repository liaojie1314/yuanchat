import { useParams } from "react-router-dom";
import { MomentsScreen, useBackTo } from "@yuanchat/ui";

export function MomentUserPage() {
  const { userId } = useParams();
  // 个人页是 /moments 的子页：系统返回键回信息流，不落「非根页面回聊天页」的兜底
  useBackTo("/moments");
  return <MomentsScreen userId={userId} />;
}
