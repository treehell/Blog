// 构建期专用：带 shiki 高亮的文章渲染，并按 cid 缓存（列表页与详情页共用一次渲染结果）。
import { codeToHtml, bundledLanguages } from 'shiki';
import { getSite, postUrl } from './data';
import { renderMarkdown, type Rendered } from './markdown';
import type { Content } from './types';

async function highlight(code: string, lang: string) {
  return codeToHtml(code, {
    lang: lang in bundledLanguages ? lang : 'text',
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
}

const cache = new Map<number, Promise<Rendered>>();

export function renderContent(c: Content): Promise<Rendered> {
  let r = cache.get(c.cid);
  if (!r) {
    r = getSite().then((site) =>
      renderMarkdown(c.text, {
        siteUrl: site.options.site_url,
        highlight,
        resolvePost(key) {
          const p = site.findPost(key);
          return p && { title: p.title, url: postUrl(p), summary: p.summary };
        },
      }),
    );
    cache.set(c.cid, r);
  }
  return r;
}

/** 列表卡片用的封面：自定义封面优先，否则取正文第一张图。 */
export function coverOf(c: Content): string {
  if (c.cover) return c.cover;
  const inline = /!\[[^\]]*\]\((\S+?)(?:\s+"[^"]*")?\)/.exec(c.text)?.[1];
  if (inline) return inline;
  const ref = /!\[[^\]]*\]\[([^\]]+)\]/.exec(c.text)?.[1];
  if (ref) {
    const def = new RegExp(`^\\s*\\[${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]:\\s*(\\S+)`, 'm').exec(c.text);
    if (def) return def[1];
  }
  return '';
}
