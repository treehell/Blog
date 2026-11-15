// /api/* —— 整个后端就是这一个文件，没有任何依赖。由 worker/index.js 调用。
//
// 只在 Cloudflare Workers 上运行：它绑定了 D1（DB）和 R2（BUCKET），是唯一的数据源。
// EdgeOne 那一侧由 edge-functions/api/[[default]].js 把 /api/* 原样转发过来，数据只有一份。
//
// 环境变量见 README「环境变量」一节。

const SESSION_DAYS = 7;
const MAX_UPLOAD = 25 * 1024 * 1024;

export async function handleApi(request, env, ctx) {
  if (!env.DB) return json({ error: '未绑定 D1 数据库（DB）' }, 503);
  try {
    return await route({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: '服务器内部错误' }, 500);
  }
}

// ───────────────────────── 路由 ─────────────────────────

async function route(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const m = request.method;
  const is = (method, ...path) => m === method && seg.length === path.length && path.every((p, i) => p === '*' || p === seg[i]);

  // 公开接口
  if (is('GET', 'health')) return json({ ok: true, mode: 'origin' });
  if (is('GET', 'export')) return json(await exportSnapshot(env));
  if (is('GET', 'comments')) return listPublicComments(env, url);
  if (is('POST', 'comments')) return createPublicComment(env, request);
  if (is('POST', 'auth', 'login')) return login(env, request);
  if (is('POST', 'auth', 'logout')) return json({ ok: true }, 200, { 'set-cookie': cookie(request, '', 0) });
  if (is('GET', 'auth', 'me')) return json({ user: await currentUser(env, request) });

  // 以下全部需要登录
  if (seg[0] !== 'admin') throw new HttpError(404, '接口不存在');
  const user = await currentUser(env, request);
  if (!user) throw new HttpError(401, '请先登录');
  if (m !== 'GET') await assertSameSite(env, request);
  const a = seg.slice(1);
  const at = (method, ...path) => m === method && a.length === path.length && path.every((p, i) => p === '*' || p === a[i]);

  if (at('GET', 'stats')) return json(await stats(env));
  if (at('GET', 'contents')) return listContents(env, url);
  if (at('POST', 'contents')) return saveContent(ctx, null, await body(request));
  if (at('GET', 'contents', '*')) return getContent(env, int(a[1]));
  if (at('PUT', 'contents', '*')) return saveContent(ctx, int(a[1]), await body(request));
  if (at('DELETE', 'contents', '*')) return deleteContent(ctx, int(a[1]));
  if (at('GET', 'metas')) return json({ metas: await allMetas(env) });
  if (at('POST', 'metas')) return saveMeta(env, null, await body(request));
  if (at('PUT', 'metas', '*')) return saveMeta(env, int(a[1]), await body(request));
  if (at('DELETE', 'metas', '*')) return deleteMeta(env, int(a[1]));
  if (at('GET', 'comments')) return listComments(env, url);
  if (at('POST', 'comments')) return replyComment(env, user, await body(request));
  if (at('PUT', 'comments', '*')) return updateComment(env, int(a[1]), await body(request));
  if (at('DELETE', 'comments', '*')) return run(env, 'DELETE FROM comments WHERE coid = ?1 OR parent = ?1', int(a[1]));
  if (at('GET', 'options')) return json({ options: await getOptions(env), env: publicEnv(env) });
  if (at('PUT', 'options')) return saveOptions(env, await body(request));
  if (at('POST', 'upload')) return upload(env, request);
  if (at('GET', 'media')) return listMedia(env, url);
  if (at('DELETE', 'media')) return deleteMedia(env, url);
  if (at('POST', 'localize')) return localize(env, await body(request));
  if (at('POST', 'deploy')) return json(await deploy(env));
  throw new HttpError(404, '接口不存在');
}

