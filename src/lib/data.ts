// 构建期数据源：优先从线上 API 拉取（CONTENT_API），失败则退回仓库里的快照。
// 这样首次部署（API/D1 还没建好）和 API 临时不可达时，站点都能正常构建。
import localSnapshot from '../data/snapshot.json';
import type { Content, Meta, Snapshot } from './types';

declare const process: { env: Record<string, string | undefined> };

let cache: Promise<Snapshot> | undefined;

async function load(): Promise<Snapshot> {
  const api = (process.env.CONTENT_API || import.meta.env.CONTENT_API || '').replace(/\/$/, '');
  if (api) {
    try {
      const res = await fetch(`${api}/api/export`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Snapshot;
      if (!Array.isArray(json.contents)) throw new Error('unexpected payload');
      console.log(`[data] 使用 ${api} 的线上内容（${json.contents.length} 条）`);
      return json;
    } catch (err) {
      console.warn(`[data] 拉取 ${api} 失败（${(err as Error).message}），退回本地快照`);
    }
  }
  return localSnapshot as unknown as Snapshot;
}

export function getSnapshot(): Promise<Snapshot> {
  return (cache ??= load());
}

export interface Site {
  options: Record<string, string>;
  posts: Content[];
  pages: Content[];
  navPages: Content[];
  categories: Meta[];
  tags: Meta[];
  metasOf(cid: number): { categories: Meta[]; tags: Meta[] };
  postsOf(mid: number): Content[];
  findPost(slugOrCid: string): Content | undefined;
}

let siteCache: Promise<Site> | undefined;

export function getSite(): Promise<Site> {
  return (siteCache ??= getSnapshot().then((snap) => {
    const posts = snap.contents.filter((c) => c.type === 'post' && c.status === 'publish').sort((a, b) => b.created - a.created);
    const pages = snap.contents.filter((c) => c.type === 'page' && c.status !== 'draft').sort((a, b) => a.sort_order - b.sort_order);
    const published = new Set(posts.map((p) => p.cid));
    const metaById = new Map(snap.metas.map((m) => [m.mid, { ...m, count: 0 }]));
    const byCid = new Map<number, Meta[]>();
    const byMid = new Map<number, number[]>();
    for (const [cid, mid] of snap.relationships) {
      const meta = metaById.get(mid);
      if (!meta || !published.has(cid)) continue;
      meta.count!++;
      (byCid.get(cid) ?? byCid.set(cid, []).get(cid)!).push(meta);
      (byMid.get(mid) ?? byMid.set(mid, []).get(mid)!).push(cid);
    }
    const metas = [...metaById.values()].sort((a, b) => a.sort_order - b.sort_order || a.mid - b.mid);
    return {
      options: snap.options,
      posts,
      pages,
      navPages: pages.filter((p) => p.status === 'publish'),
      categories: metas.filter((m) => m.type === 'category'),
      tags: metas.filter((m) => m.type === 'tag'),
      metasOf(cid) {
        const all = byCid.get(cid) ?? [];
        return { categories: all.filter((m) => m.type === 'category'), tags: all.filter((m) => m.type === 'tag') };
      },
      postsOf(mid) {
        const ids = new Set(byMid.get(mid) ?? []);
        return posts.filter((p) => ids.has(p.cid));
      },
      findPost(key) {
        return posts.find((p) => p.slug === key) ?? posts.find((p) => String(p.cid) === key);
      },
    };
  }));
}

export const postUrl = (p: Pick<Content, 'slug'>) => `/archives/${encodeURIComponent(p.slug)}/`;
export const pageUrl = (p: Pick<Content, 'slug'>) => `/${encodeURIComponent(p.slug)}/`;
export const metaUrl = (m: Pick<Meta, 'type' | 'slug'>) => `/${m.type}/${encodeURIComponent(m.slug)}/`;

/** Typecho 的分类名形如「旅行日志-树萌的游记」，卡片上只显示短名。 */
export const shortName = (name: string) => name.split('-')[0];

export function formatDate(ts: number, style: 'full' | 'short' = 'full') {
  const d = new Date((ts + 8 * 3600) * 1000); // 固定按北京时间显示，构建机时区不影响结果
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return style === 'short' ? `${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}` : `${y}年${m}月${day}日`;
}
export const isoDate = (ts: number) => new Date(ts * 1000).toISOString();
export const yearOf = (ts: number) => new Date((ts + 8 * 3600) * 1000).getUTCFullYear();
