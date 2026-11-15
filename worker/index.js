// Cloudflare Worker 入口。
// 静态页面由 Workers Static Assets 直接返回（wrangler.toml 的 [assets]），不经过这里；
// 只有 /api/* 会先进入本 Worker（run_worker_first）。
import { handleApi } from './api.js';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