// ───────────────────────── 基础工具 ─────────────────────────

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
async function body(request) {
  try {
    const data = await request.json();
    if (data && typeof data === 'object') return data;
  } catch {
    /* fallthrough */
  }
  throw new HttpError(400, '请求体不是合法的 JSON');
}
function int(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, '参数不合法');
  return n;
}
const now = () => Math.floor(Date.now() / 1000);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
const first = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
async function run(env, sql, ...args) {
  await env.DB.prepare(sql).bind(...args).run();
  return json({ ok: true });
}

async function getOptions(env) {
  const rows = await all(env, 'SELECT name, value FROM options');
  return Object.fromEntries(rows.map((r) => [r.name, r.value]));
}

const cdnBase = (env) => (env.CDN_BASE || '').replace(/\/$/, '');
const publicEnv = (env) => ({
  cdnBase: cdnBase(env),
  r2: !!env.BUCKET,
  r2Hosts: hostList(env.R2_PUBLIC_HOSTS),
  deployHooks: hostList(env.DEPLOY_HOOKS).length,
});
const hostList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

// ───────────────────────── 登录与会话 ─────────────────────────

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
function secretOf(env) {
  if (!env.SESSION_SECRET || !env.ADMIN_PASSWORD) throw new HttpError(503, '后台未启用：请先设置 ADMIN_PASSWORD 与 SESSION_SECRET 两个密钥');
  return env.SESSION_SECRET;
}
function cookie(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function login(env, request) {
  const secret = secretOf(env);
  const { user, password } = await body(request);
  // 两边都先做 HMAC 再比较，避免按字符比较泄露长度/前缀
  const [a, b] = await Promise.all([hmac(secret, `${user}\n${password}`), hmac(secret, `${env.ADMIN_USER || 'admin'}\n${env.ADMIN_PASSWORD}`)]);
  if (a !== b) {
    await new Promise((r) => setTimeout(r, 600)); // 拖慢暴力尝试
    throw new HttpError(401, '用户名或密码不正确');
  }
  const payload = b64(enc.encode(JSON.stringify({ u: String(user), exp: now() + SESSION_DAYS * 86400 })));
  const token = `${payload}.${await hmac(secret, payload)}`;
  return json({ ok: true, user: String(user) }, 200, { 'set-cookie': cookie(request, token, SESSION_DAYS * 86400) });
}

async function currentUser(env, request) {
  if (!env.SESSION_SECRET) return null;
  const token = /(?:^|;\s*)session=([^;]+)/.exec(request.headers.get('cookie') || '')?.[1];
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || (await hmac(env.SESSION_SECRET, payload)) !== sig) return null;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return data.exp > now() ? data.u : null;
  } catch {
    return null;
  }
}

/** 写操作必须来自本站页面（防 CSRF）：Origin 要么与当前主机一致，要么是站点地址 / ALLOWED_ORIGINS 里的域名。 */
async function assertSameSite(env, request) {
  const origin = request.headers.get('origin');
  if (!origin) return; // 非浏览器调用（curl 等）不带 Origin，本身就拿不到 Cookie
  const host = new URL(origin).host;
  const allowed = new Set([new URL(request.url).host, request.headers.get('x-forwarded-host'), ...hostList(env.ALLOWED_ORIGINS).map((o) => o.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))]);
  if (allowed.has(host)) return;
  const site = (await first(env, "SELECT value FROM options WHERE name = 'site_url'"))?.value || '';
  const siteHost = site.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (siteHost && (host === siteHost || host === siteHost.replace(/^www\./, '') || `www.${host}` === siteHost)) return;
  throw new HttpError(403, '来源不被允许');
}

// ───────────────────────── 构建用的内容导出 ─────────────────────────

async function exportSnapshot(env) {
  const [options, contents, metas, relationships, counts] = await Promise.all([
    getOptions(env),
    all(env, "SELECT * FROM contents WHERE status != 'draft' ORDER BY created DESC"),
    allMetas(env),
    all(env, 'SELECT cid, mid FROM relationships'),
    all(env, "SELECT cid, COUNT(*) AS n FROM comments WHERE status = 'approved' GROUP BY cid"),
  ]);
  const n = Object.fromEntries(counts.map((c) => [c.cid, c.n]));
  return {
    generated: now(),
    options,
    contents: contents.map((c) => ({ ...c, comments: n[c.cid] || 0 })),
    metas,
    relationships: relationships.map((r) => [r.cid, r.mid]),
  };
}

