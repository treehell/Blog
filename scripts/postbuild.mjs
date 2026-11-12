// 构建后处理（astro build 之后自动执行）：
// 1. 前台页面：把样式按「这一页实际用到的选择器」裁剪后内联进 HTML。
//    组件库完整样式约 120KB，而前台只用到导航一个组件；裁剪后每页只剩十几 KB，
//    并且省掉一次阻塞渲染的 CSS 请求 —— 首屏只需要 HTML 这一个请求。
// 2. 生成 Cloudflare Pages 的 _redirects（旧 Typecho 链接 301 到新地址）与 _headers（缓存策略）。
// 后台 /admin/ 不做处理，仍然使用完整样式表。
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { PurgeCSS } from 'purgecss';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(dist);
const rel = (p) => relative(dist, p).replace(/\\/g, '/');
const htmlFiles = files.filter((f) => f.endsWith('.html') && !rel(f).startsWith('admin/'));

// 运行时才会出现的类名 / 属性在脚本里，所以每个页面引用到的脚本也要参与匹配。
// React 运行时本身不含样式相关字符串，跳过以免误保留；后台的脚本前台页面根本不会引用。
const RUNTIME = /\/(client|react|jsx-runtime|rolldown-runtime)\.[\w-]+\.js$/;
const jsCache = new Map();
function scriptsOf(html) {
  const refs = new Set([...html.matchAll(/\/_astro\/[\w.-]+\.js/g)].map((m) => m[0]).filter((r) => !RUNTIME.test(r)));
  return [...refs].map((ref) => {
    if (!jsCache.has(ref)) jsCache.set(ref, existsSync(join(dist, ref)) ? readFileSync(join(dist, ref), 'utf8') : '');
    return { raw: jsCache.get(ref), extension: 'js' };
  });
}

const cssCache = new Map();
const readCss = (href) => {
  if (!cssCache.has(href)) cssCache.set(href, readFileSync(join(dist, href), 'utf8'));
  return cssCache.get(href);
};

const LINK = /<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)"\s*\/?>/g;
let before = 0, after = 0, biggest = 0;

for (const file of htmlFiles) {
  let html = readFileSync(file, 'utf8');
  const hrefs = [...html.matchAll(LINK)].map((m) => m[1]);
  if (!hrefs.length) continue;
  const css = hrefs.map(readCss).join('\n');
  const [result] = await new PurgeCSS().purge({
    content: [{ raw: html, extension: 'html' }, ...scriptsOf(html)],
    css: [{ raw: css }],
    variables: true,
    keyframes: true,
    fontFace: true,
    // 属性选择器的值（data-lg-theme="dark" 等）也要参与匹配
    defaultExtractor: (content) => content.match(/[\w-/:.%@]+(?<!:)/g) || [],
    safelist: { standard: ['html', 'body', /^:root$/], deep: [/^shiki/], greedy: [/data-lg-theme/, /data-lg-contrast/], variables: [/^--lg-glass/, /^--shiki/] },
  });
  let first = true;
  html = html.replace(LINK, () => {
    if (!first) return '';
    first = false;
    return `<style>${result.css}</style>`;
  });
  writeFileSync(file, html);
  before += css.length;
  after += result.css.length;
  biggest = Math.max(biggest, gzipSync(html).length);
}

console.log(`[postbuild] 内联样式：${htmlFiles.length} 个页面，平均 ${(before / htmlFiles.length / 1024).toFixed(1)}KB → ${(after / htmlFiles.length / 1024).toFixed(1)}KB；最大的页面 gzip 后 ${(biggest / 1024).toFixed(1)}KB`);

// ---- _redirects：旧链接 → 新链接
const redirects = ['/feed /feed.xml 301', '/feed/ /feed.xml 301', '/index.php/* /:splat 301'];
for (const f of htmlFiles) {
  const m = /^(archives\/[^/]+|[^/]+)\/index\.html$/.exec(rel(f));
  if (!m || ['search', 'admin', 'page', 'category', 'tag'].includes(m[1])) continue;
  const path = '/' + m[1].split('/').map(encodeURIComponent).join('/');
  redirects.push(`${path}.html ${path}/ 301`);
}
writeFileSync(join(dist, '_redirects'), redirects.join('\n') + '\n');

// ---- _headers：带哈希的静态资源永久缓存；HTML 每次向边缘确认，发布后立即生效
writeFileSync(
  join(dist, '_headers'),
  `/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/admin/*
  X-Frame-Options: DENY
  X-Robots-Tag: noindex
`,
);
if (!existsSync(join(dist, 'admin'))) console.warn('[postbuild] 提示：dist/admin 不存在');
console.log(`[postbuild] 已生成 _redirects（${redirects.length} 条）与 _headers`);
