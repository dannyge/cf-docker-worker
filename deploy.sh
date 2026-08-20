#!/usr/bin/env bash
# ==============================================================================
# cf-docker-worker 部署与安全凭据管理向导
# ==============================================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

cd "$(dirname "$0")"

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
echo -e "  ${GREEN}1)${NC} 🚀 本地一键部署 Worker 到 Cloudflare (wrangler deploy)"
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
    npx wrangler deploy
    echo -e "\n${GREEN}✅ 部署完成！${NC}"
    ;;
  2)
    echo ""
    echo -e "${CYAN}--- 设置私有防护密钥 (SECRET_TOKEN) ---${NC}"
    echo -e "提示: 密钥将用于防盗刷校验 (如 https://docker.yourdomain.com/v2/<TOKEN>/)"
    read -p "请输入新的 SECRET_TOKEN: " secret_val
    if [ -n "$secret_val" ]; then
      echo "$secret_val" | npx wrangler secret put SECRET_TOKEN
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
      echo "$dh_user" | npx wrangler secret put DOCKERHUB_USER
      echo "$dh_token" | npx wrangler secret put DOCKERHUB_TOKEN
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
