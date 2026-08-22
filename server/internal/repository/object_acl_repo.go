package repository

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

// ObjectACLRepository 按"现有数据"判定对象存储 key 的可读性与可回收性。
//
// 设计取舍：不为对象另建归属表（upload-url 阶段落 uploader 记录）。理由是
// 上传者授权只解决发送方，接收方仍要靠"这条消息在我能看的会话里"来判定，
// 等于同一套引用查询再加一张需要回填的表；而历史消息本身就带着 key，
// 直接反查既无回填问题也无双写不一致。
//
// 相应的代价：对象的可读性等于"引用它的消息对我可见"，因此
//   - 撤回（content 置 '{}'）→ key 从索引消失 → 再签不出新 URL（撤销真的生效）
//   - 本人清空聊天记录（cleared_before_seq 水位）→ 对本人同样失效，对他人不影响
//
// 已签发的预签名 URL 无法追回，故 downloadURLTTL 一并从 24h 收到 2h 缩小窗口。
type ObjectACLRepository struct {
	db *gorm.DB
}

func NewObjectACLRepository(db *gorm.DB) *ObjectACLRepository {
	return &ObjectACLRepository{db: db}
}

// CanRead 判定 userID 能否读取 objectKey。
//
// 命中任一条件即可：
//  1. key 出现在某条**未撤回**消息的 content.key 里，且 userID 是该会话成员，
//     且该消息未被 userID 自己的清空水位过滤；
//  2. key 属于 userID 的收藏贴纸，或属于某个表情包（官方包全员可发/可看）。
//
// 头像（avatars/ 前缀）不走本方法：桶策略对该前缀开放匿名公共读，
// 调用方（handler）直接放行。
func (r *ObjectACLRepository) CanRead(ctx context.Context, userID uuid.UUID, objectKey string) (bool, error) {
	var viaMessage bool
	err := r.db.WithContext(ctx).Raw(`
		SELECT EXISTS (
			SELECT 1
			FROM messages m
			JOIN conversation_members cm
			  ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
			WHERE m.content ->> 'key' = ?
			  AND m.status = 1
			  AND m.seq > cm.cleared_before_seq
		)`, userID, objectKey).Scan(&viaMessage).Error
	if err != nil {
		return false, fmt.Errorf("acl via message: %w", err)
	}
	if viaMessage {
		return true, nil
	}

	var viaSticker bool
	err = r.db.WithContext(ctx).Raw(`
		SELECT EXISTS (
			SELECT 1 FROM stickers
			WHERE object_key = ? AND (owner_id = ? OR pack_id IS NOT NULL)
		)`, objectKey, userID).Scan(&viaSticker).Error
	if err != nil {
		return false, fmt.Errorf("acl via sticker: %w", err)
	}
	return viaSticker, nil
}

// ReferencedKeys 从给定候选集中筛出**仍被引用**的 key（GC 用，见 cmd/gc）。
//
// 引用来源三处：消息内容（含已撤回消息——撤回把 content 置 '{}'，故自然不再算引用）、
// 贴纸表、用户/会话头像 URL（存的是完整 URL，故用后缀匹配）。
// 返回集合之外的候选即"无人引用"，GC 结合宽限期决定是否删除。
//
// 按批查询（调用方分批传入）而非一次性把全库 key 拉进内存：对象数随消息量线性增长，
// 全量装载在大库上会 OOM——这正是本仓审计里反复出现的"无上限查询"形态。
func (r *ObjectACLRepository) ReferencedKeys(ctx context.Context, keys []string) (map[string]struct{}, error) {
	referenced := make(map[string]struct{}, len(keys))
	if len(keys) == 0 {
		return referenced, nil
	}

	collect := func(sql string) error {
		var found []string
		if err := r.db.WithContext(ctx).Raw(sql, keys).Scan(&found).Error; err != nil {
			return err
		}
		for _, k := range found {
			referenced[k] = struct{}{}
		}
		return nil
	}

	if err := collect(`SELECT DISTINCT content ->> 'key' FROM messages WHERE content ->> 'key' IN ?`); err != nil {
		return nil, fmt.Errorf("referenced by messages: %w", err)
	}
	if err := collect(`SELECT DISTINCT object_key FROM stickers WHERE object_key IN ?`); err != nil {
		return nil, fmt.Errorf("referenced by stickers: %w", err)
	}

	// 头像：users.avatar_url / conversations.avatar_url 存的是完整 URL（含 bucket 与前缀），
	// 只能后缀匹配。用 unnest + EXISTS 把整批合成一次往返——逐个候选发一条 EXISTS
	// 会让一次 GC 产生 O(对象数) 次数据库往返。
	//
	// 不按 `avatars/` 前缀提前跳过：avatar_url 是自由字符串列，历史上（或将来手工改库）
	// 完全可能指向 images/ 下的对象，跳过就会把仍在用的头像当孤儿删掉。
	var avatarHits []string
	err := r.db.WithContext(ctx).Raw(`
		SELECT k FROM unnest(?::text[]) AS k
		WHERE EXISTS (SELECT 1 FROM users WHERE avatar_url LIKE '%' || k)
		   OR EXISTS (SELECT 1 FROM conversations WHERE avatar_url LIKE '%' || k)`,
		pq.StringArray(keys)).Scan(&avatarHits).Error
	if err != nil {
		return nil, fmt.Errorf("referenced by avatar: %w", err)
	}
	for _, k := range avatarHits {
		referenced[k] = struct{}{}
	}

	return referenced, nil
}
