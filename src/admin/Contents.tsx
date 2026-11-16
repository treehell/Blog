// 内容：文章 / 页面 / 分类 / 标签 四个列表，用分段控件切换。
import { useState } from 'react';
import { GlassButton, GlassSegmentedControl, List, ListRow, ListSection, SearchField, TextField, useToast } from '@ttqtt/liquid-glass-react';
import { api, fmtTime, go, useData, useHash } from './api';
import { Empty, PageHead, STATUS_LABEL, useConfirm } from './ui';

interface Row {
  cid: number;
  type: string;
  title: string;
  slug: string;
  status: string;
  template: string;
  sort_order: number;
  created: number;
  comments: number;
  categories: string[];
}
interface MetaRow {
  mid: number;
  type: 'category' | 'tag';
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  count: number;
}

const TABS = [
  { value: 'post', label: '文章' },
  { value: 'page', label: '页面' },
  { value: 'category', label: '分类' },
  { value: 'tag', label: '标签' },
];

export default function Contents() {
  const hash = useHash();
  const tab = new URLSearchParams(hash.split('?')[1] || '').get('tab') || 'post';
  const isContent = tab === 'post' || tab === 'page';
  return (
    <>
      <PageHead title="内容">
        {isContent && <GlassButton variant="glassProminent" onClick={() => go(`/write/${tab}/new`)}>{tab === 'post' ? '写文章' : '新建页面'}</GlassButton>}
      </PageHead>
      <GlassSegmentedControl aria-label="内容类型" items={TABS} value={tab} onValueChange={(v) => go(`/content?tab=${v}`)} />
      {isContent ? <ContentList key={tab} type={tab} /> : <MetaList key={tab} type={tab as 'category' | 'tag'} />}
    </>
  );
}

function ContentList({ type }: { type: string }) {
  const [q, setQ] = useState('');
  const [data, , error] = useData<{ contents: Row[] }>(`/admin/contents?type=${type}`);
  const rows = (data?.contents ?? []).filter((r) => !q || r.title.toLowerCase().includes(q.toLowerCase()) || r.slug.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="admin-filter">
        <SearchField aria-label="搜索标题" value={q} onValueChange={setQ} placeholder="搜索标题或缩略名" />
      </div>
      {error && <Empty>{error}</Empty>}
      {data && !rows.length && <Empty>没有内容</Empty>}
      {rows.length > 0 && (
        <List>
          <ListSection>
            {rows.map((r) => (
              <ListRow
                key={r.cid}
                label={r.title || '（无标题）'}
                secondaryLabel={[type === 'post' ? r.categories.map((c) => c.split('-')[0]).join('、') : r.template ? `模板：${r.template}` : `顺序 ${r.sort_order}`, fmtTime(r.created), `/${type === 'post' ? 'archives/' : ''}${r.slug}/`]
                  .filter(Boolean)
                  .join(' · ')}
                value={r.status === 'publish' ? undefined : STATUS_LABEL[r.status]}
                disclosure
                onSelect={() => go(`/write/${type}/${r.cid}`)}
              />
            ))}
          </ListSection>
        </List>
      )}
    </>
  );
}

function MetaList({ type }: { type: 'category' | 'tag' }) {
  const toast = useToast();
  const [data, reload] = useData<{ metas: MetaRow[] }>('/admin/metas');
  const [editing, setEditing] = useState<Partial<MetaRow> | null>(null);
  const [ask, dialog] = useConfirm();
  const rows = (data?.metas ?? []).filter((m) => m.type === type);
  const noun = type === 'category' ? '分类' : '标签';

  async function save() {
    if (!editing) return;
    try {
      await api(editing.mid ? `/admin/metas/${editing.mid}` : '/admin/metas', { method: editing.mid ? 'PUT' : 'POST', body: { ...editing, type } });
      toast({ message: `${noun}已保存（重新部署后前台生效）`, tone: 'success' });
      setEditing(null);
      reload();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  return (
    <>
      {dialog}
      {editing ? (
        <div className="admin-panel">
          <TextField label="名称" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} hint="形如「旅行日志-树萌的游记」时，前台卡片只显示「-」前面的短名" />
          <TextField label="缩略名（用于网址）" value={editing.slug ?? ''} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} />
          <TextField label="描述" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          <TextField label="排序" type="number" value={String(editing.sort_order ?? 0)} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} />
          <div className="admin-actions">
            <GlassButton variant="glassProminent" onClick={save}>保存</GlassButton>
            <GlassButton variant="gray" onClick={() => setEditing(null)}>取消</GlassButton>
            {editing.mid && (
              <GlassButton
                variant="destructive"
                onClick={() =>
                  ask({
                    title: `删除${noun}「${editing.name}」？`,
                    message: '文章本身不会被删除，只是不再属于它。',
                    onConfirm: async () => {
                      await api(`/admin/metas/${editing.mid}`, { method: 'DELETE' });
                      setEditing(null);
                      reload();
                    },
                  })
                }
              >
                删除
              </GlassButton>
            )}
          </div>
        </div>
      ) : (
        <div className="admin-filter">
          <GlassButton variant="gray" onClick={() => setEditing({ name: '', slug: '', description: '', sort_order: 0 })}>新建{noun}</GlassButton>
        </div>
      )}
      {data && !rows.length && <Empty>还没有{noun}</Empty>}
      {rows.length > 0 && (
        <List>
          <ListSection>
            {rows.map((m) => (
              <ListRow key={m.mid} label={m.name} secondaryLabel={`/${type}/${m.slug}/${m.description ? ' · ' + m.description : ''}`} value={`${m.count} 篇`} disclosure onSelect={() => setEditing(m)} />
            ))}
          </ListSection>
        </List>
      )}
    </>
  );
}
