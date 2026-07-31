# 元聊 YuanChat 管理后台 — 独立镜像（不与 web 端同域部署）
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/desktop/package.json apps/desktop/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/design-system/package.json packages/design-system/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

ARG VITE_API_BASE_URL=https://api.yuanchat.example.com
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN pnpm --filter @yuanchat/admin build

FROM nginx:1.27-alpine

COPY --from=builder /repo/apps/admin/dist /usr/share/nginx/html
COPY deploy/nginx/spa.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://localhost/ >/dev/null || exit 1
