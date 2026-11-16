import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { GlassButton, GlassSwitch, Text, TextField, useToast } from '@ttqtt/liquid-glass-react';
import { api, deployMessage, useData, type DeployResult } from './api';
import { PageHead } from './ui';
import { defaultFooter } from '../lib/footer';

interface Payload {
  options: Record<string, string>;
  env: { cdnBase: string; r2: boolean; r2Hosts: string[]; deployHooks: number };
}

const TEXT_FIELDS: [key: string, label: string, hint?: string][] = [
  ['title', '站点名称'],
  ['subtitle', '副标题'],
  ['description', '站点描述', '用于首页与搜索引擎'],
  ['keywords', '关键词', '逗号分隔'],
  ['site_url', '站点地址', '如 https://www.treemoe.cn，用于 RSS、站点地图与旧链接改写'],
  ['author', '作者名'],
  ['avatar', '头像地址'],
  ['favicon', '站点图标地址'],
  ['page_size', '首页每页文章数'],
  ['license', '文章许可协议'],
];

function Section({ header, footer, children }: { header: string; footer?: string; children: ReactNode }) {
  return (
    <section className="admin-panel">
      <Text variant="headline" as="h2">{header}</Text>
      {children}
      {footer && <p className="muted-inline">{footer}</p>}
    </section>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="admin-row">
      <div>
        <div>{label}</div>
        {description && <div className="muted-inline">{description}</div>}
      </div>
      <div className="admin-row-value">{children}</div>
    </div>
  );
}

export default function Settings({ user, onLogout }: { user: string; onLogout: () => void }) {
  const toast = useToast();
  const [data] = useData<Payload>('/admin/options');
  const [o, setO] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setO(data.options);
  }, [data]);
  const set = (k: string, v: string) => setO((cur) => ({ ...cur, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ deployed: DeployResult | null }>('/admin/options', { method: 'PUT', body: o });
      toast({ message: `设置已保存${deployMessage(r.deployed)}`, tone: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    onLogout();
  }

  if (!data) return <p className="muted admin-empty">加载中…</p>;
  const env = data.env;

  return (
    <>
      <PageHead title="设置" hint={`已登录：${user}`}>
        <GlassButton variant="gray" onClick={logout}>退出登录</GlassButton>
        <GlassButton variant="glassProminent" loading={saving} onClick={save}>保存设置</GlassButton>
      </PageHead>

      <form className="admin-cards" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Section header="站点" footer="">
          {TEXT_FIELDS.map(([k, label, hint]) => (
            <TextField key={k} label={label} hint={hint} value={o[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
          ))}
        </Section>

        <Section header="页脚" footer="整段原样输出为 HTML。可用占位符：{year} 当前年份、{author} 作者名、{title} 站点名称、{cdn} 当前访问线路（Cloudflare / EdgeOne）的徽标。图标放进 <a> 里就会和文字成为一个整体；外观切换按钮固定在最下方，不在此处。">
          <TextField label="页脚 HTML" multiline rows={10} value={o.footer || defaultFooter(o)} onChange={(e) => set('footer', e.target.value)} />
          <Row label="恢复默认" description="用旧的页脚链接重新生成一份">
            <GlassButton type="button" variant="gray" onClick={() => set('footer', defaultFooter({ ...o, footer: '' }))}>恢复</GlassButton>
          </Row>
        </Section>

        <Section header="上传" footer="上传的文件存入 R2，按「目录/年/月/文件名-内容哈希」命名；返回并插入正文的是 CDN 域名下的地址。">
          <TextField label="上传目录" value={o.upload_dir ?? ''} placeholder="img" onChange={(e) => set('upload_dir', e.target.value)} hint="R2 里的顶层目录，默认 img" />
          <Row label="上传前转为 WebP" description="PNG / JPEG 在浏览器里转成 WebP 再上传（转完更大则保留原图）">
            <GlassSwitch aria-label="上传前转为 WebP" checked={o.upload_webp !== '0'} onCheckedChange={(on) => set('upload_webp', on ? '1' : '0')} />
          </Row>        </Section>

        <Section header="运行环境（只读）" footer="这些在 Cloudflare Worker 的「设置 → 变量和机密 / 绑定」里配置，改完需重新部署。">
          <Row label="R2 存储桶（BUCKET）" description="">{env.r2 ? '已绑定' : '未绑定'}</Row>
          <Row label="CDN 域名（CDN_BASE）" description="">{env.cdnBase || '未设置'}</Row>
          <Row label="自动替换的 R2 原始域名（R2_PUBLIC_HOSTS）" description="">{env.r2Hosts.length ? env.r2Hosts.join('、') : '未设置'}</Row>
          <Row label="部署钩子（DEPLOY_HOOKS）" description="">{env.deployHooks ? `${env.deployHooks} 个` : '未设置'}</Row>
        </Section>
      </form>
    </>
  );
}
