/**
 * Multi-Source Docker Registry Proxy for Cloudflare Workers
 * 
 * 功能特性：
 * 1. 多源支持：基于请求 Host 自动识别上游 (Docker Hub, GHCR, GCR, K8S, Quay)
 * 2. 安全防盗刷：支持路径 Secret Token 鉴权，非法请求统一 404 隐身
 * 3. 动态认证转换：支持 Docker V2 规范认证 challenge 与 token 自动换取
 * 4. Docker Hub 凭据注入：支持环境变量注入只读 Personal Access Token，避免 429 限流
 */

// ─── 1. 上游源与认证规范定义 ───
const REGISTRY_UPSTREAMS = {
  docker: {
    upstream: 'https://registry-1.docker.io',
    authUrl: 'https://auth.docker.io/token',
    service: 'registry.docker.io',
    isDockerHub: true,
  },
  ghcr: {
    upstream: 'https://ghcr.io',
    authUrl: 'https://ghcr.io/token',
    service: 'ghcr.io',
    isDockerHub: false,
  },
  gcr: {
    upstream: 'https://gcr.io',
    authUrl: 'https://gcr.io/v2/token',
    service: 'gcr.io',
    isDockerHub: false,
  },
  k8s: {
    upstream: 'https://registry.k8s.io',
    authUrl: 'https://registry.k8s.io/token',
    service: 'registry.k8s.io',
    isDockerHub: false,
  },
  quay: {
    upstream: 'https://quay.io',
    authUrl: 'https://quay.io/v2/auth',
    service: 'quay.io',
    isDockerHub: false,
  },
};

/**
 * 根据请求 Hostname 动态匹配目标 Registry (支持任意根域名)
 * 例如: ghcr.yourdomain.com -> ghcr, k8s.example.com -> k8s, 默认 -> docker
 */
function resolveUpstreamConfig(hostname) {
  const hostLower = hostname.toLowerCase();
  for (const [key, cfg] of Object.entries(REGISTRY_UPSTREAMS)) {
    if (hostLower.startsWith(key + '.') || hostLower === key) {
      return cfg;
    }
  }
  return REGISTRY_UPSTREAMS.docker;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const configuredSecret = (env.SECRET_TOKEN || '').trim();

    // ── 步骤 1：根路径与非法请求完全隐身 (404) ──
    if (url.pathname === '/' || url.pathname === '') {
      return new Response('Not Found', { status: 404 });
    }

    // ── 步骤 2：路径 Token 鉴权与路径还原 ──
    // 支持的合法路径形态：
    // 形态 A (带 Token 路径): /v2/<SECRET_TOKEN>/... 或 /<SECRET_TOKEN>/v2/...
    // 形态 B (带 Query Token): /v2/...?token=<SECRET_TOKEN>
    let rawPath = url.pathname;
    let isAuthenticated = false;

    if (!configuredSecret) {
      // 若未设置 SECRET_TOKEN，则默认放行（开放模式）
      isAuthenticated = true;
    } else {
      // 检查 Query 参数
      if (url.searchParams.get('token') === configuredSecret) {
        isAuthenticated = true;
        url.searchParams.delete('token');
      }

      // 检查路径前缀 /v2/<SECRET_TOKEN>/
      const tokenPrefixV2 = `/v2/${configuredSecret}/`;
      const tokenExactV2 = `/v2/${configuredSecret}`;
      const tokenPrefixRoot = `/${configuredSecret}/`;

      if (rawPath.startsWith(tokenPrefixV2)) {
        rawPath = '/v2/' + rawPath.slice(tokenPrefixV2.length);
        isAuthenticated = true;
      } else if (rawPath === tokenExactV2 || rawPath === tokenExactV2 + '/') {
        rawPath = '/v2/';
        isAuthenticated = true;
      } else if (rawPath.startsWith(tokenPrefixRoot)) {
        rawPath = '/' + rawPath.slice(tokenPrefixRoot.length);
        isAuthenticated = true;
      }
    }

    // 鉴权未通过，一律返回 404 隐身
    if (!isAuthenticated) {
      return new Response('Not Found', { status: 404 });
    }

    // ── 步骤 3：根据请求域名选择上游配置 ──
    const targetConfig = resolveUpstreamConfig(url.hostname);
    const upstreamUrl = new URL(targetConfig.upstream);

    // ── 步骤 4：处理 /v2/ 或 /v2 握手探活 ──
    if (rawPath === '/v2/' || rawPath === '/v2') {
      const authHeader = `Bearer realm="${targetConfig.authUrl}",service="${targetConfig.service}"`;
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Www-Authenticate': authHeader,
          'Docker-Distribution-Api-Version': 'registry/2.0',
        },
      });
    }

    // ── 步骤 5：处理 /token 或 Auth 请求代理（支持 Docker Hub 凭据注入）──
    if (rawPath.endsWith('/token') || rawPath.includes('/auth')) {
      const authTargetUrl = new URL(url.search, targetConfig.authUrl);
      const authHeaders = new Headers(request.headers);
      authHeaders.set('Host', new URL(targetConfig.authUrl).host);

      // 若为 Docker Hub 且配置了专属只读 Token，自动注入 Basic Auth
      if (targetConfig.isDockerHub && env.DOCKERHUB_USER && env.DOCKERHUB_TOKEN) {
        const credentials = btoa(`${env.DOCKERHUB_USER}:${env.DOCKERHUB_TOKEN}`);
        authHeaders.set('Authorization', `Basic ${credentials}`);
      }

      return fetch(authTargetUrl.toString(), {
        method: 'GET',
        headers: authHeaders,
      });
    }

    // ── 步骤 6：代理转发至真实 Registry 上游 ──
    const forwardUrl = new URL(rawPath + url.search, upstreamUrl);
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set('Host', upstreamUrl.host);

    // 复制并转发请求
    const response = await fetch(forwardUrl.toString(), {
      method: request.method,
      headers: forwardHeaders,
      body: request.body,
      redirect: 'follow',
    });

    // ── 步骤 7：响应头修正与重写（处理重定向与 Www-Authenticate）──
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Docker-Distribution-Api-Version', 'registry/2.0');

    // 如果上游返回 401 认证挑战，重写 realm 为当前 Worker 域名或官方认证端点
    if (response.status === 401 && responseHeaders.has('Www-Authenticate')) {
      const wwwAuth = responseHeaders.get('Www-Authenticate');
      const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
      if (realmMatch) {
        const realmUrl = realmMatch[1];
        // 保持 realm 指向官方认证端点
        responseHeaders.set(
          'Www-Authenticate',
          wwwAuth.replace(realmUrl, targetConfig.authUrl)
        );
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
