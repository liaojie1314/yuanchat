#!/usr/bin/env bash
# 后端构建脚本：设置 Go 工具链路径，拉依赖并编译全部包
set -e
export PATH=/home/liaojie1314/env/go/go/bin:$PATH
export GOPATH=/home/liaojie1314/env/go/GOPATH
cd "$(dirname "$0")/../server"
go get github.com/gorilla/websocket
echo "=== BUILD ==="
go build ./...
echo "=== VET ==="
go vet ./...
echo "=== TEST ==="
go test -race ./...
