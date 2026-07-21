package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestToggleReactionAddThenRemove(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "rx-a")
	b := newTestUser(t, db, "rx-b")
	msg := newRecallFixture(t, db, a, b)
	ctx := context.Background()

	res, err := svc.ToggleReaction(ctx, b.ID, msg.ID, "👍")
	if err != nil {
		t.Fatalf("toggle add: %v", err)
	}
	if !res.Reacted || res.Count != 1 {
		t.Fatalf("add: %+v", res)
	}
	if res.Message.ConversationID != msg.ConversationID || len(res.MemberIDs) != 2 {
		t.Fatalf("push targets: %+v", res)
	}

	res, err = svc.ToggleReaction(ctx, b.ID, msg.ID, "👍")
	if err != nil {
		t.Fatalf("toggle remove: %v", err)
	}
	if res.Reacted || res.Count != 0 {
		t.Fatalf("remove: %+v", res)
	}
}

func TestToggleReactionValidation(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "rxv-a")
	b := newTestUser(t, db, "rxv-b")
	outsider := newTestUser(t, db, "rxv-x")
	msg := newRecallFixture(t, db, a, b)
	ctx := context.Background()

	// 非成员 → ErrNotMember
	if _, err := svc.ToggleReaction(ctx, outsider.ID, msg.ID, "👍"); !errors.Is(err, ErrNotMember) {
		t.Fatalf("outsider: want ErrNotMember, got %v", err)
	}
	// 消息不存在 → ErrMessageNotFound
	if _, err := svc.ToggleReaction(ctx, b.ID, uuid.New(), "👍"); !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("missing msg: want ErrMessageNotFound, got %v", err)
	}
	// emoji 空 / 超长 → ErrInvalidEmoji
	if _, err := svc.ToggleReaction(ctx, b.ID, msg.ID, "   "); !errors.Is(err, ErrInvalidEmoji) {
		t.Fatalf("empty emoji: want ErrInvalidEmoji, got %v", err)
	}
	if _, err := svc.ToggleReaction(ctx, b.ID, msg.ID, "👍👍👍👍👍👍👍👍👍"); !errors.Is(err, ErrInvalidEmoji) {
		t.Fatalf("long emoji: want ErrInvalidEmoji, got %v", err)
	}
	// 已撤回消息 → ErrMessageNotFound（视同不可回应）
	if _, err := svc.Recall(ctx, a.ID, msg.ID); err != nil {
		t.Fatalf("recall fixture msg: %v", err)
	}
	if _, err := svc.ToggleReaction(ctx, b.ID, msg.ID, "👍"); !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("recalled msg: want ErrMessageNotFound, got %v", err)
	}
}

func TestHistoryCarriesReactions(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "rxh-a")
	b := newTestUser(t, db, "rxh-b")
	msg := newRecallFixture(t, db, a, b)
	ctx := context.Background()

	if _, err := svc.ToggleReaction(ctx, b.ID, msg.ID, "👍"); err != nil {
		t.Fatalf("toggle: %v", err)
	}

	// a 拉历史：Mine=false
	listA, err := svc.GetHistory(ctx, a.ID, msg.ConversationID, 0, 30)
	if err != nil {
		t.Fatalf("history a: %v", err)
	}
	var found bool
	for _, m := range listA {
		if m.ID == msg.ID {
			found = true
			if len(m.Reactions) != 1 || m.Reactions[0].Emoji != "👍" || m.Reactions[0].Count != 1 || m.Reactions[0].Mine {
				t.Fatalf("a reactions: %+v", m.Reactions)
			}
		}
	}
	if !found {
		t.Fatal("message not in history")
	}

	// b 拉历史：Mine=true
	listB, err := svc.GetHistory(ctx, b.ID, msg.ConversationID, 0, 30)
	if err != nil {
		t.Fatalf("history b: %v", err)
	}
	for _, m := range listB {
		if m.ID == msg.ID {
			if len(m.Reactions) != 1 || !m.Reactions[0].Mine {
				t.Fatalf("b reactions: %+v", m.Reactions)
			}
		}
	}
}
