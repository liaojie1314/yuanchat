/**
 * GroupAvatar 组件 — 群聊头像（成员头像拼合）
 *
 * @description
 * 群没设自己的头像时，按微信/QQ 的规矩把成员头像拼成一格一格的方阵：
 * 1 张居中 · 2 张并排 · 3 张上 1 下 2 · 4 张田字 · 5 张上 2 下 3 ·
 * 6 张两行三列 · 7-9 张三行三列，**不足的一行补在最上且居中**。
 * 超过 9 人只取前 9（与两端服务端下发的上限一致）。
 *
 * 优先级：群自己的 `src` > 成员拼合 > 群名首字母（后两者都没有时退回
 * {@link Avatar}，尺寸与单聊头像完全一致，可直接替换）。
 *
 * 布局全部用百分比 calc 而非固定像素：外框尺寸沿用 Avatar 的 rem 类，跟随
 * 应用的字号设置缩放，格子也就跟着缩放。不用 CSS `aspect-ratio`（Chrome 88+），
 * 格子的宽高各自算一次，旧 WebView 也不会塌成 0 高。
 *
 * @param name - 群名，用于首字母与兜底格的稳定配色
 * @param src - 群自己的头像 URL，非空时直接用它，不拼合
 * @param avatars - 成员头像 URL，按成员顺序；没设头像的成员是空串
 * @param names - 成员昵称，与 `avatars` 同序等长；空串格子取它的首字与配色。
 *   不传则退回群名首字（旧数据与未接线的调用方都不会炸）
 * @param size - 尺寸，与 Avatar 同一套 sm/md/lg/xl
 *
 * @example
 * <GroupAvatar
 *   name="产品研发群"
 *   src={conv.avatarUrl}
 *   avatars={conv.memberAvatars}
 *   names={conv.memberNames}
 * />
 */
import { getAvatarColor } from "@yuanchat/shared/utils";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";

/** 拼合上限：再多也只展示前 9 个 */
const MAX_TILES = 9;
/** 格子间距（像素），与 `gap-px` 一致，参与格子边长的 calc */
const GAP_PX = 1;

/** 尺寸 → Tailwind 宽高（与 Avatar 逐字一致，二者可互换） */
const sizeMap = {
  sm: "w-8 h-8",
  md: "w-10 h-10",
  lg: "w-14 h-14",
  xl: "w-16 h-16",
};

/** 首字母字号：格子越小越收，三列时干脆不写字（放不下） */
const fontSizeMap = {
  sm: "text-[8px]",
  md: "text-[9px]",
  lg: "text-[11px]",
  xl: "text-xs",
};

/**
 * 人数 → 每列几格。
 *
 * @remarks 2-4 人两列、5 人往上三列，与微信一致；行数由此推出，
 *   首行放余数并居中（8 人就是上 2 下 3+3）。
 */
function columnsOf(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

/** 一格的数据：头像 URL（可能为空串）与该成员昵称（可能缺） */
type Tile = { url: string; member: string };

/** 按微信规则切行：首行放余数（居中），其余行放满 */
function splitRows(tiles: Tile[], cols: number): Tile[][] {
  const rowCount = Math.ceil(tiles.length / cols);
  const first = tiles.length - (rowCount - 1) * cols;
  const out: Tile[][] = [tiles.slice(0, first)];
  for (let i = 0; i < rowCount - 1; i++) {
    out.push(tiles.slice(first + i * cols, first + (i + 1) * cols));
  }
  return out;
}

export function GroupAvatar({
  name,
  src,
  avatars,
  names,
  size = "md",
}: {
  name: string;
  src?: string | null;
  avatars?: string[];
  names?: string[];
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const tiles: Tile[] = (avatars ?? [])
    .slice(0, MAX_TILES)
    .map((url, i) => ({ url, member: names?.[i] ?? "" }));

  // 群头像优先；一个成员头像都没有时也退回单图头像（首字母）
  if (src || tiles.length === 0) {
    return <Avatar name={name} src={src} size={size} />;
  }

  const cols = columnsOf(tiles.length);
  const rows = splitRows(tiles, cols);
  // 格子边长 = (外框 - 列间距) / 列数；宽取外框宽、高取外框高，外框是正方形故相等
  const edge = "calc((100% - " + (cols - 1) * GAP_PX + "px) / " + cols + ")";

  return (
    <div
      data-group-rows={rows.map((r) => r.length).join(",")}
      className={cn(
        "inline-flex shrink-0 flex-col items-center justify-center gap-px overflow-hidden rounded-full",
        sizeMap[size],
      )}
      role="img"
      aria-label={name}
    >
      {rows.map((slice, r) => (
        <div key={r} className="flex w-full justify-center gap-px" style={{ height: edge }}>
          {slice.map((tile, i) => (
            <GroupTile
              key={r + "-" + i}
              tile={tile}
              groupName={name}
              seed={r + "-" + i}
              edge={edge}
              withInitial={cols <= 2}
              size={size}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 一格：有图用图，没图用首字色块。
 *
 * 首字与配色都优先取该成员昵称——同一个人在哪个群都是同一个色，
 * 认人比认群更有用；昵称缺失才退回群名 + 位置种子，避免一群没头像的
 * 成员拼出一整块同色。
 */
function GroupTile({
  tile,
  groupName,
  seed,
  edge,
  withInitial,
  size,
}: {
  tile: Tile;
  groupName: string;
  seed: string;
  edge: string;
  withInitial: boolean;
  size: "sm" | "md" | "lg" | "xl";
}) {
  if (tile.url) {
    return (
      <span data-group-tile className="h-full overflow-hidden" style={{ width: edge }}>
        <img src={tile.url} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  const label = tile.member || groupName;
  return (
    <span
      data-group-tile
      data-group-fallback
      className={cn(
        "flex h-full items-center justify-center overflow-hidden font-medium text-white",
        fontSizeMap[size],
      )}
      style={{ width: edge, backgroundColor: getAvatarColor(tile.member || groupName + seed) }}
    >
      {/* 三列布局的格子只有外框的三分之一宽，写字必糊，只留色块 */}
      {withInitial ? label.slice(0, 1) : null}
    </span>
  );
}
