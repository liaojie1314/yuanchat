import { useParams } from "react-router-dom";
import { StickerPackEditView } from "@yuanchat/ui";

export function StickerPackEditPage() {
  const { packId } = useParams();
  return <StickerPackEditView packId={packId ?? ""} />;
}
