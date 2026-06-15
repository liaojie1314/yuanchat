package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/password"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Common errors returned by UserService.
var (
	ErrDuplicateUser   = errors.New("phone or email already registered")
	ErrInvalidPassword = errors.New("invalid password")
	ErrUserNotFound    = errors.New("user not found")
)

// UserService handles user registration, login, and profile operations.
type UserService struct {
	repo      *repository.UserRepository
	jwtGen    *jwt.Generator
	logger    *zap.Logger
}

func NewUserService(repo *repository.UserRepository, jwtGen *jwt.Generator, logger *zap.Logger) *UserService {
	return &UserService{repo: repo, jwtGen: jwtGen, logger: logger}
}

// RegisterRequest is the input for creating a new account.
type RegisterRequest struct {
	Phone    string `json:"phone"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Code     string `json:"code"`     // verification code (TODO: SMS/email verification)
	Nickname string `json:"nickname"`
}

// LoginRequest is the input for authenticating.
type LoginRequest struct {
	Account  string `json:"account"` // phone or email
	Password string `json:"password"`
}

// AuthResult contains the tokens and user info returned on successful login/register.
type AuthResult struct {
	User         model.User     `json:"user"`
	TokenPair    jwt.TokenPair  `json:"-"`
	AccessToken  string         `json:"access_token"`
	RefreshToken string         `json:"refresh_token"`
	ExpiresIn    int64          `json:"expires_in"`
}

// Register creates a new user account and returns JWT tokens.
func (s *UserService) Register(ctx context.Context, req RegisterRequest) (*AuthResult, error) {
	// TODO: verify verification code before creating account

	// Check for duplicate
	exists, err := s.repo.ExistsByPhoneOrEmail(ctx, req.Phone, req.Email)
	if err != nil {
		return nil, fmt.Errorf("check duplicate: %w", err)
	}
	if exists {
		return nil, ErrDuplicateUser
	}

	// Hash password
	hash, err := password.Hash(req.Password)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	user := &model.User{
		ID:           uuid.New(),
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

// Login authenticates a user by phone/email + password and returns JWT tokens.
func (s *UserService) Login(ctx context.Context, req LoginRequest) (*AuthResult, error) {
	// Find user by phone or email
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

	// Verify password
	if !password.Verify(user.PasswordHash, req.Password) {
		return nil, ErrInvalidPassword
	}

	s.logger.Info("User logged in", zap.String("user_id", user.ID.String()))

	return s.buildAuthResult(*user, "web")
}

// Profile returns the current user's profile.
func (s *UserService) Profile(ctx context.Context, userID uuid.UUID) (*model.User, error) {
	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("find user: %w", err)
	}
	return user, nil
}

func (s *UserService) buildAuthResult(user model.User, deviceID string) (*AuthResult, error) {
	pair, err := s.jwtGen.GeneratePair(user.ID, deviceID)
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
