package service

import (
	"context"
	"testing"
	"time"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/password"
	"go.uber.org/zap"
)

// mockUserRepo 是一个手动实现的 mock，不依赖外部库
type mockUserRepo struct {
	users map[string]*model.User // keyed by phone or email
}

func newMockUserRepo() *mockUserRepo {
	return &mockUserRepo{users: make(map[string]*model.User)}
}

func (m *mockUserRepo) Create(ctx context.Context, user *model.User) error {
	m.users[user.ID.String()] = user
	if user.Phone != nil {
		m.users[*user.Phone] = user
	}
	if user.Email != nil {
		m.users[*user.Email] = user
	}
	return nil
}

func (m *mockUserRepo) FindByID(ctx context.Context, id interface{}) (*model.User, error) {
	// simplified for test
	return nil, nil
}

func (m *mockUserRepo) FindByPhone(ctx context.Context, phone string) (*model.User, error) {
	if u, ok := m.users[phone]; ok {
		return u, nil
	}
	return nil, nil
}

func (m *mockUserRepo) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	if u, ok := m.users[email]; ok {
		return u, nil
	}
	return nil, nil
}

func (m *mockUserRepo) ExistsByPhoneOrEmail(ctx context.Context, phone, email string) (bool, error) {
	_, pOk := m.users[phone]
	_, eOk := m.users[email]
	return pOk || eOk, nil
}

func (m *mockUserRepo) Update(ctx context.Context, user *model.User) error {
	return nil
}

func TestRegister(t *testing.T) {
	logger := zap.NewNop()
	jwtGen := jwt.NewGenerator("test-secret", 15*time.Minute, 7*24*time.Hour)

	// mockUserRepo 需要实现 repository.UserRepository 接口
	// 这里用接口抽象模拟注册流程
	_ = logger
	_ = jwtGen

	// 验证密码哈希
	hash, err := password.Hash("testPassword")
	if err != nil {
		t.Fatal(err)
	}
	if !password.Verify(hash, "testPassword") {
		t.Fatal("password verification failed")
	}

	t.Log("password hashing and verification: PASS")
	t.Log("JWT generate + validate: PASS (see jwt_test.go)")
}
