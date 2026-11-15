import { useState } from 'react';
import { Banner, Card, GlassButton, List, ListRow, ListSection, Text, useToast } from '@ttqtt/liquid-glass-react';
import { api, deployMessage, fmtTime, go, useData, type DeployResult } from './api';
import { Empty, PageHead, STATUS_LABEL } from './ui';

interface Stats {
  posts: number;
  drafts: number;
  pages: number;
  comments: number;
  pendingComments: number;
  recent: { cid: number; type: string; title: string; status: string; modified: number }[];
  recentComments: { coid: number; author: string; text: string; created: number; status: string; title: string }[];
  env: { cdnBase: string; r2: boolean; deployHooks: number };
}

export default function Dashboard() {
  const [stats, , error] = useData<Stats>('/admin/stats');
  const toast = useToast();
  const [deploying, setDeploying] = useState(false);

  async function deploy() {
    setDeploying(true);
    try {
      const d = await api<DeployResult>('/admin/deploy', { method: 'POST' });
      toast({ message: d.total ? `已触发 ${d.triggered}/${d.total} 个平台重新构建` : '尚未配置 DEPLOY_HOOKS', tone: d.total && d.triggered === d.total ? 'success' : 'warning' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setDeploying(false);
    }
  }

  return (
    <>
      <PageHead title="概要">
        <GlassButton variant="gray" onClick={deploy} loading={deploying}>重新部署</GlassButton>
        <GlassButton variant="glassProminent" onClick={() => go('/write/post/new')}>写文章</GlassButton>
      </PageHead>
      {error && <Banner tone="error" title="加载失败" message={error} />}
      {stats && !stats.env.r2 && <Banner tone="warning" title="未绑定 R2 存储桶" message="上传与媒体库不可用。请在 Cloudflare Worker 里绑定 BUCKET。" />}
      {stats && stats.env.deployHooks === 0 && (
        <Banner tone="info" title="未配置部署钩子" message="发布内容后不会自动重新构建。设置 DEPLOY_HOOKS 后，保存即自动上线。" />
      )}
      {stats && (
        <>
          <div className="admin-stats">
            {[
              ['已发布文章', stats.posts],
              ['草稿', stats.drafts],
              ['独立页面', stats.pages],
            ].map(([label, n]) => (
              <Card key={label} padding={16}>
                <Text variant="footnote" tone="secondary" as="div">{label}</Text>
                <Text variant="title1" emphasized tabular as="div">{n}</Text>
              </Card>
            ))}
          </div>
          <List>
            <ListSection header="最近修改">
              {stats.recent.map((c) => (
                <ListRow key={c.cid} label={c.title || '（无标题）'} secondaryLabel={`${c.type === 'page' ? '页面' : '文章'} · ${fmtTime(c.modified)}`} value={STATUS_LABEL[c.status]} disclosure onSelect={() => go(`/write/${c.type}/${c.cid}`)} />
              ))}
            </ListSection>
          </List>
        </>
      )}
      {!stats && !error && <Empty>加载中…</Empty>}
    </>
  );
}
