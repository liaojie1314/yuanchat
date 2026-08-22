// Package password 提供基于 bcrypt 的密码哈希与校验。
package password

import "golang.org/x/crypto/bcrypt"

const cost = 12 // bcrypt cost factor (2^12 iterations)

// Hash 返回密码的 bcrypt 哈希。
func Hash(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), cost)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// Verify 比对 bcrypt 哈希与明文密码是否匹配。
func Verify(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
