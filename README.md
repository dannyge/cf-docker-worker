# CF Docker Worker 🚀

基于 **Cloudflare Workers** 的私有多源 Docker 镜像加速与反向代理服务，支持一键无感直连加速主流容器镜像仓库（Docker Hub、GitHub Container Registry、Google GCR、Kubernetes K8s、Quay）。

---

## 🌟 核心特性

- **多源一体化路由**：根据访问子域名自动路由至对应官方 Registry：
  - `docker.yourdomain.com` ──> `Docker Hub (registry-1.docker.io)`
  - `ghcr.yourdomain.com`   ──> `GitHub Container Registry (ghcr.io)`
  - `gcr.yourdomain.com`    ──> `Google Container Registry (gcr.io)`
  - `k8s.yourdomain.com`    ──> `Kubernetes Registry (registry.k8s.io)`
  - `quay.yourdomain.com`   ──> `RedHat Quay (quay.io)`
- **原生命令体验**：
  - Docker Hub 直接配置为 Docker 的 `registry-mirrors`，原生 `docker pull nginx` **完全免改名、免加前缀**。
  - 第三方镜像源（GHCR / GCR 等）配合本地 DNS 劫持即可实现原生免翻直连。
- **安全防盗刷保护**：
  - **路径 Secret Token 鉴权**：在镜像拉取路径中加入专属私有密钥（如 `/v2/<SECRET_TOKEN>/...`）。
  - **隐身防御**：未授权访问或非法探测统一返回空 `404 Not Found`，彻底隐藏服务指纹。
- **Docker Hub 凭据注入 (防 429)**：
  - 支持通过 Cloudflare Worker Secrets 注入只读 Personal Access Token，避免共享 IP 频繁拉取触发 429 限制。
- **CI/CD 自动化部署**：内置 GitHub Actions 工作流，代码推送即可自动部署。

---

## 🛠️ 快速开始

### 1. 仓库与环境变量准备
在 GitHub 仓库的 **Settings -> Secrets and variables -> Actions** 中添加以下两个部署凭据：
- `CLOUDFLARE_API_TOKEN`：Cloudflare API 令牌（需具备 Workers 编辑权限）
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID

### 2. 绑定自定义域名
在 Cloudflare Worker 控制台的 **Settings -> Triggers -> Custom Domains** 中绑定你的子域名（例如）：
- `docker.yourdomain.com`
- `ghcr.yourdomain.com`
- `gcr.yourdomain.com`
- `k8s.yourdomain.com`
- `quay.yourdomain.com`

### 3. 配置安全 Secrets
使用项目提供的管理脚本快速设置私有防护密钥：
```bash
./deploy.sh
```
- 选择 **2**：设置私有防护密钥 (`SECRET_TOKEN`)。
- 选择 **3**（可选）：配置 Docker Hub 只读 Token。

---

## 💻 客户端 Docker 配置

### Docker Hub 免改名加速配置
编辑 macOS (Docker Desktop / OrbStack) 或 Linux 服务器的 `/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": [
    "https://docker.yourdomain.com/v2/<你的SECRET_TOKEN>/"
  ]
}
```

重启 Docker 服务后，直接拉取官方镜像即可全速直连免翻加速：
```bash
docker pull nginx:latest
docker pull redis:alpine
docker pull ubuntu:22.04
```

### 第三方源拉取示例
```bash
docker pull ghcr.yourdomain.com/owner/repo:tag
docker pull k8s.yourdomain.com/coredns/coredns:v1.10.1
```

---

## 📄 开源许可证
[MIT License](LICENSE)
