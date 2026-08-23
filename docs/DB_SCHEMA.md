# 03 — 数据库设计

> **前置阅读**：[ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 一、PostgreSQL 表设计

### 1.1 users — 用户表

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           VARCHAR(20) UNIQUE,           -- 手机号（可选）
    email           VARCHAR(255) UNIQUE,          -- 邮箱（可选）
    password_hash   VARCHAR(255) NOT NULL,        -- bcrypt 哈希
    nickname        VARCHAR(50) NOT NULL,         -- 昵称
    avatar_url      VARCHAR(500),                 -- 头像 URL
    bio             VARCHAR(500),                 -- 个人简介
    gender          SMALLINT DEFAULT 0,           -- 0=未知 1=男 2=女
    birthday        DATE,
    status          SMALLINT DEFAULT 1,           -- 1=正常 2=禁用 3=注销
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_nickname ON users USING gin(nickname gin_trgm_ops);
```

### 1.2 user_devices — 用户设备表

```sql
CREATE TABLE user_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name     VARCHAR(100),                -- 设备名称
    device_type     SMALLINT NOT NULL,           -- 1=Web 2=Desktop 3=Android 4=iOS
    push_token      VARCHAR(500),                -- 推送 Token
    last_online_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_devices_user ON user_devices(user_id);
```

### 1.3 contacts — 联系人关系表

```sql
CREATE TABLE contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    remark          VARCHAR(50),                 -- 备注名
    status          SMALLINT DEFAULT 0,          -- 0=待确认 1=已添加 2=已拒绝 3=已删除
    source          VARCHAR(50),                 -- 来源（搜索/群组/二维码）
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, contact_user_id)
);

CREATE INDEX idx_contacts_user ON contacts(user_id);
CREATE INDEX idx_contacts_contact ON contacts(contact_user_id);
```

### 1.4 conversations — 会话表

```sql
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            SMALLINT NOT NULL,           -- 1=单聊 2=群聊 3=系统
    name            VARCHAR(100),                -- 会话名称（群聊时使用）
    avatar_url      VARCHAR(500),                -- 会话头像
    last_message_id UUID,                        -- 最后一条消息 ID
    last_seq        BIGINT DEFAULT 0,            -- 最后消息序列号
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
```

### 1.5 conversation_members — 会话成员表

```sql
CREATE TABLE conversation_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            SMALLINT DEFAULT 0,          -- 0=普通成员 1=管理员 2=群主
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_seq   BIGINT DEFAULT 0,            -- 最后已读序列号
    is_muted        BOOLEAN DEFAULT FALSE,       -- 是否免打扰
    UNIQUE(conversation_id, user_id)
);

CREATE INDEX idx_conv_members_user ON conversation_members(user_id);
CREATE INDEX idx_conv_members_conv ON conversation_members(conversation_id);
```

### 1.6 messages — 消息表

```sql
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id),
    seq             BIGINT NOT NULL,             -- 会话内递增序列号
    message_type    SMALLINT NOT NULL,           -- 1=文本 2=图片 3=文件 4=语音 5=视频 6=系统
    content         JSONB NOT NULL,              -- 消息内容（JSON 格式，便于扩展）
    status          SMALLINT DEFAULT 1,          -- 1=正常 2=已撤回 3=已删除
    reply_to_id     UUID REFERENCES messages(id),-- 引用/回复的消息
    client_msg_id   VARCHAR(64),                 -- 客户端幂等 ID
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(conversation_id, seq)
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, seq DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_created ON messages(created_at);
CREATE INDEX idx_messages_content ON messages USING gin(content);

-- 按月分区（可选，用于消息归档）
-- CREATE TABLE messages_2026_06 PARTITION OF messages
--     FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
```

### 1.7 message_status — 消息送达/已读状态表

```sql
CREATE TABLE message_status (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          SMALLINT NOT NULL,           -- 1=已发送 2=已送达 3=已读
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    UNIQUE(message_id, user_id)
);

