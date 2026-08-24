package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/password"
	"github.com/yuanchat/server/internal/pkg/shortid"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// UserService 可能返回的错误。
var (
	ErrDuplicateUser   = errors.New("phone or email already registered")
	ErrInvalidPassword = errors.New("invalid password")
	ErrUserNotFound    = errors.New("user not found")
	ErrInvalidRefresh  = errors.New("invalid or expired refresh token")
	ErrUserBanned      = errors.New("user is banned")
	ErrWeakPassword    = errors.New("weak password")
)

// 密码复杂度校验失败时回给前端的 i18n key（按 R7 约定放进响应 message 字段）。
//
// 前 4 个键复用 packages/design-system 既有的 validation.password*；
// MaxLength / NoWhitespace 两条规则前端 validatePassword 里没有，
// 因此 UI 不可能触发，只有绕过前端直连接口才会命中——那种调用方不需要本地化文案。
const (
	msgPasswordMinLength    = "validation.passwordMinLength"
	msgPasswordMaxLength    = "validation.passwordMaxLength"
	msgPasswordLowercase    = "validation.passwordLowercase"
	msgPasswordUppercase    = "validation.passwordUppercase"
	msgPasswordDigit        = "validation.passwordDigit"
	msgPasswordNoWhitespace = "validation.passwordNoWhitespace"
)

// WeakPasswordError 表示密码不满足复杂度要求，并携带命中规则的 i18n key。
type WeakPasswordError struct {
	// MessageKey 命中的规则对应的 i18n key，如 validation.passwordDigit
	MessageKey string
}

func (e *WeakPasswordError) Error() string { return "weak password: " + e.MessageKey }

// Unwrap 让调用方可以只判哨兵：errors.Is(err, ErrWeakPassword)。
func (e *WeakPasswordError) Unwrap() error { return ErrWeakPassword }

// ValidatePasswordStrength 校验密码复杂度：长度 8-64、同时含小写 / 大写 / 数字、不含空白字符。
//
// 注册与改密两条路径共用，否则绕过前端直连接口即可把密码设成 12345678。
// 长度按字节计而非字符：bcrypt 只取前 72 字节，按字符放行会让多字节密码被静默截断。
//
// 规则以 spec / constraints 为准，与前端 validatePassword 并不完全等价——
// 前端另有「必须含特殊字符」且不限上限、不禁空白，两侧差异见批次报告。
func ValidatePasswordStrength(pw string) error {
	if len(pw) < 8 {
		return &WeakPasswordError{MessageKey: msgPasswordMinLength}
	}
	if len(pw) > 64 {
		return &WeakPasswordError{MessageKey: msgPasswordMaxLength}
	}

	var hasLower, hasUpper, hasDigit bool
	for _, r := range pw {
		switch {
		case unicode.IsSpace(r):
			return &WeakPasswordError{MessageKey: msgPasswordNoWhitespace}
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsDigit(r):
			hasDigit = true
		}
	}
	switch {
	case !hasLower:
		return &WeakPasswordError{MessageKey: msgPasswordLowercase}
	case !hasUpper:
		return &WeakPasswordError{MessageKey: msgPasswordUppercase}
	case !hasDigit:
		return &WeakPasswordError{MessageKey: msgPasswordDigit}
	}
	return nil
}

// UserService 负责注册、登录与个人资料相关的业务逻辑。
type UserService struct {
	repo   *repository.UserRepository
	jwtGen *jwt.Generator
	sidGen *shortid.Generator
	logger *zap.Logger
}

func NewUserService(repo *repository.UserRepository, jwtGen *jwt.Generator, sidGen *shortid.Generator, logger *zap.Logger) *UserService {
	return &UserService{repo: repo, jwtGen: jwtGen, sidGen: sidGen, logger: logger}
}

