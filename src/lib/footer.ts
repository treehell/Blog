// 页脚：整段 HTML 存在设置项 `footer` 里，后台可直接编辑；前台构建与后台编辑框共用这里的逻辑。
// 可用占位符：{year} 当前年份、{author} 作者名、{title} 站点名称、{cdn} 当前访问线路的徽标。
// 外观切换按钮不在其中——它依赖脚本，固定放在页脚末尾。

/** 还没保存过 `footer` 时，由旧的 footer_html（每行一个链接）拼出一份等价的默认页脚。 */
export function defaultFooter(o: Record<string, string>): string {
  const lines = (o.footer_html || '')
    // 单独一行的小图标并进它下一行的链接里，让图标和文字成为同一个链接
    .replace(/(<img\b[^>]*>)\s*\n\s*(<a\b[^>]*>)/gi, '$2$1')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const links = lines.length ? `<p>\n${lines.join('\n')}\n</p>\n` : '';
  return `${links}<p>&copy; 2025-{year} {author} · <a href="/feed.xml">RSS</a></p>\n${CDN_LINE}`;
}

const CDN_LINE = '<p>您现在正在透过 {cdn} 访问</p>';

export type Platform = 'cf' | 'eo';

const CDN_BADGE: Record<Platform, { src: string; alt: string; width: number }> = {
  cf: { src: 'https://oss.treemoe.cn/icon/cdn/cf.svg', alt: 'Cloudflare', width: 131 },
  eo: { src: 'https://oss.treemoe.cn/icon/cdn/eo.svg', alt: 'EdgeOne', width: 125 },
};

/** {cdn} 的内容。两个平台各自构建一份静态页面，所以在构建时就能确定是哪条线路，读者端零开销。 */
export const cdnBadge = (p: Platform) => {
  const b = CDN_BADGE[p];
  return `<img class="cdn-badge" src="${b.src}" alt="${b.alt}" width="${b.width}" height="20" loading="lazy" decoding="async">`;
};

export function renderFooter(o: Record<string, string>, platform: Platform, year = new Date().getFullYear()): string {
  let tpl = (o.footer || '').trim() || defaultFooter(o);
  if (!tpl.includes('{cdn}')) tpl += `\n${CDN_LINE}`; // 自定义页脚里没写 {cdn} 时，线路提示自动另起一行放在末尾
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return tpl
    .replace(/\{year\}/g, String(year))
    .replace(/\{author\}/g, esc(o.author || ''))
    .replace(/\{title\}/g, esc(o.title || ''))
    .replace(/\{cdn\}/g, cdnBadge(platform));
}