CREATE INDEX idx_msg_status_user ON message_status(user_id, status);
```

### 1.8 files — 文件表

```sql
CREATE TABLE files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id     UUID NOT NULL REFERENCES users(id),
    file_name       VARCHAR(255) NOT NULL,
    file_size       BIGINT NOT NULL,             -- 字节
    mime_type       VARCHAR(100),
    file_type       SMALLINT NOT NULL,           -- 1=图片 2=文件 3=语音 4=视频
    storage_path    VARCHAR(500) NOT NULL,       -- MinIO 中的路径
    thumbnail_path  VARCHAR(500),                -- 缩略图路径（图片/视频）
    width           INT,                         -- 图片/视频宽度
    height          INT,                         -- 图片/视频高度
    duration        INT,                         -- 语音/视频时长（秒）
    md5_hash        VARCHAR(32),
    status          SMALLINT DEFAULT 1,          -- 1=正常 2=已过期 3=已删除
    expires_at      TIMESTAMPTZ,                 -- 过期时间
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_files_uploader ON files(uploader_id);
CREATE INDEX idx_files_type ON files(file_type);
```

### 1.9 groups — 群组表（扩展）

```sql
CREATE TABLE groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    avatar_url      VARCHAR(500),
    description     VARCHAR(500),
    notice          VARCHAR(1000),               -- 群公告
    max_members     INT DEFAULT 200,
    join_mode       SMALLINT DEFAULT 0,          -- 0=自由加入 1=审核 2=禁止加入
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.10 verification_codes — 验证码表

```sql
CREATE TABLE verification_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target          VARCHAR(255) NOT NULL,       -- 手机号或邮箱
    code            VARCHAR(10) NOT NULL,
    type            SMALLINT NOT NULL,           -- 1=注册 2=登录 3=重置密码
    expires_at      TIMESTAMPTZ NOT NULL,
    used            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vc_target_expires ON verification_codes(target, expires_at);
```

---

## 二、Redis 数据结构

### 2.1 在线状态

```
Key:   presence:{user_id}
Type:  Hash
TTL:   无
Value: {
    "status": 1,          // 1=在线 2=忙碌 3=离开 4=离线
    "last_seen": timestamp,
    "device_count": 2
}
```

### 2.2 用户 ↔ 设备映射

```
Key:   user:devices:{user_id}
Type:  Set
TTL:   无
Value: {"device_id_1", "device_id_2", ...}
```

### 2.3 WebSocket 连接映射

```
Key:   ws:connection:{connection_id}
Type:  Hash
TTL:   30分钟（心跳续期）
Value: {
    "user_id": "uuid",
    "device_id": "uuid",
    "device_type": 1,
    "connected_at": timestamp
}
```

### 2.4 离线消息队列

```
Key:   offline:messages:{user_id}:{device_id}
Type:  List
TTL:   7天
Value: 序列化的消息 JSON（最多保留 100 条）
```

### 2.5 Token 黑名单

```
Key:   token:blacklist:{jti}
Type:  String
TTL:   Token 剩余有效期
Value: "1"
```

### 2.6 速率限制

```
Key:   ratelimit:{action}:{user_id}:{window}
Type:  String (计数器)
TTL:   窗口时间
Value: 请求次数
```

### 2.7 最近消息缓存

```
Key:   messages:recent:{conversation_id}
Type:  ZSet (sorted by seq)
TTL:   1小时
Value: 序列化的消息 JSON（最多保留 50 条）
```

---

## 三、Elasticsearch 索引

### 3.1 消息搜索索引

```json
{
  "index": "yuanchat_messages",
  "mappings": {
    "properties": {
      "message_id": { "type": "keyword" },
      "conversation_id": { "type": "keyword" },
      "sender_id": { "type": "keyword" },
      "content_text": { "type": "text", "analyzer": "ik_max_word" },
      "message_type": { "type": "integer" },
      "file_name": { "type": "text" },
      "created_at": { "type": "date" }
    }
  }
}
```

---

## 四、MinIO 存储结构

```
yuanchat/
├── avatars/           # 用户头像
│   └── {user_id}/
│       └── avatar_{hash}.webp
├── images/            # 聊天图片
│   └── {year}/{month}/
│       ├── {file_id}.webp
│       └── {file_id}_thumb.webp
├── files/             # 聊天文件
│   └── {year}/{month}/
│       └── {file_id}_{original_name}
├── voices/            # 语音消息
│   └── {year}/{month}/
│       └── {file_id}.opus
├── videos/            # 视频消息
│   └── {year}/{month}/
│       ├── {file_id}.mp4
│       └── {file_id}_thumb.jpg
└── group_avatars/     # 群组头像
    └── {group_id}/
        └── avatar_{hash}.webp
```

---

> **下一步**：[CHAT_API.md](./CHAT_API.md) — 聊天 REST API 与 WebSocket 协议
