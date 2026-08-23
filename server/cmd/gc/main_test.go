package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/yuanchat/server/internal/storage"
)

// fakeStore 内存对象存储：记录被删掉的 key，可指定某个 key 删除必失败。
type fakeStore struct {
	objects  []storage.ObjectInfo
	removed  []string
	failKeys map[string]bool
}

func (f *fakeStore) ListObjects(_ context.Context, prefix string, fn func(storage.ObjectInfo) error) error {
	for _, o := range f.objects {
		if prefix != "" && len(o.Key) < len(prefix) {
			continue
		}
		if prefix != "" && o.Key[:len(prefix)] != prefix {
			continue
		}
		if err := fn(o); err != nil {
			return err
		}
	}
	return nil
}

func (f *fakeStore) RemoveObject(_ context.Context, key string) error {
	if f.failKeys[key] {
		return errors.New("boom")
	}
	f.removed = append(f.removed, key)
	return nil
}

// fakeRefs 把给定集合视为"仍被引用"，并记录每批的大小以验证分批。
type fakeRefs struct {
	referenced map[string]struct{}
	batchSizes []int
}

func (f *fakeRefs) ReferencedKeys(_ context.Context, keys []string) (map[string]struct{}, error) {
	f.batchSizes = append(f.batchSizes, len(keys))
	out := map[string]struct{}{}
	for _, k := range keys {
		if _, ok := f.referenced[k]; ok {
			out[k] = struct{}{}
		}
	}
	return out, nil
}

var (
	old   = time.Now().Add(-30 * 24 * time.Hour)
	fresh = time.Now().Add(-time.Hour)
)

func baseOpts(doDelete bool) runOpts {
	return runOpts{
		cutoff:    time.Now().Add(-7 * 24 * time.Hour),
		batchSize: 500,
		doDelete:  doDelete,
	}
}

// TestGCKeepsReferencedAndFreshObjects 只回收「宽限期外 + 无人引用」的对象。
func TestGCKeepsReferencedAndFreshObjects(t *testing.T) {
	st := &fakeStore{objects: []storage.ObjectInfo{
		{Key: "images/2026/01/referenced.png", Size: 10, LastModified: old},
		{Key: "images/2026/01/orphan.png", Size: 20, LastModified: old},
		{Key: "images/2026/08/just-uploaded.png", Size: 30, LastModified: fresh},
	}}
	refs := &fakeRefs{referenced: map[string]struct{}{
		"images/2026/01/referenced.png": {},
		// just-uploaded 刻意不在引用集里：模拟"字节已传、WS 帧还没发"，
		// 宽限期必须先挡住它，否则 GC 会删掉正在发送中的媒体
	}}

	stats, err := run(context.Background(), st, refs, baseOpts(true))
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	if len(st.removed) != 1 || st.removed[0] != "images/2026/01/orphan.png" {
		t.Fatalf("removed = %v, want only the orphan", st.removed)
	}
	if stats.scanned != 3 || stats.skippedFresh != 1 || stats.unreferenced != 1 {
		t.Fatalf("stats = %+v", stats)
	}
	if stats.unreferencedBytes != 20 {
		t.Fatalf("unreferencedBytes = %d, want 20", stats.unreferencedBytes)
	}
}

// TestGCDryRunDeletesNothing 缺省（未加 -delete）只报告不动手。
func TestGCDryRunDeletesNothing(t *testing.T) {
	st := &fakeStore{objects: []storage.ObjectInfo{
		{Key: "images/2026/01/orphan.png", Size: 20, LastModified: old},
	}}
	refs := &fakeRefs{referenced: map[string]struct{}{}}

	stats, err := run(context.Background(), st, refs, baseOpts(false))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(st.removed) != 0 {
		t.Fatalf("dry-run 不应删除任何对象，却删了 %v", st.removed)
	}
	if stats.unreferenced != 1 {
		t.Fatalf("dry-run 仍应报告将被回收的数量，stats = %+v", stats)
	}
}

// TestGCBatchesReferenceLookups 引用判定必须分批，不能一次把全桶 key 交给数据库。
func TestGCBatchesReferenceLookups(t *testing.T) {
	var objs []storage.ObjectInfo
	for i := 0; i < 7; i++ {
		objs = append(objs, storage.ObjectInfo{
			Key:          "images/2026/01/" + string(rune('a'+i)) + ".png",
			Size:         1,
			LastModified: old,
		})
	}
	st := &fakeStore{objects: objs}
	refs := &fakeRefs{referenced: map[string]struct{}{}}

	opts := baseOpts(false)
	opts.batchSize = 3
	if _, err := run(context.Background(), st, refs, opts); err != nil {
		t.Fatalf("run: %v", err)
	}

	want := []int{3, 3, 1} // 最后一批由收尾 flush 处理，不能被漏掉
	if len(refs.batchSizes) != len(want) {
		t.Fatalf("batchSizes = %v, want %v", refs.batchSizes, want)
	}
	for i, n := range want {
		if refs.batchSizes[i] != n {
			t.Fatalf("batchSizes = %v, want %v", refs.batchSizes, want)
		}
	}
}

// TestGCCountsDeleteFailuresAndContinues 单个对象删除失败不应中断整轮回收。
func TestGCCountsDeleteFailuresAndContinues(t *testing.T) {
	st := &fakeStore{
		objects: []storage.ObjectInfo{
			{Key: "images/2026/01/bad.png", Size: 1, LastModified: old},
			{Key: "images/2026/01/good.png", Size: 2, LastModified: old},
		},
		failKeys: map[string]bool{"images/2026/01/bad.png": true},
	}
	refs := &fakeRefs{referenced: map[string]struct{}{}}

	stats, err := run(context.Background(), st, refs, baseOpts(true))
	if err != nil {
		t.Fatalf("run 不应因单个删除失败而整体报错: %v", err)
	}
	if stats.failed != 1 {
		t.Fatalf("failed = %d, want 1", stats.failed)
	}
	if len(st.removed) != 1 || st.removed[0] != "images/2026/01/good.png" {
		t.Fatalf("removed = %v, want the good one", st.removed)
	}
}
