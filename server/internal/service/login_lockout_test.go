package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/pkg/password"
	"gorm.io/gorm"
)

// lockoutPassword 是夹具种下的正确密码，满足后端复杂度要求。
const lockoutPassword = "Abcdef12"

// lockoutWrongPassword 是用于制造失败的错误密码。
const lockoutWrongPassword = "Wrongpass99"

// loginFixture 聚合账号级锁定用例所需的依赖：dev 库 + 进程内 redis + 已知密码的用户。
type loginFixture struct {
	svc     *UserService
	rdb     *redis.Client
	mr      *miniredis.Miniredis
	db      *gorm.DB
	account string
}

// newLoginFixture 建一个已知密码的用户，并把登录链路接到独立的进程内 redis 上。
func newLoginFixture(t *testing.T) *loginFixture {
	t.Helper()
	db := testDB(t)
	svc, _, rdb, mr := authSvcWithRedis(t, db)

	user := newTestUser(t, db, "login-lockout")
	hash, err := password.Hash(lockoutPassword)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if err := db.Model(user).Update("password_hash", hash).Error; err != nil {
		t.Fatalf("写入密码哈希: %v", err)
	}
	return &loginFixture{svc: svc, rdb: rdb, mr: mr, db: db, account: *user.Phone}
}

// login 用给定密码尝试登录夹具里的账号。
func (f *loginFixture) login(t *testing.T, pw string) error {
	t.Helper()
	_, err := f.svc.Login(context.Background(), LoginRequest{Account: f.account, Password: pw})
	return err
}

// loginAs 用任意账号尝试登录，供未注册账号与大小写变体的用例使用。
func (f *loginFixture) loginAs(t *testing.T, account, pw string) error {
	t.Helper()
	_, err := f.svc.Login(context.Background(), LoginRequest{Account: account, Password: pw})
	return err
}

// failNTimes 连续用错误密码登录 n 次，并逐次断言只是密码错误而非已被锁定。
func (f *loginFixture) failNTimes(t *testing.T, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if err := f.login(t, lockoutWrongPassword); !errors.Is(err, ErrInvalidPassword) {
			t.Fatalf("第 %d 次错误密码 err = %v, want ErrInvalidPassword", i+1, err)
		}
	}
}

// fails 读账号当前的失败计数，键不存在时返回 0。
func (f *loginFixture) fails(t *testing.T, account string) int {
	t.Helper()
	n, err := f.rdb.Get(context.Background(), "auth:login:fail:"+account).Int()
	if errors.Is(err, redis.Nil) {
		return 0
	}
	if err != nil {
		t.Fatalf("读失败计数: %v", err)
	}
	return n
}

// unknownAccount 造一个必然查不到的手机号（前缀 196 未被其他夹具占用）。
func unknownAccount() string {
	return fmt.Sprintf("196%08d", time.Now().UnixNano()%100000000)
}

// TestLoginLocksAfterFiveFailures 连错 5 次后，即使密码正确也必须被拒。
func TestLoginLocksAfterFiveFailures(t *testing.T) {
	f := newLoginFixture(t)
	f.failNTimes(t, 5)

	if err := f.login(t, lockoutPassword); !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("err = %v, want ErrAccountLocked", err)
	}
}

// TestLoginBelowThresholdStillAllowsCorrectPassword 未达阈值时正确密码照常放行，
// 防止把阈值实现成「错一次就锁」。
func TestLoginBelowThresholdStillAllowsCorrectPassword(t *testing.T) {
	f := newLoginFixture(t)
	f.failNTimes(t, 4)

	if err := f.login(t, lockoutPassword); err != nil {
		t.Fatalf("第 5 次用正确密码应放行，err = %v", err)
	}
}

// TestLoginSuccessClearsFailureCounter 登录成功清零计数，
// 否则历史失败累积到阈值后，某天正常登录也会开局即锁。
func TestLoginSuccessClearsFailureCounter(t *testing.T) {
	f := newLoginFixture(t)
	f.failNTimes(t, 4)

	if err := f.login(t, lockoutPassword); err != nil {
		t.Fatalf("正确密码应放行，err = %v", err)
	}
	if n := f.fails(t, f.account); n != 0 {
		t.Fatalf("登录成功后失败计数 = %d, want 0", n)
	}

	f.failNTimes(t, 4)
	if err := f.login(t, lockoutPassword); err != nil {
		t.Fatalf("计数未清零，被提前锁定: %v", err)
	}
}

