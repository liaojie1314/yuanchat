package service

import (
	"context"
	"sync"
	"testing"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/testutil"
)

// TestSendContentConcurrentSameClientMsgID N 个 goroutine 同时用同一
// client_msg_id 发送：必须恰好落 1 行，且所有响应指向同一条消息。
//
// 这是 spec §8 要求的并发断言：只按 READ COMMITTED 语义推理不够，
// 唯一索引在并发下的实际行为必须被证明。
//
// 刻意走 testutil.NewPooledDB 而不是 NewDB：后者返回单连接事务，
// 多 goroutine 打它会被 database/sql 串行化，跑出来的「并发」是假的。
func TestSendContentConcurrentSameClientMsgID(t *testing.T) {
	db := testutil.NewPooledDB(t)
	a := newTestUser(t, db, "并发甲")
	b := newTestUser(t, db, "并发乙")
	convID := newSendConv(t, db, a, b)
	svc := newMessageSvc(db)

	const n = 8
	const cid = "concurrent-cid"

	var wg sync.WaitGroup
	results := make([]*SendResult, n)
	errs := make([]error, n)
	start := make(chan struct{})

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start // 齐发，最大化并发窗口
			results[idx], errs[idx] = svc.SendContent(
				context.Background(), a.ID, convID,
				model.MessageTypeText, `{"text":"race"}`, cid, nil, nil,
			)
		}(i)
	}
	close(start)
	wg.Wait()

	// 全部调用都必须成功（幂等，不是「一个成功其余报错」）
	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d failed: %v", i, err)
		}
	}

	// 所有响应必须指向同一条消息
	firstID := results[0].Message.ID
	firstSeq := results[0].Message.Seq
	dupCount := 0
	for i, r := range results {
		if r.Message.ID != firstID {
			t.Fatalf("goroutine %d 拿到不同 message_id：%s vs %s", i, r.Message.ID, firstID)
		}
		if r.Message.Seq != firstSeq {
			t.Fatalf("goroutine %d 拿到不同 seq：%d vs %d", i, r.Message.Seq, firstSeq)
		}
		if r.Duplicate {
			dupCount++
		}
	}

	// 恰好一个是「首发」，其余全是「重复」
	if dupCount != n-1 {
		t.Fatalf("want %d 个 Duplicate，实际 %d", n-1, dupCount)
	}

	// 库里只有一行
	var count int64
	if err := db.Raw(
		`SELECT count(*) FROM messages WHERE sender_id = ? AND client_msg_id = ?`,
		a.ID, cid,
	).Scan(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("want 恰好 1 行落库，实际 %d 行", count)
	}
}
