.PHONY: help dev build run lint test clean docker-up docker-down

APP_NAME    := yuanchat-server
BUILD_DIR   := ./bin
MAIN_PATH   := ./cmd/server
CONFIG_PATH := ./config/config.yaml

help: ## 显示帮助信息
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
	awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

dev: ## 开发模式运行（热重载需安装 air）
	@which air > /dev/null || (echo "Installing air..." && go install github.com/air-verse/air@latest)
	air -c .air.toml

build: ## 编译二进制
	@mkdir -p $(BUILD_DIR)
	CGO_ENABLED=0 go build -ldflags="-s -w" -o $(BUILD_DIR)/$(APP_NAME) $(MAIN_PATH)

run: build ## 编译并运行
	$(BUILD_DIR)/$(APP_NAME)

lint: ## 代码检查
	@which golangci-lint > /dev/null || (echo "Installing golangci-lint..." && go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest)
	golangci-lint run ./...

test: ## 运行测试
	go test -v -race -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out

test-short: ## 快速测试（跳过集成测试）
	go test -short ./...

tidy: ## 整理依赖
	go mod tidy
	go mod verify

docker-up: ## 启动依赖服务（PostgreSQL + Redis）
	docker compose -f ../deploy/docker-compose.yml up -d postgres redis

docker-down: ## 停止依赖服务
	docker compose -f ../deploy/docker-compose.yml down

db-migrate: ## 运行数据库迁移
	go run $(MAIN_PATH) migrate

clean: ## 清理构建产物
	rm -rf $(BUILD_DIR) coverage.out
