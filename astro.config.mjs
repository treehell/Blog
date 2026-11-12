import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';

// 前台导航单独引用一份组件库（同一文件加 ?nav 查询串 = 另一个模块），
// 这样它只打包 TabBar 用到的代码，不会和后台用到的几十个组件合并进同一个共享包。
const lgNav = fileURLToPath(new URL('./node_modules/@ttqtt/liquid-glass-react/dist/index.js', import.meta.url)) + '?nav';

// 纯静态输出：同一份 dist 同时部署到 Cloudflare Pages 与 EdgeOne Pages。
// 动态部分（后台、评论、上传）走 functions/ 下的 /api/*。
export default defineConfig({
  site: process.env.SITE_URL || 'https://www.treemoe.cn',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    resolve: { alias: { '@lg-nav': lgNav } },
    server: { proxy: { '/api': 'http://127.0.0.1:8788' } },
  },
});
