// Typecho 备份 (.dat) → db/seed.sql + src/data/snapshot.json
//
//   node scripts/migrate-typecho.mjs [备份文件路径]
//
// 不传路径时，使用上级目录里最新的 *.dat。
// seed.sql      导入 D1 的初始数据（含评论邮箱/IP，属于私有数据，不要公开）
// snapshot.json 构建时的内容快照（仅公开内容），API 不可用时站点仍可构建
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 备份文件里没有站点设置（它们在 typecho_options 表），这里按旧站的值写死，之后可在后台「设置」里改。
const SITE_OPTIONS = {
  title: '树萌',
  subtitle: '技术与生活的随笔日记',
  description: '兴趣使然的个人小站',
  keywords: 'blog,旅游,编程,传记,杂谈,二次元',
  site_url: 'https://www.treemoe.cn',
  author: 'tree',
  avatar: 'https://oss.treemoe.cn/icon/yui.webp',
  favicon: 'https://oss.treemoe.cn/icon/favicon.ico',
  page_size: '8',
  license: 'CC BY-NC-SA 4.0',
  comment_moderation: '0',
  footer_html: [
    '<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">冀ICP备2026001893号-1</a>',
    '<a href="https://beian.mps.gov.cn/#/query/webSearch?code=13102802000493" target="_blank" rel="noreferrer noopener"><img src="https://oss.treemoe.cn/icon/ga.png" alt="">冀公网安备13102802000493号</a>',
    '<a href="https://icp.gov.moe/?keyword=20252080" target="_blank" rel="noopener"><img src="https://oss.treemoe.cn/icon/moe.svg" alt="">萌ICP备案20252080号</a>',
    '<a href="https://moe.tmoe.cc" target="_blank" rel="noopener">网站探针</a>',
    '<a href="https://www.travellings.cn/go.html" target="_blank" rel="noopener">开往</a>',
    '<a href="/sitemap.xml">网站地图</a>',
  ].join('\n'),
};

const TEMPLATE_MAP = { 'archives.php': 'archives' };
const TYPES = { 1: 'contents', 2: 'comments', 3: 'metas', 4: 'relationships', 5: 'users', 6: 'fields' };
const HEADER = '%TYPECHO_BACKUP_0001%';

function findBackup() {
  const dir = resolve(root, '..');
  const files = readdirSync(dir).filter((f) => f.endsWith('.dat'));
  if (!files.length) throw new Error(`在 ${dir} 里没有找到 .dat 备份，请把路径作为参数传入`);
  files.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
  return join(dir, files[0]);
}

/** 格式见 Typecho var/Typecho/Common.php buildBackupBuffer：pack('vvV') + header(JSON 各字段字节长度) + body + md5 */
function parseBackup(buf) {
  if (buf.subarray(0, HEADER.length).toString('latin1') !== HEADER) throw new Error('不是 Typecho 备份文件');
  const out = Object.fromEntries(Object.values(TYPES).map((t) => [t, []]));
  let o = HEADER.length;
  const end = buf.length - HEADER.length;
  while (o + 8 <= end) {
    const start = o;
    const type = buf.readUInt16LE(o);
    const headerLen = buf.readUInt16LE(o + 2);
    const bodyLen = buf.readUInt32LE(o + 4);
    o += 8;
    const schema = JSON.parse(buf.subarray(o, o + headerLen).toString('utf8'));
    o += headerLen;
    const row = {};
    let p = o;
    for (const [key, len] of Object.entries(schema)) {
      if (len === null) row[key] = null;
      else {
        row[key] = buf.subarray(p, p + len).toString('utf8');
        p += len;
      }
    }
    o += bodyLen;
    const md5 = buf.subarray(o, o + 32).toString('latin1');
    if (createHash('md5').update(buf.subarray(start, o)).digest('hex') !== md5) throw new Error(`记录校验失败 @${start}`);
    o += 32;
    if (TYPES[type]) out[TYPES[type]].push(row);
  }
  return out;
}

const decodeEntities = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insert = (table, row) => `INSERT OR REPLACE INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`;