// RegisterRequest 是注册新账号的入参。
type RegisterRequest struct {
	Phone    string `json:"phone"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
}

// LoginRequest 是登录认证的入参。
type LoginRequest struct {
	Account  string `json:"account"` // phone or email
	Password string `json:"password"`
}

// AuthResult 是登录 / 注册成功后返回的令牌与用户信息。
type AuthResult struct {
	User         model.User    `json:"user"`
	TokenPair    jwt.TokenPair `json:"-"`
	AccessToken  string        `json:"access_token"`
	RefreshToken string        `json:"refresh_token"`
	ExpiresIn    int64         `json:"expires_in"`
}

// Register 创建新账号并返回 JWT 令牌。
func (s *UserService) Register(ctx context.Context, req RegisterRequest) (*AuthResult, error) {
	// 密码复杂度：handler 的 binding 只管 8-64 长度，弱密码要在此拦下
	if err := ValidatePasswordStrength(req.Password); err != nil {
		return nil, err
	}

	// 生成短号
	shortID, err := s.sidGen.Next(ctx)
	if err != nil {
		return nil, fmt.Errorf("generate short id: %w", err)
	}

	// 查重
	exists, err := s.repo.ExistsByPhoneOrEmail(ctx, req.Phone, req.Email)
	if err != nil {
		return nil, fmt.Errorf("check duplicate: %w", err)
	}
	if exists {
		return nil, ErrDuplicateUser
	}

	// 哈希密码
	hash, err := password.Hash(req.Password)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	user := &model.User{
		ID:           uuid.New(),
		ShortID:      shortID,
		Phone:        strPtr(req.Phone),
		Email:        strPtr(req.Email),
		PasswordHash: hash,
		Nickname:     req.Nickname,
	}

	if err := s.repo.Create(ctx, user); err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}

	s.logger.Info("User registered", zap.String("user_id", user.ID.String()))

	return s.buildAuthResult(*user, "web")
}

// Login 用「手机号 / 邮箱 + 密码」认证用户并返回 JWT 令牌。
func (s *UserService) Login(ctx context.Context, req LoginRequest) (*AuthResult, error) {
	// 按手机号或邮箱查用户
	var user *model.User
	var err error

	if strings.Contains(req.Account, "@") {
		user, err = s.repo.FindByEmail(ctx, req.Account)
	} else {
		user, err = s.repo.FindByPhone(ctx, req.Account)
	}
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	// 校验密码
	if !password.Verify(user.PasswordHash, req.Password) {
		return nil, ErrInvalidPassword
	}

	// 封禁用户拒绝登录
	if user.Status == model.UserStatusDisabled {
		return nil, ErrUserBanned
	}

	// 记录本次登录时间，写失败不阻塞登录
	if err := s.repo.TouchLastLogin(ctx, user.ID); err != nil {
		s.logger.Warn("更新 last_login_at 失败",
			zap.String("user_id", user.ID.String()), zap.Error(err))
	}

	s.logger.Info("User logged in", zap.String("user_id", user.ID.String()))

	return s.buildAuthResult(*user, "web")
}

// Profile 返回当前用户的个人资料。
func (s *UserService) Profile(ctx context.Context, userID uuid.UUID) (*model.User, error) {
	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	// FindByID 对未命中返回 (nil, nil)，须转成领域错误，防止调用方解引用 nil
	if user == nil {
		return nil, ErrUserNotFound
	}
	return user, nil
}

// UpdateProfile 更新用户资料字段（nil 表示不改），持久化后返回最新 user。
func (s *UserService) UpdateProfile(
	ctx context.Context,
	userID uuid.UUID,
	nickname, avatarURL, bio *string,
	gender *int16,
) (*model.User, error) {
	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	if nickname != nil {
		user.Nickname = *nickname
	}
	if avatarURL != nil {
		user.AvatarURL = avatarURL
	}
	if bio != nil {
		user.Bio = bio
	}
	if gender != nil {
		user.Gender = *gender
	}

	if err := s.repo.Update(ctx, user); err != nil {
		return nil, fmt.Errorf("update user: %w", err)
	}
	return user, nil
}

// Refresh 用有效的 refresh 令牌换取全新的令牌对。
//
// 滑动会话（轮换）策略：access 与 refresh 都重新签发、各自重置 TTL，
// 持续活跃的用户永不掉线。旧 refresh 在剩余有效期内仍可用（无服务端存储）。
//
// 这里是 token_version 的两个校验点之一（另一个是 WS 建连）：本方法本来就要
// FindByID，因此补上封禁与版本校验是零额外 I/O。
func (s *UserService) Refresh(ctx context.Context, refreshToken string) (*jwt.TokenPair, error) {
	claims, err := s.jwtGen.Validate(refreshToken)
	if err != nil || claims.TokenUse != "refresh" {
		return nil, ErrInvalidRefresh
	}

	user, err := s.repo.FindByID(ctx, claims.UserID)
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	// 账号已注销
	if user == nil {
		return nil, ErrInvalidRefresh
	}
	// 封禁用户不得续期
	if user.Status == model.UserStatusDisabled {
		return nil, ErrUserBanned
	}
	// 改密后 token_version 递增，早先签发的 refresh 令牌随即失效
	if claims.TokenVersion != user.TokenVersion {
		return nil, ErrInvalidRefresh
	}

	pair, err := s.jwtGen.GeneratePair(claims.UserID, claims.DeviceID, user.TokenVersion)
	if err != nil {
		return nil, fmt.Errorf("generate tokens: %w", err)
	}
	return pair, nil
}

func (s *UserService) buildAuthResult(user model.User, deviceID string) (*AuthResult, error) {
	pair, err := s.jwtGen.GeneratePair(user.ID, deviceID, user.TokenVersion)
	if err != nil {
		return nil, fmt.Errorf("generate tokens: %w", err)
	}

	return &AuthResult{
		User:         user,
		TokenPair:    *pair,
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
		ExpiresIn:    pair.ExpiresIn,
	}, nil
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