// ───────────────────────── 评论（前台） ─────────────────────────

/** 访客 IP。经 EdgeOne 转发时，只有带着正确的 PROXY_SECRET 才采信它转交的 IP，否则任何人都能伪造。 */
function clientIp(env, request) {
  if (env.PROXY_SECRET && request.headers.get('x-proxy-secret') === env.PROXY_SECRET) return request.headers.get('x-client-ip') || '';
  return request.headers.get('cf-connecting-ip') || '';
}

async function listPublicComments(env, url) {
  const cid = int(url.searchParams.get('cid'));
  const comments = await all(env, "SELECT coid, parent, author, url, text, created, is_owner FROM comments WHERE cid = ? AND status = 'approved' ORDER BY created ASC", cid);
  return json({ comments }, 200, { 'cache-control': 'public, max-age=30' });
}

async function createPublicComment(env, request) {
  const b = await body(request);
  if (b.website) return json({ ok: true, status: 'pending' }); // 蜜罐字段：机器人才会填
  const author = str(b.author, 40), mail = str(b.mail, 100), text = str(b.text, 2000);
  let link = str(b.url, 200);
  if (!author || !text) throw new HttpError(400, '昵称和内容不能为空');
  if (!/^\S+@\S+\.\S+$/.test(mail)) throw new HttpError(400, '邮箱格式不正确');
  if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
  const cid = int(b.cid);
  const target = await first(env, "SELECT cid FROM contents WHERE cid = ? AND status = 'publish' AND allow_comment = 1", cid);
  if (!target) throw new HttpError(404, '文章不存在或已关闭评论');
  let parent = Number(b.parent) || 0;
  if (parent) {
    const p = await first(env, "SELECT coid, parent FROM comments WHERE coid = ? AND cid = ? AND status = 'approved'", parent, cid);
    if (!p) throw new HttpError(400, '回复的评论不存在');
    parent = p.parent || p.coid; // 只保留两层
  }
  const ip = clientIp(env, request);
  const last = ip && (await first(env, 'SELECT created FROM comments WHERE ip = ? ORDER BY created DESC LIMIT 1', ip));
  if (last && now() - last.created < 30) throw new HttpError(429, '评论太频繁了，请稍后再试');
  const opt = await first(env, "SELECT value FROM options WHERE name = 'comment_moderation'");
  const status = opt?.value === '1' ? 'pending' : 'approved';
  await env.DB.prepare('INSERT INTO comments (cid, parent, author, mail, url, ip, agent, text, status, is_owner, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
    .bind(cid, parent, author, mail, link, ip, str(request.headers.get('user-agent'), 300), text, status, now())
    .run();
  return json({ ok: true, status });
}

// ───────────────────────── 后台：概要 ─────────────────────────

async function stats(env) {
  const [c, cm, recent, pending] = await Promise.all([
    all(env, 'SELECT type, status, COUNT(*) AS n FROM contents GROUP BY type, status'),
    all(env, 'SELECT status, COUNT(*) AS n FROM comments GROUP BY status'),
    all(env, 'SELECT cid, type, title, status, modified FROM contents ORDER BY modified DESC LIMIT 6'),
    all(env, "SELECT c.coid, c.author, c.text, c.created, c.status, t.title FROM comments c LEFT JOIN contents t ON t.cid = c.cid ORDER BY c.created DESC LIMIT 5"),
  ]);
  const count = (rows, f) => rows.filter(f).reduce((s, r) => s + r.n, 0);
  return {
    posts: count(c, (r) => r.type === 'post' && r.status === 'publish'),
    drafts: count(c, (r) => r.status === 'draft'),
    pages: count(c, (r) => r.type === 'page'),
    comments: count(cm, () => true),
    pendingComments: count(cm, (r) => r.status === 'pending'),
    recent,
    recentComments: pending,
    env: publicEnv(env),
  };
}

// ───────────────────────── 后台：文章与页面 ─────────────────────────

async function listContents(env, url) {
  const type = url.searchParams.get('type') === 'page' ? 'page' : 'post';
  const status = url.searchParams.get('status') || '';
  const q = str(url.searchParams.get('q'), 60);
  const where = ['type = ?'];
  const args = [type];
  if (status) { where.push('status = ?'); args.push(status); }
  if (q) { where.push('(title LIKE ? OR text LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const order = type === 'page' ? 'sort_order ASC, cid ASC' : 'created DESC';
  const contents = await all(env, `SELECT cid, type, title, slug, status, template, sort_order, created, modified, (SELECT COUNT(*) FROM comments m WHERE m.cid = contents.cid) AS comments FROM contents WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`, ...args);
  const rel = await all(env, "SELECT r.cid, m.name FROM relationships r JOIN metas m ON m.mid = r.mid WHERE m.type = 'category'");
  const cat = {};
  for (const r of rel) (cat[r.cid] ??= []).push(r.name);
  return json({ contents: contents.map((c) => ({ ...c, categories: cat[c.cid] || [] })) });
}

async function getContent(env, cid) {
  const content = await first(env, 'SELECT * FROM contents WHERE cid = ?', cid);
  if (!content) throw new HttpError(404, '内容不存在');
  const metas = await all(env, 'SELECT m.mid, m.type, m.name FROM relationships r JOIN metas m ON m.mid = r.mid WHERE r.cid = ?', cid);
  return json({ content, categories: metas.filter((x) => x.type === 'category').map((x) => x.mid), tags: metas.filter((x) => x.type === 'tag').map((x) => x.name) });
}

/** 把正文里指向 R2 原始域名的地址统一换成 CDN 域名。 */
function rewriteCdn(env, text) {
  const cdn = cdnBase(env);
  if (!cdn || !text) return text;
  for (const host of hostList(env.R2_PUBLIC_HOSTS)) {
    const h = host.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`https?://${h}(?=[/\\s)"'\\]]|$)`, 'gi'), cdn);
  }
  return text;
}

async function saveContent(ctx, cid, b) {
  const { env } = ctx;
  const type = b.type === 'page' ? 'page' : 'post';
  const title = str(b.title, 200);
  if (!title) throw new HttpError(400, '标题不能为空');
  const status = ['publish', 'draft', 'hidden'].includes(b.status) ? b.status : 'draft';
  let slug = str(b.slug, 150).replace(/[\s/\\?#%&"'<>]+/g, '-').replace(/^-+|-+$/g, '');
  const text = rewriteCdn(env, String(b.text ?? '').replace(/\r\n/g, '\n'));
  const cover = rewriteCdn(env, str(b.cover, 500));
  const t = now();
  const created = Number.isInteger(b.created) && b.created > 0 ? b.created : t;
  const template = type === 'page' && b.template === 'archives' ? b.template : '';
  const fields = [type, title, text, str(b.summary, 300), cover, status, template, Number(b.sort_order) || 0, b.allow_comment === 0 || b.allow_comment === false ? 0 : 1, created, t];

  if (slug) {
    const clash = await first(env, 'SELECT cid FROM contents WHERE type = ? AND slug = ? AND cid != ?', type, slug, cid ?? -1);
    if (clash) throw new HttpError(409, `缩略名「${slug}」已被占用`);
  }
  let before = null;
  if (cid === null) {
    // 与 Typecho 一致：不填缩略名时用 cid。先占位插入拿到 cid，再回填。
    const res = await env.DB.prepare('INSERT INTO contents (type, title, text, summary, cover, status, template, sort_order, allow_comment, created, modified, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(...fields, slug || `tmp-${crypto.randomUUID()}`)
      .run();
    cid = res.meta.last_row_id;
    if (!slug) {
      slug = String(cid);
      await env.DB.prepare('UPDATE contents SET slug = ? WHERE cid = ?').bind(slug, cid).run();
    }
  } else {
    before = await first(env, 'SELECT status FROM contents WHERE cid = ?', cid);
    if (!before) throw new HttpError(404, '内容不存在');
    await env.DB.prepare('UPDATE contents SET type = ?, title = ?, text = ?, summary = ?, cover = ?, status = ?, template = ?, sort_order = ?, allow_comment = ?, created = ?, modified = ?, slug = ? WHERE cid = ?')
      .bind(...fields, slug || String(cid), cid)
      .run();
  }

  // 分类（mid 列表）与标签（名称列表，不存在的自动创建）
  if (type === 'post') {
    const mids = new Set((Array.isArray(b.categories) ? b.categories : []).map(Number).filter(Number.isInteger));
    for (const raw of Array.isArray(b.tags) ? b.tags : []) {
      const name = str(raw, 60);
      if (!name) continue;
      let tag = await first(env, "SELECT mid FROM metas WHERE type = 'tag' AND (name = ? OR slug = ?)", name, name);
      if (!tag) {
        const r = await env.DB.prepare("INSERT INTO metas (type, name, slug) VALUES ('tag', ?, ?)").bind(name, name).run();
        tag = { mid: r.meta.last_row_id };
      }
      mids.add(tag.mid);
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM relationships WHERE cid = ?').bind(cid),
      ...[...mids].map((mid) => env.DB.prepare('INSERT OR IGNORE INTO relationships (cid, mid) VALUES (?, ?)').bind(cid, mid)),
    ]);
  }

  // 对外可见的内容有变化 → 触发两个平台重新构建
  const visible = status !== 'draft' || (before && before.status !== 'draft');
  let deployed = null;
  if (visible && b.deploy !== false) deployed = await deploy(env);
  return json({ ok: true, cid, slug: slug || String(cid), deployed });
}

async function deleteContent(ctx, cid) {
  const { env } = ctx;
  const before = await first(env, 'SELECT status FROM contents WHERE cid = ?', cid);
  if (!before) throw new HttpError(404, '内容不存在');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM contents WHERE cid = ?').bind(cid),
    env.DB.prepare('DELETE FROM relationships WHERE cid = ?').bind(cid),
    env.DB.prepare('DELETE FROM comments WHERE cid = ?').bind(cid),
  ]);
  return json({ ok: true, deployed: before.status !== 'draft' ? await deploy(env) : null });
}

// ───────────────────────── 后台：分类与标签 ─────────────────────────

const allMetas = (env) =>
  all(env, "SELECT m.*, (SELECT COUNT(*) FROM relationships r JOIN contents c ON c.cid = r.cid WHERE r.mid = m.mid AND c.type = 'post') AS count FROM metas m ORDER BY m.type, m.sort_order, m.mid");

async function saveMeta(env, mid, b) {
  const type = b.type === 'tag' ? 'tag' : 'category';
  const name = str(b.name, 80);
  if (!name) throw new HttpError(400, '名称不能为空');
  const slug = (str(b.slug, 80) || name).replace(/[\s/\\?#%&"'<>]+/g, '-');
  const clash = await first(env, 'SELECT mid FROM metas WHERE type = ? AND slug = ? AND mid != ?', type, slug, mid ?? -1);
  if (clash) throw new HttpError(409, `缩略名「${slug}」已被占用`);
  if (mid === null) {
    const r = await env.DB.prepare('INSERT INTO metas (type, name, slug, description, sort_order) VALUES (?, ?, ?, ?, ?)').bind(type, name, slug, str(b.description, 300), Number(b.sort_order) || 0).run();
    return json({ ok: true, mid: r.meta.last_row_id });
  }
  await env.DB.prepare('UPDATE metas SET name = ?, slug = ?, description = ?, sort_order = ? WHERE mid = ?').bind(name, slug, str(b.description, 300), Number(b.sort_order) || 0, mid).run();
  return json({ ok: true, mid });
}

async function deleteMeta(env, mid) {
  await env.DB.batch([env.DB.prepare('DELETE FROM metas WHERE mid = ?').bind(mid), env.DB.prepare('DELETE FROM relationships WHERE mid = ?').bind(mid)]);
  return json({ ok: true });
}

// ───────────────────────── 后台：评论 ─────────────────────────

async function listComments(env, url) {
  const status = url.searchParams.get('status') || '';
  const where = status ? 'WHERE c.status = ?' : '';
  const comments = await all(env, `SELECT c.*, t.title, t.slug, t.type FROM comments c LEFT JOIN contents t ON t.cid = c.cid ${where} ORDER BY c.created DESC LIMIT 300`, ...(status ? [status] : []));
  return json({ comments });
}

async function updateComment(env, coid, b) {
  const cur = await first(env, 'SELECT * FROM comments WHERE coid = ?', coid);
  if (!cur) throw new HttpError(404, '评论不存在');
  const status = ['approved', 'pending', 'spam'].includes(b.status) ? b.status : cur.status;
  const text = b.text !== undefined ? str(b.text, 2000) : cur.text;
  return run(env, 'UPDATE comments SET status = ?, text = ? WHERE coid = ?', status, text, coid);
}

async function replyComment(env, user, b) {
  const parentRow = await first(env, 'SELECT coid, cid, parent FROM comments WHERE coid = ?', int(b.parent));
  if (!parentRow) throw new HttpError(404, '回复的评论不存在');
  const text = str(b.text, 2000);
  if (!text) throw new HttpError(400, '内容不能为空');
  const o = await getOptions(env);
  await env.DB.prepare("INSERT INTO comments (cid, parent, author, mail, url, text, status, is_owner, created) VALUES (?, ?, ?, '', ?, ?, 'approved', 1, ?)")
    .bind(parentRow.cid, parentRow.parent || parentRow.coid, o.author || user, o.site_url || '', text, now())
    .run();
  return json({ ok: true });
}

// ───────────────────────── 后台：设置 ─────────────────────────

const OPTION_KEYS = ['title', 'subtitle', 'description', 'keywords', 'site_url', 'author', 'avatar', 'favicon', 'page_size', 'license', 'comment_moderation', 'footer', 'footer_html', 'upload_dir', 'upload_webp'];

async function saveOptions(env, b) {
  const stmts = OPTION_KEYS.filter((k) => b[k] !== undefined).map((k) =>
    env.DB.prepare('INSERT INTO options (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').bind(k, String(b[k]).slice(0, 20000)),
  );
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, deployed: b.deploy === false ? null : await deploy(env) });
}

// ───────────────────────── 后台：R2 上传 / 媒体库 ─────────────────────────

function needBucket(env) {
  if (!env.BUCKET) throw new HttpError(503, '未绑定 R2 存储桶（BUCKET）');
  if (!cdnBase(env)) throw new HttpError(503, '未设置 CDN_BASE（R2 对外访问的 CDN 域名）');
}
const publicUrl = (env, key) => `${cdnBase(env)}/${key.split('/').map(encodeURIComponent).join('/')}`;
const cleanDir = (dir) => String(dir || '').split('/').map((s) => s.replace(/[^\w.-]+/g, '')).filter((s) => s && s !== '.' && s !== '..').join('/');

/** 写入 R2，返回 CDN 地址。对象名带内容哈希：同一文件重复上传不会产生多份，也可以放心永久缓存。 */
async function putObject(env, bytes, name, type, dir) {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 4).map((x) => x.toString(16).padStart(2, '0')).join('');
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  const d = new Date();
  const key = `${dir}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${base}-${hash}${ext ? '.' + ext : ''}`;
  if (!(await env.BUCKET.head(key))) {
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type || 'application/octet-stream', cacheControl: 'public, max-age=31536000, immutable' } });
  }
  return { key, url: publicUrl(env, key), size: bytes.byteLength, type };
}

