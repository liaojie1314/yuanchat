import { useParams } from "react-router-dom";
import { StickerPackDetailView } from "@yuanchat/ui";

export function StickerPackDetailPage() {
  const { packId } = useParams();
  return <StickerPackDetailView packId={packId ?? ""} />;
}