// TestLoginLockedBeforePasswordVerify 锁定期内用错误密码登录，拿到的必须是锁定错误
// 而不是密码错误——这证明锁定判断排在密码校验之前，锁定期间不再消耗 bcrypt。
// 同时计数不再增长，否则攻击者可以把锁定期无限续期。
func TestLoginLockedBeforePasswordVerify(t *testing.T) {
	f := newLoginFixture(t)
	f.failNTimes(t, 5)

	if err := f.login(t, lockoutWrongPassword); !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("err = %v, want ErrAccountLocked（返回密码错误说明判断排在校验之后）", err)
	}
	if n := f.fails(t, f.account); n != 5 {
		t.Fatalf("锁定期内失败计数 = %d, want 5（不应继续递增）", n)
	}
}

// TestLoginFailureCounterKeyIsNamespacedWithTTL 计数键带 auth: 命名空间且窗口为 15 分钟。
//
// 键名与 TTL 是契约的一部分：没有命名空间会和既有 captcha 的裸键混在一起，
// 窗口写错则锁定时长与设计文档不符。
func TestLoginFailureCounterKeyIsNamespacedWithTTL(t *testing.T) {
	f := newLoginFixture(t)
	f.failNTimes(t, 1)

	if n := f.fails(t, f.account); n != 1 {
		t.Fatalf("失败计数 = %d, want 1（键名应为 auth:login:fail:{account}）", n)
	}
	ttl, err := f.rdb.TTL(context.Background(), "auth:login:fail:"+f.account).Result()
	if err != nil {
		t.Fatalf("读 TTL: %v", err)
	}
	if ttl <= 14*time.Minute || ttl > 15*time.Minute {
		t.Fatalf("TTL = %v, want 15 分钟窗口", ttl)
	}
}

// TestLoginLockExpiresAfterWindow 锁定窗口过去后自动解锁，无需人工介入。
func TestLoginLockExpiresAfterWindow(t *testing.T) {
	f := newLoginFixture(t)
	f.failNTimes(t, 5)

	f.mr.FastForward(16 * time.Minute)
	if err := f.login(t, lockoutPassword); err != nil {
		t.Fatalf("锁定窗口过后应放行，err = %v", err)
	}
}

// TestLoginUnknownAccountAlsoLocks 未注册账号同样计数并锁定。
//
// 若只对已注册账号计数，「第 6 次是 429 还是 401」就成了账号是否存在的探针。
func TestLoginUnknownAccountAlsoLocks(t *testing.T) {
	f := newLoginFixture(t)
	unknown := unknownAccount()

	for i := 0; i < 5; i++ {
		if err := f.loginAs(t, unknown, lockoutWrongPassword); !errors.Is(err, ErrUserNotFound) {
			t.Fatalf("第 %d 次 err = %v, want ErrUserNotFound", i+1, err)
		}
	}
	if err := f.loginAs(t, unknown, lockoutWrongPassword); !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("err = %v, want ErrAccountLocked", err)
	}
}

// TestLoginLockoutKeyIsCaseInsensitive 邮箱换大小写不能换到另一个计数器上。
func TestLoginLockoutKeyIsCaseInsensitive(t *testing.T) {
	f := newLoginFixture(t)
	const lower = "lockout-case@example.com"
	const upper = "Lockout-Case@Example.COM"

	for i := 0; i < 5; i++ {
		if err := f.loginAs(t, lower, lockoutWrongPassword); !errors.Is(err, ErrUserNotFound) {
			t.Fatalf("第 %d 次 err = %v, want ErrUserNotFound", i+1, err)
		}
	}
	if err := f.loginAs(t, upper, lockoutWrongPassword); !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("换大小写后 err = %v, want ErrAccountLocked", err)
	}
}
