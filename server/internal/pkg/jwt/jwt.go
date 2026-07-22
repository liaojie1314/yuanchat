// Package jwt provides JWT token generation and validation.
//
// Uses Access Token (15min) + Refresh Token (7 days) dual-token pattern.
// Access tokens are short-lived and sent with every API request.
// Refresh tokens are long-lived and used only to obtain new access tokens.
package jwt

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Claims carries user identity in both access and refresh tokens.
type Claims struct {
	UserID   uuid.UUID `json:"uid"`
	DeviceID string    `json:"did"`
	TokenUse string    `json:"use"` // "access" or "refresh"
	jwt.RegisteredClaims
}

// TokenPair contains the generated access and refresh tokens.
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"` // seconds until access token expires
}

// Generator creates and validates JWT tokens.
type Generator struct {
	secret        []byte
	accessTTL     time.Duration
	refreshTTL    time.Duration
}

// NewGenerator creates a new JWT Generator.
func NewGenerator(secret string, accessTTL, refreshTTL time.Duration) *Generator {
	return &Generator{
		secret:     []byte(secret),
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
	}
}

// GeneratePair creates an access token and a refresh token for the given user.
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

// Validate parses and validates a JWT token string, returning the claims on success.
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
