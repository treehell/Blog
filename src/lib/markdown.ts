// Markdown 渲染：构建期（文章页）与后台实时预览共用同一份实现。
// 兼容旧站 PureSuck 主题的短代码：PicGrid / collapsible-panel / window / alert / tabs / friend-card / github / post
import { Marked, type Tokens } from 'marked';

export interface TocItem {
  id: string;
  text: string;
  depth: number;
}

export interface RenderOptions {
  /** 站点地址，用于把指向本站的旧链接（/archives/x.html、/x.html）改写成新地址 */
  siteUrl?: string;
  /** 代码高亮（只在构建期注入，后台预览不加载 shiki） */
  highlight?: (code: string, lang: string) => Promise<string>;
  /** [post url="..."] 短代码用：按 slug 或 cid 查文章 */
  resolvePost?: (key: string) => { title: string; url: string; summary: string } | undefined;
}

export interface Rendered {
  html: string;
  toc: TocItem[];
  excerpt: string;
  words: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const GITHUB_ICON =
  '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.77-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 8 0"/></svg>';

/** 把指向本站的旧 Typecho 链接改成新地址；外链原样返回。 */
export function normalizeHref(href: string, siteUrl = ''): { href: string; external: boolean } {
  let path = href;
  const m = /^https?:\/\/([^/]+)(\/.*)?$/i.exec(href);
  if (m) {
    const host = m[1].toLowerCase().replace(/^www\./, '');
    const own = siteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase().replace(/^www\./, '');
    if (!own || host !== own) return { href, external: true };
    path = m[2] || '/';
  } else if (!href.startsWith('/')) {
    return { href, external: /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(mailto|tel):/i.test(href) };
  }
  path = path.replace(/^\/index\.php(?=\/)/, '');
  let r = /^\/archives\/([^/?#]+?)(?:\.html|\/)?([?#].*)?$/.exec(path);
  if (r) return { href: `/archives/${r[1]}/${r[2] ?? ''}`, external: false };
  r = /^\/([^/?#.]+)\.html([?#].*)?$/.exec(path);
  if (r) return { href: `/${r[1]}/${r[2] ?? ''}`, external: false };
  return { href: path, external: false };
}

function guessLang(code: string): string {
  const s = code.trim();
  if (/^[[{][\s\S]*[\]}]$/.test(s) && /"\s*:/.test(s)) return 'jsonc';
  if (/\b(location|fastcgi_\w+|server_name|proxy_pass)\b/.test(s)) return 'nginx';
  if (/@font-face|^[.#]?[\w-]+\s*\{[\s\S]*:[\s\S]*\}/m.test(s)) return 'css';
  if (/^<(!doctype|link|script|div|html)\b/im.test(s)) return 'html';
  if (/^\s*(pip|npm|pnpm|wget|curl|sudo|apt|git|cd|docker|wrangler)\s/m.test(s)) return 'bash';
  if (/^\[[\w.-]+\]\s*$/m.test(s) && /^\s*[\w.-]+\s*=/m.test(s)) return 'ini';
  return 'text';
}

/** 短代码 → HTML 块。块级短代码两侧留空行，让里面的 Markdown（含文末的引用式链接）仍由同一次解析处理。 */
function shortcodes(src: string, opts: RenderOptions): string {
  const B = '\n\n';
  let tabGroup = 0;
  let tabFresh = false;
  // 围栏代码块里的内容不做替换
  return src
    .split(/(^```[\s\S]*?^```[^\n]*$)/m)
    .map((part, i) => {
      if (i % 2) return part;
      return part
        .replace(/\[PicGrid\]/gi, `${B}<div class="pic-grid">${B}`)
        .replace(/\[\/PicGrid\]/gi, `${B}</div>${B}`)
        .replace(/\[collapsible-panel title="([^"]*)"\]/g, (_, t) => `${B}<details class="panel"><summary>${esc(t)}</summary><div class="panel-body">${B}`)
        .replace(/\[\/collapsible-panel\]/g, `${B}</div></details>${B}`)
        .replace(/\[window type="([^"]*)" title="([^"]*)"\]/g, (_, type, t) => `${B}<div class="window" data-type="${esc(type)}"><div class="window-title">${esc(t)}</div><div class="window-body">${B}`)
        .replace(/\[\/window\]/g, `${B}</div></div>${B}`)
        .replace(/\[alert type="([^"]*)"\]/g, (_, type) => `${B}<div class="alert" data-type="${esc(type)}">${B}`)
        .replace(/\[\/alert\]/g, `${B}</div>${B}`)
        .replace(/\[tabs\]/g, () => {
          tabGroup++;
          tabFresh = true;
          return `${B}<div class="tabs">${B}`;
        })
        .replace(/\[tab title="([^"]*)"\]/g, (_, t) => {
          const open = tabFresh ? ' open' : '';
          tabFresh = false;
          return `${B}<details name="tabs-${tabGroup}"${open}><summary>${esc(t)}</summary><div class="tab-body">${B}`;
        })
        .replace(/\[\/tab\]/g, `${B}</div></details>${B}`)
        .replace(/\[\/tabs\]/g, `${B}</div>${B}`)
        .replace(
          /\[friend-card name="([^"]*)" ico="([^"]*)" url="([^"]*)"\]([\s\S]*?)\[\/friend-card\]/g,
          (_, name, ico, url, desc) =>
            `<a class="friend-card" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(ico)}" alt="" width="48" height="48" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="fc-text"><strong>${esc(name)}</strong><span>${esc(desc.trim())}</span></span></a>`,
        )
        .replace(/\[github\s+url="([^"]+)"\s*\]/gi, (_, url) => {
          const repo = url.replace(/^https?:\/\/github\.com\//i, '').replace(/\/$/, '');
          return `<a class="gh-card" href="${esc(url)}" target="_blank" rel="noopener">${GITHUB_ICON}<span class="gh-text"><strong>${esc(repo)}</strong><span>GitHub 仓库</span></span></a>`;
        })
        .replace(/\[post\s+url="([^"]+)"\s*\]/gi, (_, url) => {
          const { href } = normalizeHref(url, opts.siteUrl);
          const key = decodeURIComponent(/^\/archives\/([^/]+)\//.exec(href)?.[1] ?? '');
          const post = key ? opts.resolvePost?.(key) : undefined;
          return `<a class="post-card" href="${esc(post?.url ?? href)}"><strong>${esc(post?.title ?? href)}</strong>${post?.summary ? `<span>${esc(post.summary)}</span>` : ''}</a>`;
        });
    })
    .join('');
}

const plain = (html: string) =>
  html
    .replace(/<(pre|style|script)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

export async function renderMarkdown(src: string, opts: RenderOptions = {}): Promise<Rendered> {
  const toc: TocItem[] = [];
  const usedIds = new Set<string>();
  let images = 0;

  const marked = new Marked({
    gfm: true,
    breaks: true, // 与 Typecho 一致：单个换行即 <br>
    async: true,
    async walkTokens(token) {
      if (token.type === 'code' && opts.highlight) {
        const t = token as Tokens.Code & { html?: string };
        const lang = (t.lang || '').trim().split(/\s+/)[0] || guessLang(t.text);
        try {
          t.html = await opts.highlight(t.text, lang);
        } catch {
          /* 未知语言等情况：退回纯文本 */
        }
      }
    },
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = plain(inner);
        let id = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
        for (let n = 2, base = id; usedIds.has(id); n++) id = `${base}-${n}`;
        usedIds.add(id);
        if (depth <= 3) toc.push({ id, text, depth });
        return `<h${depth} id="${esc(id)}">${inner}</h${depth}>\n`;
      },
      image({ href, title, text }) {
        // 首图大概率在首屏，立即加载；其余懒加载
        const first = images++ === 0;
        const attrs = first ? 'fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"';
        return `<img src="${esc(href)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''} ${attrs}>`;
      },
      paragraph({ tokens }) {
        const meaningful = tokens.filter((t) => !(t.type === 'br' || (t.type === 'text' && !t.raw.trim())));
        if (meaningful.length && meaningful.every((t) => t.type === 'image')) {
          if (meaningful.length === 1) {
            const img = meaningful[0] as Tokens.Image;
            const caption = img.text && !/^\d+$/.test(img.text) ? `<figcaption>${esc(img.text)}</figcaption>` : '';
            return `<figure>${this.parser.parseInline([img])}${caption}</figure>\n`;
          }
          return `<p class="imgs">${this.parser.parseInline(meaningful)}</p>\n`;
        }
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
      link({ href, title, tokens }) {
        const n = normalizeHref(href, opts.siteUrl);
        const ext = n.external ? ' target="_blank" rel="noopener"' : '';
        return `<a href="${esc(n.href)}"${title ? ` title="${esc(title)}"` : ''}${ext}>${this.parser.parseInline(tokens)}</a>`;
      },
      code(token) {
        const t = token as Tokens.Code & { html?: string };
        return (t.html ?? `<pre><code>${esc(t.text)}</code></pre>`) + '\n';
      },
      table(token) {
        const cell = (c: Tokens.TableCell, tag: string) => `<${tag}${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const head = `<tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr>`;
        const body = token.rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('');
        return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>\n`;
      },
    },
  });

  const html = await marked.parse(shortcodes(src.replace(/\r\n/g, '\n'), opts));
  const text = plain(html);
  const cjk = (text.match(/[㐀-鿿぀-ヿ]/g) || []).length;
  const latin = (text.replace(/[㐀-鿿぀-ヿ]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return { html, toc, excerpt: text.slice(0, 140), words: cjk + latin };
}
