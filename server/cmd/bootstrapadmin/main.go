// bootstrapadmin 在首次部署时创建管理员账号。
//
// 管理后台没有注册入口 —— 部署完若库里没有管理员，就只能手工
// `UPDATE users SET role = 1`，等于把运维锁在门外。本命令由
// deploy/install.sh 在迁移之后调用一次，凭据取自 deploy/.env：
//
//	YUANCHAT_BOOTSTRAP_ADMIN_PHONE     管理员手机号（11 位）
//	YUANCHAT_BOOTSTRAP_ADMIN_PASSWORD  初始密码
//
// 幂等：库里已存在任一管理员时直接跳过并退出 0，**不会**改动既有账号的密码。
// 这条很重要 —— 否则每次 `install.sh` 重跑都把线上管理员密码重置回 .env 里那个值，
// 而 .env 常年躺在服务器上，等于给管理员留了一把永久后门。
//
// 用法：
//
//	go run ./cmd/bootstrapadmin
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/database"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/password"
	"github.com/yuanchat/server/internal/pkg/shortid"
)

func main() {
	phone := strings.TrimSpace(os.Getenv("YUANCHAT_BOOTSTRAP_ADMIN_PHONE"))
	pass := os.Getenv("YUANCHAT_BOOTSTRAP_ADMIN_PASSWORD")

	if phone == "" || pass == "" {
		// 缺凭据时不算失败：允许用户自行建号后手工提权，
		// 但要明确说出来，不能让人以为已经建好了。
		fmt.Println("跳过：未设置 YUANCHAT_BOOTSTRAP_ADMIN_PHONE / _PASSWORD")
		return
	}

	cfg, err := config.Load("config/config.yaml")
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	db, err := database.New(cfg.Database, zap.NewNop())
	if err != nil {
		log.Fatalf("db: %v", err)
	}

	ctx := context.Background()

	// 已有管理员就什么都不做（见包注释：避免重跑时重置线上密码）
	var admins int64
	if err := db.WithContext(ctx).Model(&model.User{}).
		Where("role = ?", model.RoleAdmin).Count(&admins).Error; err != nil {
		log.Fatalf("统计管理员失败: %v", err)
	}
	if admins > 0 {
		fmt.Printf("跳过：已存在 %d 个管理员账号\n", admins)
		return
	}

	hash, err := password.Hash(pass)
	if err != nil {
		log.Fatalf("哈希密码失败: %v", err)
	}

	// 手机号已被占用时提权而非新建：首次部署常有人先在 Web 端注册了再跑这条命令，
	// 此时新建会撞 phone 唯一索引直接失败。
	var existing model.User
	err = db.WithContext(ctx).Where("phone = ?", phone).First(&existing).Error
	if err == nil {
		if err := db.WithContext(ctx).Model(&existing).
			Update("role", model.RoleAdmin).Error; err != nil {
			log.Fatalf("提权失败: %v", err)
		}
		fmt.Printf("已将既有账号 %s 提权为管理员（密码保持原样，未改动）\n", phone)
		return
	}

	shortID, err := shortid.NewGenerator(db).Next(ctx)
	if err != nil {
		log.Fatalf("分配元聊号失败: %v", err)
	}

	user := &model.User{
		ID:           uuid.New(),
		ShortID:      shortID,
		Phone:        &phone,
		PasswordHash: hash,
		Nickname:     "管理员",
		Role:         model.RoleAdmin,
		Status:       model.UserStatusNormal,
	}
	if err := db.WithContext(ctx).Create(user).Error; err != nil {
		log.Fatalf("创建管理员失败: %v", err)
	}

	fmt.Printf("已创建管理员账号：手机号 %s，元聊号 %d\n", phone, shortID)
}
