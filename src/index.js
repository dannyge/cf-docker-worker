/**
 * Docker Hub Registry Proxy for Cloudflare Workers
 * 
 * 功能特性：
 * 1. 专为 Docker Hub 设计：完美适配 Docker Daemon 的 registry-mirrors 规范
 * 2. 安全防盗刷：支持路径 Secret Token 鉴权，非法请求统一 404 隐身
 * 3. 动态认证转换：支持 Docker V2 规范认证 challenge 与 token 自动换取
 * 4. 凭据注入 (防 429)：支持环境变量注入只读 Personal Access Token，避免匿名配额受限
 */

const DOCKER_HUB_UPSTREAM = 'https://registry-1.docker.io';
const DOCKER_AUTH_URL = 'https://auth.docker.io/token';
const DOCKER_SERVICE = 'registry.docker.io';

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

    const upstreamUrl = new URL(DOCKER_HUB_UPSTREAM);

    // ── 步骤 3：处理 /v2/ 或 /v2 握手探活 ──
    if (rawPath === '/v2/' || rawPath === '/v2') {
      const authHeader = `Bearer realm="${DOCKER_AUTH_URL}",service="${DOCKER_SERVICE}"`;
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Www-Authenticate': authHeader,
          'Docker-Distribution-Api-Version': 'registry/2.0',
        },
      });
    }

    // ── 步骤 4：处理 /token 或 Auth 请求代理（支持 Docker Hub 凭据注入）──
    if (rawPath.endsWith('/token') || rawPath.includes('/auth')) {
      const authTargetUrl = new URL(url.search, DOCKER_AUTH_URL);
      const authHeaders = new Headers(request.headers);
      authHeaders.set('Host', new URL(DOCKER_AUTH_URL).host);

      // 若配置了专属只读 Token，自动注入 Basic Auth
      if (env.DOCKERHUB_USER && env.DOCKERHUB_TOKEN) {
        const credentials = btoa(`${env.DOCKERHUB_USER}:${env.DOCKERHUB_TOKEN}`);
        authHeaders.set('Authorization', `Basic ${credentials}`);
      }

      return fetch(authTargetUrl.toString(), {
        method: 'GET',
        headers: authHeaders,
      });
    }

    // ── 步骤 5：代理转发至 Docker Hub 官方 Registry ──
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

    // ── 步骤 6：响应头修正与重写（处理重定向与 Www-Authenticate）──
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Docker-Distribution-Api-Version', 'registry/2.0');

    if (response.status === 401 && responseHeaders.has('Www-Authenticate')) {
      const wwwAuth = responseHeaders.get('Www-Authenticate');
      const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
      if (realmMatch) {
        const realmUrl = realmMatch[1];
        responseHeaders.set(
          'Www-Authenticate',
          wwwAuth.replace(realmUrl, DOCKER_AUTH_URL)
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
