import type { APIRoute } from 'astro';
import { getSite, postUrl, formatDate } from '../lib/data';
import { renderContent } from '../lib/render';

export const GET: APIRoute = async () => {
  const site = await getSite();
  const docs = await Promise.all(
    site.posts.map(async (p) => {
      const r = await renderContent(p);
      const body = r.html.replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return { t: p.title, u: postUrl(p), s: p.summary, d: formatDate(p.created), b: body.slice(0, 1500) };
    }),
  );
  return new Response(JSON.stringify(docs), { headers: { 'content-type': 'application/json; charset=utf-8' } });
};