async function uploadDir(env, requested) {
  const opt = await first(env, "SELECT value FROM options WHERE name = 'upload_dir'");
  return cleanDir(requested) || cleanDir(opt?.value) || 'img';
}

async function upload(env, request) {
  needBucket(env);
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, '没有收到文件');
  if (file.size > MAX_UPLOAD) throw new HttpError(413, `文件超过 ${MAX_UPLOAD / 1024 / 1024}MB 上限`);
  const dir = await uploadDir(env, form.get('dir'));
  return json({ ok: true, ...(await putObject(env, await file.arrayBuffer(), file.name || 'file', file.type, dir)) });
}

async function listMedia(env, url) {
  needBucket(env);
  const prefix = cleanDir(url.searchParams.get('prefix'));
  const res = await env.BUCKET.list({ prefix: prefix ? prefix + '/' : '', delimiter: '/', limit: 100, cursor: url.searchParams.get('cursor') || undefined });
  return json({
    prefix,
    folders: (res.delimitedPrefixes || []).map((p) => p.replace(/\/$/, '')),
    // 以 / 结尾的是其他工具建文件夹时留下的空占位对象（如 icon/cdn/），它本身不是文件，不列出
    objects: res.objects.filter((o) => !o.key.endsWith('/')).map((o) => ({ key: o.key, size: o.size, uploaded: Math.floor(new Date(o.uploaded).getTime() / 1000), url: publicUrl(env, o.key) })),
    cursor: res.truncated ? res.cursor : null,
  });
}

