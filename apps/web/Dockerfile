# 元聊 YuanChat Web 端 — 构建静态产物并用 nginx 托管
#
# API/WS 地址是构建期注入的（Vite 编译进包），故用 build args 传入，
# 由 deploy/install.sh 从 .env 读取域名后传递。

# ---------- build ----------
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /repo

# 依赖层缓存：先拷 manifest 再 install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/desktop/package.json apps/desktop/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/design-system/package.json packages/design-system/
# 跳过 husky（生产构建无 .git）与环境自检
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

ARG VITE_API_BASE_URL=https://api.yuanchat.example.com
ARG VITE_WS_URL=wss://ws.yuanchat.example.com
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_WS_URL=${VITE_WS_URL} \
    VITE_ENABLE_MOCK=false

RUN pnpm --filter @yuanchat/web build

# ---------- runtime ----------
FROM nginx:1.27-alpine

COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
COPY deploy/nginx/spa.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://localhost/ >/dev/null || exit 1
