// gc 回收对象存储里**无人引用**的对象。
//
// 背景：业务路径从不删对象——撤回只把 messages.content 置 '{}'、清空聊天记录只推进
// 本人水位、删贴纸只删表行。于是三类字节会永久留在 MinIO 里：
//
//  1. 被撤回消息的媒体（content 已清空，key 再也无人引用，但对象还在）
//  2. 被删除的收藏贴纸的对象
//  3. 上传成功但消息没发出去的孤儿（前端上传完才发 WS 帧，中间失败即产生）
//
// 为什么不在撤回时同步删：同一个 object_key 可被多方引用——转发是逐字复制 content
// （含 key）、不同用户可各自收藏同一对象。同步删会打断别人的副本，要引用计数且有竞态。
// 离线 GC 天然处理共享：只要还有任何一处引用就不删。
//
// 安全设计：
//   - 默认 dry-run，只报告不删除；真删要显式 -delete
//   - 只考虑 LastModified 早于宽限期（默认 7 天）的对象，避开"刚上传、消息还在路上"的窗口
//   - 引用判定分批查库（-batch，默认 500），不把全库 key 装进内存
//
// 运行：
//
//	go run ./cmd/gc                      # 试运行，报告将被回收的对象
//	go run ./cmd/gc -delete              # 实际删除
//	go run ./cmd/gc -grace 720h -delete  # 自定义宽限期（30 天）
package main

import (
	"context"
	"flag"
	"log"
	"time"

	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/database"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/storage"
	"go.uber.org/zap"
)

func main() {
	var (
		doDelete  = flag.Bool("delete", false, "实际删除（缺省仅试运行报告）")
		grace     = flag.Duration("grace", 7*24*time.Hour, "宽限期：仅回收早于此时长的对象")
		batchSize = flag.Int("batch", 500, "引用判定的分批大小")
		prefix    = flag.String("prefix", "", "只扫描该前缀（如 images/），缺省全桶")
		cfgPath   = flag.String("config", "config/config.yaml", "配置文件路径")
	)
	flag.Parse()

	if *batchSize <= 0 {
		log.Fatal("-batch 必须为正")
	}

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	// gorm 的 SQL 日志级别取自配置（dev 是 info），会把每条 SQL 打到 stdout、
	// 把 GC 的回收清单冲得没法读。本命令的输出就是给人看的清单，故强制静默。
	cfg.Database.LogLevel = "silent"
	db, err := database.New(cfg.Database, zap.NewNop())
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer database.Close(db)

	st, err := storage.New(cfg.MinIO)
	if err != nil {
		log.Fatalf("connect object storage: %v", err)
	}

	ctx := context.Background()
	stats, err := run(ctx, st, repository.NewObjectACLRepository(db), runOpts{
		cutoff:    time.Now().Add(-*grace),
		batchSize: *batchSize,
		prefix:    *prefix,
		doDelete:  *doDelete,
	})
	if err != nil {
		log.Fatalf("gc failed: %v", err)
	}

	mode := "dry-run（未删除任何对象；加 -delete 才会真删）"
	if *doDelete {
		mode = "已删除"
	}
	log.Printf("gc 完成：扫描 %d 个对象，跳过 %d 个（宽限期内），无引用 %d 个 / %.2f MiB —— %s",
		stats.scanned, stats.skippedFresh, stats.unreferenced,
		float64(stats.unreferencedBytes)/(1024*1024), mode)
	if stats.failed > 0 {
		log.Printf("其中 %d 个删除失败（见上方日志），可重跑本命令重试", stats.failed)
	}
}

// keyRefChecker 只依赖"批量筛出仍被引用的 key"这一能力，便于测试注入桩。
type keyRefChecker interface {
	ReferencedKeys(ctx context.Context, keys []string) (map[string]struct{}, error)
}

type runOpts struct {
	// cutoff 宽限期边界：LastModified 晚于此刻的对象一律跳过
	cutoff    time.Time
	batchSize int
	prefix    string
	doDelete  bool
}

type gcStats struct {
	scanned           int
	skippedFresh      int
	unreferenced      int
	unreferencedBytes int64
	failed            int
}

// objectStore 是 gc 用到的对象存储能力子集（storage.Storage 满足它）。
// 抽成接口让 run 可以在没有 MinIO 的环境下被单测覆盖。
type objectStore interface {
	ListObjects(ctx context.Context, prefix string, fn func(storage.ObjectInfo) error) error
	RemoveObject(ctx context.Context, objectKey string) error
}

// run 扫描 → 分批判定引用 → （可选）删除，返回统计。
func run(ctx context.Context, st objectStore, refs keyRefChecker, opts runOpts) (gcStats, error) {
	var stats gcStats
	// 候选缓冲：攒够一批再查库，避免逐对象一次往返
	pending := make([]storage.ObjectInfo, 0, opts.batchSize)

	flush := func() error {
		if len(pending) == 0 {
			return nil
		}
		keys := make([]string, len(pending))
		for i, o := range pending {
			keys[i] = o.Key
		}
		referenced, err := refs.ReferencedKeys(ctx, keys)
		if err != nil {
			return err
		}
		for _, o := range pending {
			if _, used := referenced[o.Key]; used {
				continue
			}
			stats.unreferenced++
			stats.unreferencedBytes += o.Size
			if !opts.doDelete {
				log.Printf("[dry-run] 无引用：%s（%d bytes, %s）", o.Key, o.Size, o.LastModified.Format(time.RFC3339))
				continue
			}
			if err := st.RemoveObject(ctx, o.Key); err != nil {
				stats.failed++
				log.Printf("删除失败 %s: %v", o.Key, err)
				continue
			}
			log.Printf("已删除 %s（%d bytes）", o.Key, o.Size)
		}
		pending = pending[:0]
		return nil
	}

	err := st.ListObjects(ctx, opts.prefix, func(obj storage.ObjectInfo) error {
		stats.scanned++
		// 宽限期：刚上传的对象可能"消息还在路上"（前端先传字节后发 WS 帧），
		// 立刻回收会删掉正在发送中的媒体。
		if obj.LastModified.After(opts.cutoff) {
			stats.skippedFresh++
			return nil
		}
		pending = append(pending, obj)
		if len(pending) >= opts.batchSize {
			return flush()
		}
		return nil
	})
	if err != nil {
		return stats, err
	}
	if err := flush(); err != nil {
		return stats, err
	}
	return stats, nil
}
