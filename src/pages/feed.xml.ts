import type { APIRoute } from 'astro';
import { getSite, postUrl } from '../lib/data';
import { renderContent } from '../lib/render';

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async () => {
  const site = await getSite();
  const o = site.options;
  const base = o.site_url.replace(/\/$/, '');
  const items = await Promise.all(
    site.posts.slice(0, 20).map(async (p) => {
      const r = await renderContent(p);
      const link = base + postUrl(p);
      // 全文输出；相对链接补成绝对地址
      const html = r.html.replace(/(href|src)="\/(?!\/)/g, `$1="${base}/`).replace(/]]>/g, ']]&gt;');
      return `<item><title>${x(p.title)}</title><link>${x(link)}</link><guid isPermaLink="true">${x(link)}</guid><pubDate>${new Date(p.created * 1000).toUTCString()}</pubDate><description>${x(p.summary || r.excerpt)}</description><content:encoded><![CDATA[${html}]]></content:encoded></item>`;
    }),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${x(o.title)}</title><link>${x(base)}/</link><description>${x(o.description)}</description><language>zh-CN</language>
<atom:link href="${x(base)}/feed.xml" rel="self" type="application/rss+xml"/>
${items.join('\n')}
</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
