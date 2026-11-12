import type { APIRoute } from 'astro';
import { getSite, postUrl, pageUrl, metaUrl } from '../lib/data';

export const GET: APIRoute = async () => {
  const site = await getSite();
  const base = site.options.site_url.replace(/\/$/, '');
  const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
  const urls: [string, string?][] = [
    ['/', site.posts[0] && day(site.posts[0].modified)],
    ...site.posts.map((p): [string, string] => [postUrl(p), day(p.modified)]),
    ...site.navPages.map((p): [string, string] => [pageUrl(p), day(p.modified)]),
    ...[...site.categories, ...site.tags].filter((m) => m.count).map((m): [string] => [metaUrl(m)]),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `<url><loc>${base}${u}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
