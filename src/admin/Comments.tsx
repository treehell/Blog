import { useState } from 'react';
import { GlassButton, GlassSegmentedControl, TextField, useToast } from '@ttqtt/liquid-glass-react';
import { api, fmtTime, useData } from './api';
import { Empty, PageHead, STATUS_LABEL, useConfirm } from './ui';

interface Row {
  coid: number;
  cid: number;
  author: string;
  mail: string;
  url: string;
  ip: string;
  text: string;
  status: string;
  is_owner: number;
  created: number;
  title: string | null;
  slug: string | null;
  type: string | null;
}

const FILTERS = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'spam', label: '垃圾' },
];

export default function Comments() {
  const toast = useToast();
  const [ask, dialog] = useConfirm();
  const [status, setStatus] = useState('');
  const [data, reload, error] = useData<{ comments: Row[] }>(`/admin/comments${status ? `?status=${status}` : ''}`);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [reply, setReply] = useState('');

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast({ message: done, tone: 'success' });
      reload();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }
  const mark = (c: Row, s: string) => act(() => api(`/admin/comments/${c.coid}`, { method: 'PUT', body: { status: s } }), `已标记为${STATUS_LABEL[s]}`);

  return (
    <>
      {dialog}
      <PageHead title="评论" hint="评论是实时的，审核后前台立即生效，不需要重新部署" />
      <GlassSegmentedControl aria-label="筛选" items={FILTERS} value={status} onValueChange={setStatus} />
      {error && <Empty>{error}</Empty>}
      {data && !data.comments.length && <Empty>没有评论</Empty>}
      <div className="admin-cards">
        {data?.comments.map((c) => (
          <article key={c.coid} className="admin-panel">
            <div className="admin-comment-head">
              <strong>{c.author}</strong>
              {c.is_owner === 1 && <span className="badge">博主</span>}
              <span className="muted-inline">{[c.mail, c.ip, fmtTime(c.created)].filter(Boolean).join(' · ')}</span>
              <span className={`tag tag-${c.status}`}>{STATUS_LABEL[c.status]}</span>
            </div>
            <p className="admin-comment-text">{c.text}</p>
            <div className="muted-inline">
              评论于 {c.title ? <a href={`/${c.type === 'post' ? 'archives/' : ''}${c.slug}/#comment-${c.coid}`} target="_blank" rel="noopener">{c.title}</a> : '（内容已删除）'}
              {c.url && <> · <a href={c.url} target="_blank" rel="noopener nofollow">{c.url}</a></>}
            </div>
            {replyTo === c.coid ? (
              <>
                <TextField label="回复内容" labelHidden multiline rows={3} autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`回复 ${c.author}…`} />
                <div className="admin-actions">
                  <GlassButton
                    variant="glassProminent"
                    controlSize="small"
                    onClick={() =>
                      act(async () => {
                        await api('/admin/comments', { body: { parent: c.coid, text: reply } });
                        setReplyTo(null);
                        setReply('');
                      }, '已回复')
                    }
                  >
                    发送
                  </GlassButton>
                  <GlassButton variant="plain" controlSize="small" onClick={() => setReplyTo(null)}>取消</GlassButton>
                </div>
              </>
            ) : (
              <div className="admin-actions">
                {c.status !== 'approved' && <GlassButton variant="tinted" controlSize="small" onClick={() => mark(c, 'approved')}>通过</GlassButton>}
                {c.status === 'approved' && <GlassButton variant="gray" controlSize="small" onClick={() => mark(c, 'pending')}>待审</GlassButton>}
                {c.status !== 'spam' && <GlassButton variant="gray" controlSize="small" onClick={() => mark(c, 'spam')}>垃圾</GlassButton>}
                <GlassButton variant="gray" controlSize="small" onClick={() => { setReplyTo(c.coid); setReply(''); }}>回复</GlassButton>
                <GlassButton
                  variant="destructive"
                  controlSize="small"
                  onClick={() => ask({ title: '删除这条评论？', message: '它下面的回复也会一并删除。', onConfirm: () => act(() => api(`/admin/comments/${c.coid}`, { method: 'DELETE' }), '已删除') })}
                >
                  删除
                </GlassButton>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
