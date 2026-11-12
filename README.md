# 树萌博客

从 Typecho 迁移而来的全栈博客：静态前台 + 边缘函数后端，同一份代码同时部署到 **Cloudflare Pages** 和 **EdgeOne Pages**。

| | |
| --- | --- |
| 前台 | Astro 5 静态生成，正文与列表是纯 HTML；全站只有导航一处玻璃浮层 |
| 界面 | `@ttqtt/liquid-glass-react`（前台只用 `TabBar`，后台完整使用） |
| 后端 | `functions/api/[[default]].js`，单文件、零依赖 |
| 数据 | Cloudflare D1（文章 / 评论 / 设置）+ R2（图片与附件，经 CDN 域名访问） |
| 后台 | `/admin/`，React 单页应用 |

## 它是怎么工作的

```
读者 ──► EdgeOne（境内） / Cloudflare（境外） ──► 静态 HTML（构建时生成）
                                   │
                                   └─ /api/*  ──► Cloudflare Pages Functions ──► D1 / R2
                                        ▲
                     EdgeOne 上的 edge-functions 只做转发
```

- **读文章不经过任何后端**。页面是构建时生成的静态文件，由两家 CDN 直接返回。
- **发布 = 重新构建**。后台保存后会调用两个平台的 Deploy Hook；构建时从 `/api/export` 拉取最新内容，一两分钟后上线。
- **评论是实时的**。滚动到评论区时才请求 `/api/comments`，不占首屏。
- **数据只有一份**，都在 Cloudflare。EdgeOne 侧没有数据库，它的 `/api/*` 原样转发到 Cloudflare。

## 首屏

首页首屏只需要 **一个请求**：HTML（brotli 后约 9–15 KB），样式已内联，没有任何阻塞渲染的外部资源。

- 组件库完整样式约 120 KB。`scripts/postbuild.mjs` 按每个页面实际用到的选择器裁剪到约 25 KB 并内联。
- 导航的交互脚本（React，约 75 KB gzip）在浏览器空闲时才加载；不加载也能正常点击跳转，因为导航本身就是一组 `<a>`。
- 站内跳转使用 Speculation Rules 预渲染，鼠标悬停即开始加载。
- 图片来自 CDN，除首图外全部懒加载。**封面图体积不受本项目控制**，建议上传前保持 WebP（后台默认自动转换）。

## 目录

```
functions/api/[[default]].js        后端（Cloudflare 用；全部接口都在这一个文件里）
edge-functions/api/[[default]].js   EdgeOne 用的转发函数
db/schema.sql                       D1 表结构
db/seed.sql                         由 Typecho 备份生成的初始数据（含评论者邮箱与 IP，已在 .gitignore 里，不进仓库；
                                    换电脑时用 npm run migrate 从备份重新生成）
scripts/migrate-typecho.mjs         Typecho .dat 备份 → seed.sql + snapshot.json
scripts/postbuild.mjs               构建后：裁剪并内联样式，生成 _redirects / _headers
src/data/snapshot.json              内容快照；API 不可用时构建会退回到它
src/lib/markdown.ts                 Markdown 渲染（含旧主题短代码），前台构建与后台预览共用
src/pages/                          前台页面
src/admin/                          后台
wrangler.toml / edgeone.json        两个平台的配置
```

## 本地运行

需要 Node.js 22（20.3 以上也可构建）。

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`，填上后台密码和会话密钥，然后初始化本地数据库、构建、启动：

```bash
npm run db:init:local
```

```bash
npm run build
```

```bash
npm run preview
```

打开 <http://127.0.0.1:8788>，后台在 `/admin/`。只改前台样式时用 `npm run dev` 更快（没有 API）。

## 部署

### 1. Cloudflare（先做，它是数据源）

1. 创建 D1 数据库和 R2 存储桶（沿用旧站的桶即可），把 ID 与桶名填进 `wrangler.toml`。
2. 导入数据：`npm run db:init:remote`。
3. 把仓库推到 GitHub，在 Cloudflare Pages 里连接它。构建命令 `npm run build`，输出目录 `dist`。
4. 在 Pages 项目的「设置」里：
   - **绑定**：D1 → `DB`，R2 → `BUCKET`（`wrangler.toml` 已声明，核对即可）。
   - **变量和机密**：见下表。
   - **构建环境变量**：`CONTENT_API` = 本项目的地址（如 `https://treemoe-blog.pages.dev`）。
