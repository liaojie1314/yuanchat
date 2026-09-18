package service

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// newAvatarGroup 建一个 n 人群（含群主）并返回会话与成员，成员顺序与
// ListMembers 的 role DESC, nickname ASC 一致：下标 0 是群主，其余按昵称升序。
// 昵称用零填充序号保证任何排序规则下次序都稳定。
// owner 非 nil 时复用该用户当群主，用于构造同一用户同时在多个群的场景。
func newAvatarGroup(t *testing.T, db *gorm.DB, tag string, n int, owner *model.User) (*model.Conversation, []*model.User) {
	t.Helper()
	conv := &model.Conversation{Type: model.ConversationTypeGroup, Name: strPtr(tag)}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv %s: %v", tag, err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(conv) })

	users := make([]*model.User, 0, n)
	for i := 0; i < n; i++ {
		role := model.MemberRoleNormal
		u := owner
		if i == 0 {
			role = model.MemberRoleOwner
			if u == nil {
				u = newTestUser(t, db, tag+"-owner")
			}
		} else {
			u = newTestUser(t, db, fmt.Sprintf("%s-m%02d", tag, i))
		}
		users = append(users, u)
		m := &model.ConversationMember{
			ConversationID: conv.ID, UserID: u.ID, Role: role, JoinedAt: time.Now(),
		}
		if err := db.Create(m).Error; err != nil {
			t.Fatalf("create member %d of %s: %v", i, tag, err)
		}
	}
	t.Cleanup(func() { db.Where("conversation_id = ?", conv.ID).Delete(&model.ConversationMember{}) })
	return conv, users
}

// setAvatar 写用户头像；url 为 nil 表示该成员没有设置头像（库里 NULL）。
func setAvatar(t *testing.T, db *gorm.DB, u *model.User, url *string) {
	t.Helper()
	if err := db.Model(&model.User{}).Where("id = ?", u.ID).
		Update("avatar_url", url).Error; err != nil {
		t.Fatalf("set avatar: %v", err)
	}
}

// dtoByID 从列表里挑出指定会话；找不到直接失败。
func dtoByID(t *testing.T, dtos []ConversationDTO, id uuid.UUID) ConversationDTO {
	t.Helper()
	for _, d := range dtos {
		if d.ID == id {
			return d
		}
	}
	t.Fatalf("conversation %s not in list", id)
	return ConversationDTO{}
}

// TestListMemberAvatarsGroupSizes 群成员头像按九宫格上限截断：
// 3/5/9 人全量返回，10 人只返回前 9 个。
func TestListMemberAvatarsGroupSizes(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	ctx := context.Background()

	for _, n := range []int{3, 5, 9, 10} {
		tag := fmt.Sprintf("sz%02d", n)
		conv, users := newAvatarGroup(t, db, tag, n, nil)
		for i, u := range users {
			setAvatar(t, db, u, strPtr(fmt.Sprintf("https://cdn/%s-%02d.png", tag, i)))
		}

		dtos, err := svc.List(ctx, users[0].ID)
		if err != nil {
			t.Fatalf("list(%d): %v", n, err)
		}
		got := dtoByID(t, dtos, conv.ID).MemberAvatars
		want := min(n, 9)
		if len(got) != want {
			t.Fatalf("group of %d: want %d avatars, got %d (%v)", n, want, len(got), got)
		}
		// 顺序须与成员顺序一致：下标 i 对应第 i 名成员
		for i, a := range got {
			if exp := fmt.Sprintf("https://cdn/%s-%02d.png", tag, i); a != exp {
				t.Fatalf("group of %d: avatar[%d] = %q, want %q", n, i, a, exp)
			}
		}
	}
}

// TestListMemberAvatarsMissingKeepsSlot 无头像的成员占空串，不跳过：
// 跳过会让前端九宫格格子错位、且拿不到昵称首字兜底的位置。
func TestListMemberAvatarsMissingKeepsSlot(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)

	conv, users := newAvatarGroup(t, db, "hole", 4, nil)
	for i, u := range users {
		if i == 2 { // 第 3 名成员没设头像
			setAvatar(t, db, u, nil)
			continue
		}
		setAvatar(t, db, u, strPtr(fmt.Sprintf("https://cdn/hole-%02d.png", i)))
	}

	got := dtoByID(t, mustList(t, svc, users[0].ID), conv.ID).MemberAvatars
	want := []string{
		"https://cdn/hole-00.png", "https://cdn/hole-01.png", "", "https://cdn/hole-03.png",
	}
	if len(got) != len(want) {
		t.Fatalf("want %d slots, got %d (%v)", len(want), len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("avatar[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestListMemberAvatarsPrivateEmpty 单聊不带该字段（单聊已有对端头像回落）。
func TestListMemberAvatarsPrivateEmpty(t *testing.T) {
	env := settingsTestEnv(t)
	setAvatar(t, env.DB, env.B, strPtr("https://cdn/peer.png"))

	got := dtoByID(t, mustList(t, env.Svc, env.A.ID), env.Conv.ID)
	if len(got.MemberAvatars) != 0 {
		t.Fatalf("private conversation must not carry member avatars, got %v", got.MemberAvatars)
	}
	// 既有的对端头像回落不能被本改动破坏
	if got.AvatarURL == nil || *got.AvatarURL != "https://cdn/peer.png" {
		t.Fatalf("peer avatar fallback broken, got %v", got.AvatarURL)
	}
}

// TestListMemberAvatarsNoCrossTalk 同一页里的多个群各归各的成员，不串号。
func TestListMemberAvatarsNoCrossTalk(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)

	viewer := newTestUser(t, db, "viewer")
	setAvatar(t, db, viewer, strPtr("https://cdn/viewer.png"))

	// viewer 同时是两个群的群主：3 人群与 5 人群
	convX, usersX := newAvatarGroup(t, db, "gx", 3, viewer)
	convY, usersY := newAvatarGroup(t, db, "gy", 5, viewer)
	for _, set := range []struct {
		tag   string
		users []*model.User
	}{{"gx", usersX}, {"gy", usersY}} {
		for i, u := range set.users {
			if i == 0 {
				continue // 群主是共用的 viewer，头像已设
			}
			setAvatar(t, db, u, strPtr(fmt.Sprintf("https://cdn/%s-%02d.png", set.tag, i)))
		}
	}

	dtos := mustList(t, svc, viewer.ID)
	for _, c := range []struct {
		conv *model.Conversation
		tag  string
		size int
	}{{convX, "gx", 3}, {convY, "gy", 5}} {
		got := dtoByID(t, dtos, c.conv.ID).MemberAvatars
		if len(got) != c.size {
			t.Fatalf("%s: want %d avatars, got %d (%v)", c.tag, c.size, len(got), got)
		}
		if got[0] != "https://cdn/viewer.png" {
			t.Fatalf("%s: owner slot = %q, want viewer avatar", c.tag, got[0])
		}
		for i, a := range got[1:] {
			if !strings.Contains(a, "/"+c.tag+"-") {
				t.Fatalf("%s: avatar[%d] = %q leaked from another conversation", c.tag, i+1, a)
			}
		}
	}
}

// mustList 取会话列表，失败即终止用例。
func mustList(t *testing.T, svc *ConversationService, userID uuid.UUID) []ConversationDTO {
	t.Helper()
	dtos, err := svc.List(context.Background(), userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	return dtos
}
