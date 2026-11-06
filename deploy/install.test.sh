#!/usr/bin/env bash
# 在临时目录执行真实安装脚本，所有外部命令均隔离，不连接 Docker、网络或生产环境。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/deploy/nginx" "$WORK/deploy/coturn"
cp "$SCRIPT_DIR/install.sh" "$SCRIPT_DIR/.env.prod.example" "$WORK/deploy/"
cp "$SCRIPT_DIR/nginx/nginx.conf.template" "$WORK/deploy/nginx/"
cp "$SCRIPT_DIR/coturn/turnserver.prod.conf.template" "$WORK/deploy/coturn/"
export INSTALL_TEST_LOG="$WORK/calls"

# Docker 替身只记录证书邮箱和管理员账号，不记录生成的凭据。
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == 'volume inspect yuanchat_certbot_conf' ]]; then exit 1; fi
if [[ "$*" == *'/app/genvapid'* ]]; then
  printf 'VAPID_PUBLIC_KEY=test-public\nVAPID_PRIVATE_KEY=test-private\n'
fi
if [[ "$*" == *'ps yuanchat-server'* ]]; then printf 'healthy\n'; fi
if [[ "$*" == *'/app/bootstrap-admin'* ]]; then
  printf 'bootstrap:%s\n' "${ADMIN_EMAIL:-}" >> "$INSTALL_TEST_LOG"
fi
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == '--email' ]]; then
    printf 'certificate:%s\n' "$2" >> "$INSTALL_TEST_LOG"
    break
  fi
  shift
done
STUB
cat > "$WORK/bin/openssl" <<'STUB'
#!/usr/bin/env bash
printf 'testonlyabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\n'
STUB
cat > "$WORK/bin/envsubst" <<'STUB'
#!/usr/bin/env bash
cat
STUB
cat > "$WORK/bin/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
cat > "$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
exit 91
STUB
chmod +x "$WORK/bin/"*
export PATH="$WORK/bin:$PATH"

fail() { printf '安装配置回归失败：%s\n' "$*" >&2; exit 1; }
run_install() {
  DOMAIN_CHAT=chat.test.invalid DOMAIN_API=api.test.invalid DOMAIN_WS=ws.test.invalid \
  DOMAIN_ADMIN=admin.test.invalid DOMAIN_STORAGE=storage.test.invalid PUBLIC_IP=203.0.113.10 \
  LE_EMAIL="$1" ADMIN_EMAIL="$2" \
    bash "$WORK/deploy/install.sh" > "$WORK/output" 2>&1 \
    || fail '安装脚本未完成'
}
assert_calls() {
  [[ "$(grep -c '^certificate:ops@test.invalid$' "$INSTALL_TEST_LOG")" == 5 ]] \
    || fail '五个证书没有统一使用持久化 LE_EMAIL'
  [[ "$(grep -c '^bootstrap:login@test.invalid$' "$INSTALL_TEST_LOG")" == 1 ]] \
    || fail '管理员引导没有使用持久化 ADMIN_EMAIL'
}

# 首次环境变量注入必须生成两个独立键，而不是生成/读取时各挑一条同名 ADMIN_EMAIL。
run_install ops@test.invalid login@test.invalid
[[ "$(grep -c '^LE_EMAIL=' "$WORK/deploy/.env")" == 1 ]] || fail 'LE_EMAIL 未单独写入配置'
[[ "$(grep -c '^ADMIN_EMAIL=' "$WORK/deploy/.env")" == 1 ]] || fail 'ADMIN_EMAIL 存在重复定义'
grep -qx 'LE_EMAIL=ops@test.invalid' "$WORK/deploy/.env" || fail '证书邮箱保存错误'
grep -qx 'ADMIN_EMAIL=login@test.invalid' "$WORK/deploy/.env" || fail '管理员账号保存错误'
assert_calls

# 重跑应读取已有配置，不受新环境变量里的不同邮箱干扰。
: > "$INSTALL_TEST_LOG"
run_install override-ops@test.invalid override-login@test.invalid
assert_calls

# 管理员账号允许留空并跳过引导，不应影响证书联系邮箱校验。
sed -i 's/^ADMIN_EMAIL=.*/ADMIN_EMAIL=/' "$WORK/deploy/.env"
: > "$INSTALL_TEST_LOG"
run_install override-ops@test.invalid override-login@test.invalid
[[ "$(grep -c '^certificate:ops@test.invalid$' "$INSTALL_TEST_LOG")" == 5 ]] \
  || fail '管理员留空影响证书邮箱'
if grep -q '^bootstrap:' "$INSTALL_TEST_LOG"; then fail '管理员留空仍执行引导'; fi
printf '安装邮箱配置回归通过（首次生成、重跑读取、跳过管理员）\n'
