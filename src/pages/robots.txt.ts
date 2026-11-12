import type { APIRoute } from 'astro';
import { getSite } from '../lib/data';

export const GET: APIRoute = async () => {
  const site = await getSite();
  const base = site.options.site_url.replace(/\/$/, '');
  return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
