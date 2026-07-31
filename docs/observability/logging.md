# 结构化日志聚合（B4）

> 后端 zap JSON 日志 → Promtail 采集 → Loki 存储 → Grafana 查询。

## 日志格式

生产模式（`env: production` 或 `log.format: json`）输出 JSON 一行一条：

```json
{
  "ts": "2026-07-26T18:52:08.704+0800",
  "level": "info",
  "msg": "request",
  "app": "yuanchat",
  "env": "development",
  "req_id": "2e0f6858-…",
  "method": "GET",
  "path": "/api/v1/health",
  "status": 200,
  "latency_ms": 0.086,
  "ip": "::1",
  "body_size": 43
}
```

### 规范字段

| 字段                         | 说明                                    |
| ---------------------------- | --------------------------------------- |
| `ts`                         | ISO8601 时间戳                          |
| `level`                      | debug / info / warn / error             |
| `msg`                        | 事件名（`request` / `server error` 等） |
| `app`                        | 固定 `yuanchat`（聚合筛选维度）         |
| `env`                        | development / staging / production      |
| `req_id`                     | X-Request-ID（客户端可传入，缺省生成）  |
| `user_id`                    | 已鉴权请求的用户 ID                     |
| `method` / `path` / `status` | 请求三元组                              |
| `latency_ms`                 | 处理耗时（毫秒，小数）                  |

panic 经 Recovery 中间件输出 `panic recovered` + 完整堆栈 + `req_id`/`user_id`。

## 本地启动日志栈

```bash
# 1. 后端以 JSON + 文件输出启动（promtail 采集 server/logs/）
YUANCHAT_LOG_FORMAT=json YUANCHAT_LOG_OUTPUT=file go run ./cmd/server

# 2. 起 Loki(:3102) + Promtail（grafana 复用主 compose 的 :3001）
docker compose -f deploy/docker-compose.yml -f deploy/logging.yml up -d
```

Grafana（`http://localhost:3001`，admin / yuanchat_dev）已自动 provision Loki 数据源。

## 查询示例（LogQL）

```logql
{app="yuanchat"} |= "error"                     # 全部错误相关日志
{job="server", level="warn"}                    # 4xx 客户端错误
{app="yuanchat"} | json | status >= 500         # 按解析后字段过滤 5xx
{app="yuanchat"} | json | req_id="<uuid>"       # 按请求 ID 串一条链路
{app="yuanchat"} | json | latency_ms > 200      # 慢请求
```

## 生产部署注意

- 容器化部署时 promtail 改用 docker service discovery（或 log driver 直推），
  不再挂载 `server/logs/` 目录
- Loki 数据保留策略在 `loki local-config` 中配置（当前默认无限期，
  生产按需加 retention）
