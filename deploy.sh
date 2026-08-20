#!/usr/bin/env bash
# ==============================================================================
# cf-docker-worker 独立部署与安全凭据管理向导
# ==============================================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

cd "$(dirname "$0")"

# ── 1. 检查并引导安装 wrangler ──
check_wrangler() {
  if command -v wrangler >/dev/null 2>&1; then
    WRANGLER_BIN="wrangler"
  elif [ -f "./node_modules/.bin/wrangler" ]; then
    WRANGLER_BIN="./node_modules/.bin/wrangler"
  else
    echo -e "${YELLOW}${BOLD}⚠️  未检测到 Wrangler CLI 运行环境${NC}"
    echo "Wrangler 是 Cloudflare Workers 官方的部署与密钥管理工具。"
    echo ""
    echo "请选择安装方式:"
    echo -e "  ${GREEN}1)${NC} 本地安装 (推荐，执行 npm install 到当前项目)"
    echo -e "  ${GREEN}2)${NC} 全局安装 (执行 npm install -g wrangler)"
    echo -e "  ${RED}q)${NC} 退出"
    echo ""
    read -p "请输入选项 [1-2 / q]: " install_choice
    case $install_choice in
      1)
        echo -e "${CYAN}正在本地安装 wrangler...${NC}"
        npm install
        WRANGLER_BIN="./node_modules/.bin/wrangler"
        ;;
      2)
        echo -e "${CYAN}正在全局安装 wrangler...${NC}"
        npm install -g wrangler
        WRANGLER_BIN="wrangler"
        ;;
      *)
        echo -e "${RED}已取消安装，退出向导。${NC}"
        exit 1
        ;;
    esac
  fi
}

# ── 2. 检查并引导配置 .env 凭据 ──
check_env_credentials() {
  if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
  fi

  if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo -e "${CYAN}${BOLD}"
    echo "================================================================="
    echo "              🔑 Cloudflare API 凭据配置向导                     "
    echo "================================================================="
    echo -e "${NC}"
    echo -e "检测到本地尚未配置 ${YELLOW}CLOUDFLARE_API_TOKEN${NC}。"
    echo -e "请前往 Cloudflare 控制台创建并获取 API 令牌 (需具备 Edit Cloudflare Workers 权限):"
    echo -e "${CYAN}👉 https://dash.cloudflare.com/profile/api-tokens${NC}"
    echo ""
    read -p "请输入您的 CLOUDFLARE_API_TOKEN: " input_token
    read -p "请输入您的 CLOUDFLARE_ACCOUNT_ID (可选，可在 CF 域名主页右下角找到): " input_acc_id

    if [ -n "$input_token" ]; then
      cat <<EOF > .env
CLOUDFLARE_API_TOKEN=${input_token}
CLOUDFLARE_ACCOUNT_ID=${input_acc_id}
EOF
      export CLOUDFLARE_API_TOKEN="$input_token"
      export CLOUDFLARE_ACCOUNT_ID="$input_acc_id"
      echo ""
      echo -e "${GREEN}✅ 凭据已安全保存至本地 .env 文件中！${NC}"
      echo -e "${YELLOW}💡 提示: .env 已被 .gitignore 忽略，绝不会上传到 GitHub 公开仓库。${NC}"
      echo ""
    else
      echo -e "${RED}❌ 未输入 API Token，无法继续执行 Cloudflare 远程操作。${NC}"
      exit 1
    fi
  fi
}

# ── 运行环境检查 ──
check_wrangler
check_env_credentials

# ── 3. 主操作菜单 ──
print_header() {
  clear 2>/dev/null || true
  echo -e "${CYAN}${BOLD}"
  echo "================================================================="
  echo "       CF Docker Worker 多源镜像加速代理 部署与配置向导          "
  echo "================================================================="
  echo -e "${NC}"
}

print_header

echo -e "${BOLD}请选择操作:${NC}"
echo -e "  ${GREEN}1)${NC} 🚀 本地一键部署 Worker 到 Cloudflare ($WRANGLER_BIN deploy)"
echo -e "  ${GREEN}2)${NC} 🔑 配置 / 轮换 私有防护密钥 (SECRET_TOKEN)"
echo -e "  ${GREEN}3)${NC} 🐳 配置 / 轮换 Docker Hub 账户凭据 (DOCKERHUB_USER / TOKEN)"
echo -e "  ${GREEN}4)${NC} 📋 查看本地 Docker daemon.json 配置模板"
echo -e "  ${RED}q)${NC} 🚪 退出"
echo ""
read -p "请输入选项 [1-4 / q]: " choice

case $choice in
  1)
    echo ""
    echo -e "${CYAN}正在部署 cf-docker-worker...${NC}"
    $WRANGLER_BIN deploy
    echo -e "\n${GREEN}✅ 部署完成！${NC}"
    ;;
  2)
    echo ""
    echo -e "${CYAN}--- 设置私有防护密钥 (SECRET_TOKEN) ---${NC}"
    echo -e "提示: 密钥将用于防盗刷校验 (如 https://docker.yourdomain.com/v2/<TOKEN>/)"
    read -p "请输入新的 SECRET_TOKEN: " secret_val
    if [ -n "$secret_val" ]; then
      echo "$secret_val" | $WRANGLER_BIN secret put SECRET_TOKEN
      echo -e "${GREEN}✅ SECRET_TOKEN 已成功加密保存到 Cloudflare！${NC}"
    else
      echo -e "${RED}输入为空，已取消。${NC}"
    fi
    ;;
  3)
    echo ""
    echo -e "${CYAN}--- 配置 Docker Hub 凭据 (防止 429 限流) ---${NC}"
    read -p "请输入 Docker Hub 用户名: " dh_user
    read -p "请输入 Docker Hub 只读 Access Token: " dh_token
    if [ -n "$dh_user" ] && [ -n "$dh_token" ]; then
      echo "$dh_user" | $WRANGLER_BIN secret put DOCKERHUB_USER
      echo "$dh_token" | $WRANGLER_BIN secret put DOCKERHUB_TOKEN
      echo -e "${GREEN}✅ Docker Hub 凭据已加密保存！${NC}"
    else
      echo -e "${RED}输入不完整，已取消。${NC}"
    fi
    ;;
  4)
    echo ""
    echo -e "${CYAN}--- Docker daemon.json 配置说明 ---${NC}"
    echo -e "在 macOS (Docker Desktop / OrbStack) 或 Linux /etc/docker/daemon.json 中配置:"
    echo -e "${YELLOW}"
    echo "{"
    echo '  "registry-mirrors": ['
    echo '    "https://docker.yourdomain.com/v2/<你的SECRET_TOKEN>/"'
    echo "  ]"
    echo "}"
    echo -e "${NC}"
    ;;
  q|Q)
    exit 0
    ;;
  *)
    echo -e "${RED}无效选项。${NC}"
    ;;
esac