5. 创建一个 Deploy Hook，记下地址。

### 2. EdgeOne Pages

1. 连接同一个仓库。`edgeone.json` 已写好构建配置。
2. 环境变量：`API_ORIGIN` 和 `CONTENT_API` 都填 Cloudflare Pages 的地址；`PROXY_SECRET` 与 Cloudflare 侧保持一致。
3. 创建 Deploy Hook，记下地址。

### 3. 收尾

把两个 Deploy Hook 地址用逗号连起来，设为 Cloudflare 侧的机密 `DEPLOY_HOOKS`，然后重新部署一次。此后在后台发布文章会自动触发两边重建。

## 环境变量

Cloudflare Pages（运行时）：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 机密，必填 | 后台密码 |
| `SESSION_SECRET` | 机密，必填 | 会话签名密钥，32 位以上随机字符串 |
| `ADMIN_USER` | 变量 | 后台用户名，默认 `admin` |
| `CDN_BASE` | 变量，必填 | R2 的 CDN 域名，如 `https://oss.treemoe.cn` |
| `R2_PUBLIC_HOSTS` | 变量 | R2 原始域名（逗号分隔）。保存文章时，正文里的这些域名会被替换成 `CDN_BASE` |
| `DEPLOY_HOOKS` | 机密 | 两个平台的 Deploy Hook 地址，逗号分隔 |
| `PROXY_SECRET` | 机密 | 与 EdgeOne 侧一致；用于采信它转交的访客 IP（评论限流） |
| `ALLOWED_ORIGINS` | 变量 | 额外允许写操作的来源域名；站点地址本身已自动允许 |

EdgeOne Pages：`API_ORIGIN`（必填）、`PROXY_SECRET`（建议）、`CONTENT_API`（构建时）。

## 上传与 CDN

在编辑器里拖入、粘贴或选择文件，即自动：

1. PNG / JPEG 在浏览器里转成 WebP（可在设置里关闭；转完更大则保留原图）。
2. 存入 R2，对象名为 `目录/年/月/文件名-内容哈希.扩展名`。同一文件重复上传不会产生第二份。
3. 把 `CDN_BASE` 下的地址以 Markdown 形式插入光标处。

另有两个辅助功能：保存时把 `R2_PUBLIC_HOSTS` 里的原始域名替换为 CDN 域名；编辑器的「外链转存」把正文里的外站图片抓进 R2 并改写地址。

「媒体」页直接浏览存储桶，点文件即复制地址。

## 从 Typecho 迁移

```bash
npm run migrate -- 备份文件.dat
```

生成 `db/seed.sql` 和 `src/data/snapshot.json`。站点标题、页脚等不在备份文件里，写在脚本顶部的 `SITE_OPTIONS`，之后可在后台「设置」里改。

旧链接保持可用：`/archives/xxx.html` → `/archives/xxx/`，`/xxx.html` → `/xxx/`，`/index.php/...` 去掉前缀，`/feed` → `/feed.xml`。Cloudflare 侧是 301（`_redirects`），EdgeOne 侧由 404 页面的脚本跳转。

未迁移的内容：后台账号密码（改用环境变量）、OwO 表情（`:$(...)` 按原文显示）、Typecho 插件。

## 已知限制

- **EdgeOne 边缘函数请求体上限 1 MB**。经 EdgeOne 域名打开后台时会有提示；传大文件请用 Cloudflare 域名下的 `/admin/`。
- **`edge-functions/` 的转发函数没有在真实 EdgeOne 环境里跑过**，是按官方文档写的。首次部署后请访问 `/api/health`，应返回 `{"ok":true,"mode":"proxy",...}`。
- 发布后要等构建完成才上线，不是即时的。
- `[github]` 短代码只显示仓库名，不请求 GitHub API。
