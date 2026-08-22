// Package jwt 提供 JWT 令牌的签发与校验。
//
// 采用「access token（15 分钟）+ refresh token（7 天）」双令牌模式：
// access 短命、随每个 API 请求发送；refresh 长命、仅用于换取新的 access。
package jwt

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Claims 是两类令牌共用的载荷，携带用户身份。
type Claims struct {
	UserID   uuid.UUID `json:"uid"`
	DeviceID string    `json:"did"`
	TokenUse string    `json:"use"` // "access" or "refresh"
	jwt.RegisteredClaims
}

// TokenPair 是一次签发产出的 access + refresh 令牌对。
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"` // seconds until access token expires
}

// Generator 负责签发与校验 JWT 令牌。
type Generator struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

// NewGenerator 构造 JWT 签发器。
func NewGenerator(secret string, accessTTL, refreshTTL time.Duration) *Generator {
	return &Generator{
		secret:     []byte(secret),
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
	}
}

// GeneratePair 为指定用户签发一对 access / refresh 令牌。
func (g *Generator) GeneratePair(userID uuid.UUID, deviceID string) (*TokenPair, error) {
	access, err := g.generate(userID, deviceID, "access", g.accessTTL)
	if err != nil {
		return nil, fmt.Errorf("generate access token: %w", err)
	}

	refresh, err := g.generate(userID, deviceID, "refresh", g.refreshTTL)
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}

	return &TokenPair{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    int64(g.accessTTL.Seconds()),
	}, nil
}

func (g *Generator) generate(userID uuid.UUID, deviceID, use string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:   userID,
		DeviceID: deviceID,
		TokenUse: use,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			ID:        uuid.New().String(), // unique jti for blacklisting
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(g.secret)
}

// Validate 解析并校验令牌字符串，成功时返回其载荷。
func (g *Generator) Validate(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return g.secret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
}
