-- D1 (SQLite) schema. 结构参考 Typecho，去掉了用不到的字段。
-- 可重复执行：全部使用 IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS contents (
  cid           INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL DEFAULT 'post',      -- post | page
  title         TEXT    NOT NULL DEFAULT '',
  slug          TEXT    NOT NULL,
  text          TEXT    NOT NULL DEFAULT '',          -- Markdown 原文
  summary       TEXT    NOT NULL DEFAULT '',          -- 摘要（Typecho 自定义字段 desc）
  cover         TEXT    NOT NULL DEFAULT '',          -- 封面（Typecho 自定义字段 img）
  status        TEXT    NOT NULL DEFAULT 'draft',     -- publish | draft | hidden
  template      TEXT    NOT NULL DEFAULT '',          -- 独立页面模板：'' | archives
  sort_order    INTEGER NOT NULL DEFAULT 0,           -- 独立页面在导航里的顺序
  allow_comment INTEGER NOT NULL DEFAULT 1,
  created       INTEGER NOT NULL,                     -- unix 秒
  modified      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contents_slug ON contents (type, slug);
CREATE INDEX IF NOT EXISTS idx_contents_list ON contents (type, status, created DESC);

CREATE TABLE IF NOT EXISTS metas (
  mid         INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL,                       -- category | tag
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_metas_slug ON metas (type, slug);

CREATE TABLE IF NOT EXISTS relationships (
  cid INTEGER NOT NULL,
  mid INTEGER NOT NULL,
  PRIMARY KEY (cid, mid)
);
CREATE INDEX IF NOT EXISTS idx_rel_mid ON relationships (mid);

CREATE TABLE IF NOT EXISTS comments (
  coid     INTEGER PRIMARY KEY AUTOINCREMENT,
  cid      INTEGER NOT NULL,
  parent   INTEGER NOT NULL DEFAULT 0,
  author   TEXT    NOT NULL,
  mail     TEXT    NOT NULL DEFAULT '',
  url      TEXT    NOT NULL DEFAULT '',
  ip       TEXT    NOT NULL DEFAULT '',
  agent    TEXT    NOT NULL DEFAULT '',
  text     TEXT    NOT NULL,
  status   TEXT    NOT NULL DEFAULT 'pending',        -- approved | pending | spam
  is_owner INTEGER NOT NULL DEFAULT 0,
  created  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_cid ON comments (cid, status, created);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments (status, created DESC);

CREATE TABLE IF NOT EXISTS options (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
