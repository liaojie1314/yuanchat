// Package password provides bcrypt password hashing and verification.
package password

import "golang.org/x/crypto/bcrypt"

const cost = 12 // bcrypt cost factor (2^12 iterations)

// Hash returns a bcrypt hash of the password.
func Hash(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), cost)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// Verify compares a bcrypt hash with a plain text password.
func Verify(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