async function deleteMedia(env, url) {
  needBucket(env);
  const key = url.searchParams.get('key');
  if (!key) throw new HttpError(400, '缺少 key');
  await env.BUCKET.delete(key);
  return json({ ok: true });
}

/** 把正文里的外链图片抓取到 R2，并把地址替换成 CDN 地址。 */
async function localize(env, b) {
  needBucket(env);
  let text = String(b.text ?? '');
  const cdnHost = new URL(cdnBase(env)).host;
  const urls = new Set();
  for (const m of text.matchAll(/!\[[^\]]*\]\(\s*<?(https?:\/\/[^\s)>]+)/g)) urls.add(m[1]);
  for (const m of text.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(https?:\/\/[^\s>]+)/gm)) if (/\.(webp|png|jpe?g|gif|avif|svg)(\?|$)/i.test(m[1])) urls.add(m[1]);
  for (const m of text.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)/gi)) urls.add(m[1]);
  const dir = (await uploadDir(env)) + '/remote';
  const done = [], failed = [];
  for (const src of [...urls].slice(0, 20)) {
    try {
      const u = new URL(src);
      if (u.host === cdnHost) continue;
      const res = await fetch(src, { headers: { 'user-agent': 'Mozilla/5.0 (blog image fetcher)', referer: u.origin + '/' }, signal: AbortSignal.timeout(15000) });
      const type = (res.headers.get('content-type') || '').split(';')[0];
      if (!res.ok || !type.startsWith('image/')) throw new Error(res.ok ? '不是图片' : `HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength > MAX_UPLOAD) throw new Error('文件过大');
      let name = decodeURIComponent(u.pathname.split('/').pop() || 'image');
      if (!/\.\w{2,5}$/.test(name)) name += '.' + (type.split('/')[1] || 'img').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const out = await putObject(env, bytes, name, type, dir);
      text = text.split(src).join(out.url);
      done.push({ from: src, to: out.url });
    } catch (err) {
      failed.push({ from: src, error: String(err.message || err) });
    }
  }
  return json({ ok: true, text: rewriteCdn(env, text), done, failed });
}

// ───────────────────────── 触发重新构建 ─────────────────────────

/** 调用两个平台的 Deploy Hook。站点是纯静态的，发布 = 重新构建，通常一两分钟后生效。 */
async function deploy(env) {
  const hooks = hostList(env.DEPLOY_HOOKS);
  if (!hooks.length) return { triggered: 0, total: 0, note: '未配置 DEPLOY_HOOKS，内容已保存，但需要手动重新部署才会更新到前台' };
  const results = await Promise.all(
    hooks.map(async (hook) => {
      try {
        const res = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(10000) });
        return { host: new URL(hook).host, ok: res.ok, status: res.status };
      } catch (err) {
        return { host: new URL(hook).host, ok: false, error: String(err.message || err) };
      }
    }),
  );
  return { triggered: results.filter((r) => r.ok).length, total: hooks.length, results };
}
