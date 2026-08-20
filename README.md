# CF Docker Worker 🚀

基于 **Cloudflare Workers** 的私有 Docker Hub 镜像加速与反向代理服务，专为国内 Docker 客户端提供无感、高速、免改名的镜像拉取体验。

---

## 🌟 核心特性

- **原生零侵入体验**：
  - 作为 Docker Daemon 的标准 `registry-mirrors` 运行。
  - 客户端直接执行原生的 `docker pull nginx`、`docker pull redis`，**完全不需要修改镜像名称或加前缀**。
- **安全防盗刷保护**：
  - **路径 Secret Token 鉴权**：在镜像拉取路径中加入专属私有密钥（如 `/v2/<SECRET_TOKEN>/...`）。
  - **隐身防御**：未授权访问或非法探测统一返回空 `404 Not Found`，彻底隐藏服务指纹。
- **Docker Hub 凭据注入 (防 429)**：
  - 支持通过 Cloudflare Worker Secrets 注入只读 Personal Access Token，彻底规避共享 IP 频繁拉取触发的 429 限制。
- **CI/CD 自动化部署**：内置 GitHub Actions 工作流，代码推送即可自动部署。

---

## 💡 为什么本项目专注于 Docker Hub？（关于 GHCR / GCR / K8s 的说明）

在容器镜像分发规范中，Docker Registry 采用 **“元数据（Manifest）与实际镜像层（Blob）分离”** 的分布式架构：
1. **Docker Hub 的优势**：Docker Hub 的实际镜像层（Blob）托管在 **AWS CloudFront 全球 CDN**（`*.cloudfront.docker.com`）上。CloudFront 在国内各地区连通性良好且速度极快，因此通过 Worker 代理元数据后，客户端可以直接直连 CDN 全速下载镜像层，达到真正的免翻加速。
2. **不支持 GHCR / GCR / K8s / Quay 的原因**：
   - GitHub (GHCR) 的实际数据层托管在 `pkg-containers.githubusercontent.com`。
   - Google (GCR / K8s) 的实际数据层托管在 Google Cloud Storage。
   - 这些底层存储域名在国内直连网络下存在强力阻断或严重丢包，客户端即使能通过 Worker 获取元数据，也无法在直连状态下拉取到实际的数据层（Blob 会报连接超时）。
   - 因此，拉取第三方镜像源建议直接在代理环境下进行原生拉取，无需通过 Worker 二次转发。

---

## 🛠️ 快速开始

### 1. 仓库与环境变量准备
在 GitHub 仓库的 **Settings -> Secrets and variables -> Actions** 中添加以下两个部署凭据：
- `CLOUDFLARE_API_TOKEN`：Cloudflare API 令牌（需具备 Workers 编辑权限）
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID

### 2. 绑定自定义域名
在 Cloudflare Worker 控制台的 **Settings -> Triggers -> Custom Domains** 中绑定你的加速域名（例如 `docker.yourdomain.com`）。

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

重启 Docker 服务后，直接拉取官方镜像即可全速直连加速：
```bash
docker pull nginx:latest
docker pull redis:alpine
docker pull ubuntu:22.04
```

---

## 🌐 进阶网络分流优化

如果本地网络环境配置了分流策略管理，为了避免下载大体积镜像层时占用代理流量，建议将 Docker Hub 底层存储 CDN 域名配置为 **直接连接（DIRECT）**：

- `+.cloudfront.docker.com`
- `production.cloudfront.docker.com`

---

## 📄 开源许可证
[MIT License](LICENSE)
