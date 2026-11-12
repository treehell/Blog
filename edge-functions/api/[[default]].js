// EdgeOne Pages 边缘函数：把 /api/* 原样转发到 Cloudflare 那一份（数据只存在 D1 / R2 里）。
//
// 需要在 EdgeOne Pages 项目里设置环境变量：
//   API_ORIGIN    Cloudflare Pages 的地址，如 https://treemoe-blog.pages.dev
//   PROXY_SECRET  （可选，建议）与 Cloudflare 侧同名变量一致，用来把访客真实 IP 传给评论限流
//
// 注意：EdgeOne 边缘函数的请求体上限是 1MB，所以大文件上传请直接打开 Cloudflare 域名下的 /admin/。
// 这里只用纯 JavaScript（EdgeOne 边缘函数不支持 TypeScript，也不打包 npm 依赖）。

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function onRequest({ request, env }) {
  const origin = String((env && env.API_ORIGIN) || '').replace(/\/$/, '');
  if (!origin) return json({ error: '未配置 API_ORIGIN' }, 503);
  const url = new URL(request.url);
  if (url.pathname === '/api/health') return json({ ok: true, mode: 'proxy', origin });

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-forwarded-host', url.host);
  if (env.PROXY_SECRET) {
    headers.set('x-proxy-secret', env.PROXY_SECRET);
    headers.set('x-client-ip', (request.eo && request.eo.clientIp) || request.headers.get('eo-connecting-ip') || '');
  }
  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();

  try {
    const res = await fetch(origin + url.pathname + url.search, init);
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch (err) {
    return json({ error: '无法连接到 API 源站' }, 502);
  }
}