const file = process.argv[2] ? resolve(process.argv[2]) : findBackup();
const data = parseBackup(readFileSync(file));

const fields = {};
for (const f of data.fields) (fields[f.cid] ??= {})[f.name] = f.str_value ?? '';

const contents = data.contents
  .filter((c) => c.type === 'post' || c.type === 'page')
  .map((c) => ({
    cid: +c.cid,
    type: c.type,
    title: decodeEntities(c.title ?? ''),
    slug: c.slug,
    text: (c.text ?? '').replace(/^<!--markdown-->/, '').replace(/\r\n/g, '\n'),
    summary: fields[c.cid]?.desc ?? '',
    cover: fields[c.cid]?.img ?? '',
    status: c.status === 'publish' ? 'publish' : c.status === 'hidden' ? 'hidden' : 'draft',
    template: TEMPLATE_MAP[c.template] ?? '',
    sort_order: +c.order || 0,
    allow_comment: c.allowComment === '1' ? 1 : 0,
    created: +c.created,
    modified: +c.modified,
  }));

const metas = data.metas
  .filter((m) => m.type === 'category' || m.type === 'tag')
  .map((m) => ({ mid: +m.mid, type: m.type, name: m.name, slug: m.slug, description: m.description ?? '', sort_order: +m.order || 0 }));

const cids = new Set(contents.map((c) => c.cid));
const mids = new Set(metas.map((m) => m.mid));
const relationships = data.relationships.map((r) => ({ cid: +r.cid, mid: +r.mid })).filter((r) => cids.has(r.cid) && mids.has(r.mid));

const comments = data.comments
  .filter((c) => c.type === 'comment' && cids.has(+c.cid))
  .map((c) => ({
    coid: +c.coid,
    cid: +c.cid,
    parent: +c.parent || 0,
    author: c.author ?? '',
    mail: c.mail ?? '',
    url: c.url ?? '',
    ip: c.ip ?? '',
    agent: c.agent ?? '',
    text: c.text ?? '',
    status: c.status === 'approved' ? 'approved' : c.status === 'spam' ? 'spam' : 'pending',
    is_owner: +c.authorId > 0 && c.authorId === c.ownerId ? 1 : 0,
    created: +c.created,
  }));

const admin = data.users.find((u) => u.group === 'administrator');
const options = { ...SITE_OPTIONS, author: admin?.screenName || SITE_OPTIONS.author };

// ---- seed.sql
const sql = [
  `-- 由 scripts/migrate-typecho.mjs 生成，来源：${file.split(/[\\/]/).pop()}`,
  ...Object.entries(options).map(([name, value]) => `INSERT OR IGNORE INTO options (name, value) VALUES (${q(name)}, ${q(value)});`),
  ...metas.map((m) => insert('metas', m)),
  ...contents.map((c) => insert('contents', c)),
  ...relationships.map((r) => insert('relationships', r)),
  ...comments.map((c) => insert('comments', c)),
];
mkdirSync(join(root, 'db'), { recursive: true });
writeFileSync(join(root, 'db/seed.sql'), sql.join('\n') + '\n');

// ---- snapshot.json（与 GET /api/export 的返回同构；只含公开内容）
const approved = {};
for (const c of comments) if (c.status === 'approved') approved[c.cid] = (approved[c.cid] || 0) + 1;
const snapshot = {
  generated: Math.floor(Date.now() / 1000),
  options,
  contents: contents.filter((c) => c.status !== 'draft').map((c) => ({ ...c, comments: approved[c.cid] || 0 })),
  metas,
  relationships: relationships.map((r) => [r.cid, r.mid]),
};
mkdirSync(join(root, 'src/data'), { recursive: true });
writeFileSync(join(root, 'src/data/snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');

console.log(`备份: ${file}`);
console.log(`内容 ${contents.length}（文章 ${contents.filter((c) => c.type === 'post').length} / 页面 ${contents.filter((c) => c.type === 'page').length}）· 分类标签 ${metas.length} · 关系 ${relationships.length} · 评论 ${comments.length}`);
console.log('已写入 db/seed.sql 与 src/data/snapshot.json');
