# 元聊 YuanChat 后端 — 多阶段构建
#
# 产物为单一静态二进制（CGO_ENABLED=0），运行阶段用 alpine
# 以便自带 CA 证书（MinIO/推送服务的 HTTPS 调用需要）与时区数据。

# ---------- build ----------
FROM golang:1.25-alpine AS builder

WORKDIR /src

# 模块代理：默认官方源；网络受限地区可传
#   --build-arg GOPROXY=https://goproxy.cn,direct
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}

# 依赖层单独缓存：go.mod/go.sum 不变时跳过重新下载
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# -trimpath 去掉本机路径；ldflags -s -w 去符号表减小体积
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w -X main.version=${VERSION}" \
    -o /out/server ./cmd/server \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/migrate ./cmd/migrate

# ---------- runtime ----------
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata curl \
 && adduser -D -u 10001 yuanchat

WORKDIR /app

COPY --from=builder /out/server /app/server
COPY --from=builder /out/migrate /app/migrate
# 迁移 SQL 与默认配置随镜像分发（配置可被挂载/环境变量覆盖）
COPY --from=builder /src/internal/database/migrations /app/internal/database/migrations
COPY --from=builder /src/config/config.yaml /app/config/config.yaml

USER yuanchat

# REST 8085 / WebSocket 8086 / metrics 9090
EXPOSE 8085 8086 9090

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8085/api/v1/health || exit 1

ENTRYPOINT ["/app/server"]
