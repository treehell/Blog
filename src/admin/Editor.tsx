// 撰写文章 / 页面。参考 Typecho 的撰写页：左边写 Markdown，右边是发布选项；
// 图片和附件直接拖进来、粘贴或点按钮选择，自动传到 R2 并插入 CDN 地址。
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { GlassButton, GlassCheckbox, GlassSegmentedControl, GlassSwitch, GlassToolbar, Picker, Text, TextField, ToolbarGroup, useToast } from '@ttqtt/liquid-glass-react';
import { renderMarkdown } from '../lib/markdown';
import { api, deployMessage, go, uploadFile, useData, type DeployResult } from './api';
import { PageHead, useConfirm } from './ui';

interface Draft {
  title: string;
  slug: string;
  text: string;
  summary: string;
  cover: string;
  status: string;
  template: string;
  sort_order: number;
  allow_comment: number;
  created: number;
}
interface MetaRow {
  mid: number;
  type: string;
  name: string;
}

const EMPTY: Draft = { title: '', slug: '', text: '', summary: '', cover: '', status: 'draft', template: '', sort_order: 0, allow_comment: 1, created: 0 };
const STATUS = [
  { value: 'draft', label: '草稿' },
  { value: 'publish', label: '发布' },
  { value: 'hidden', label: '隐藏' },
];
const TEMPLATES = [
  { value: '', label: '默认（Markdown 正文）' },
  { value: 'archives', label: '归档时间线' },
];

const toLocal = (ts: number) => {
  const d = new Date((ts || Date.now() / 1000) * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function Editor({ type, cid }: { type: 'post' | 'page'; cid: number | null }) {
  const toast = useToast();
  const [ask, dialog] = useConfirm();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [categories, setCategories] = useState<number[]>([]);
  const [tags, setTags] = useState('');
  const [loaded, setLoaded] = useState(cid === null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [preview, setPreview] = useState('');
  const [metas] = useData<{ metas: MetaRow[] }>('/admin/metas');
  const [opts] = useData<{ options: Record<string, string> }>('/admin/options');
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const noun = type === 'post' ? '文章' : '页面';
  const webp = opts?.options.upload_webp !== '0';

  useEffect(() => {
    if (cid === null) return;
    api<{ content: Draft; categories: number[]; tags: string[] }>(`/admin/contents/${cid}`)
      .then((r) => {
        setDraft({ ...EMPTY, ...r.content });
        setCategories(r.categories);
        setTags(r.tags.join(', '));
        setLoaded(true);
      })
      .catch((e: Error) => toast({ message: e.message, tone: 'error' }));
  }, [cid]);

  // 离开前提醒未保存的修改
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (mode !== 'preview') return;
    let alive = true;
    renderMarkdown(draft.text, { siteUrl: opts?.options.site_url }).then((r) => alive && setPreview(r.html));
    return () => {
      alive = false;
    };
  }, [mode, draft.text]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };

  /** 在光标处插入；有选区时用 before/after 包住选区 */
  function insert(before: string, after = '', placeholder = '') {
    const el = area.current;
    if (!el) return set('text', draft.text + before + placeholder + after);
    const { selectionStart: s, selectionEnd: e, value } = el;
    const middle = value.slice(s, e) || placeholder;
    set('text', value.slice(0, s) + before + middle + after + value.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + middle.length);
    });
  }

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading((n) => n + files.length);
    for (const file of files) {
      try {
        const out = await uploadFile(file, { webp });
        const alt = out.name.replace(/\.\w+$/, '');
        const md = out.type.startsWith('image/') || /\.(webp|png|jpe?g|gif|avif|svg)$/i.test(out.name) ? `![${alt}](${out.url})` : `[${out.name}](${out.url})`;
        const el = area.current;
        const pos = el ? el.selectionStart : draft.text.length;
        setDraft((d) => {
          const p = Math.min(pos, d.text.length);
          const lead = p > 0 && d.text[p - 1] !== '\n' ? '\n' : '';
          return { ...d, text: d.text.slice(0, p) + lead + md + '\n' + d.text.slice(p) };
        });
        setDirty(true);
        toast({ message: `已上传 ${out.name}`, tone: 'success' });
      } catch (e) {
        toast({ message: `${file.name}：${(e as Error).message}`, tone: 'error' });
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      upload(files);
    }
  };
  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const files = [...e.dataTransfer.files];
    if (files.length) {
      e.preventDefault();
      upload(files);
    }
  };

  async function uploadCover(file?: File) {
    if (!file) return;
    try {
      set('cover', (await uploadFile(file, { webp })).url);
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  async function localize() {
    try {
      const r = await api<{ text: string; done: unknown[]; failed: { from: string; error: string }[] }>('/admin/localize', { body: { text: draft.text } });
      if (r.done.length) set('text', r.text);
      toast({
        message: r.done.length || r.failed.length ? `已转存 ${r.done.length} 张外链图片${r.failed.length ? `，${r.failed.length} 张失败` : ''}` : '正文里没有需要转存的外链图片',
        tone: r.failed.length ? 'warning' : 'success',
      });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  async function save(status = draft.status) {
    if (!draft.title.trim()) return toast({ message: '请先填写标题', tone: 'warning' });
    setSaving(true);
    try {
      const body = { ...draft, status, type, categories, tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) };
      const r = await api<{ cid: number; slug: string; deployed: DeployResult | null }>(cid === null ? '/admin/contents' : `/admin/contents/${cid}`, { method: cid === null ? 'POST' : 'PUT', body });
      setDraft((d) => ({ ...d, status, slug: r.slug }));
      setDirty(false);
      toast({ message: `${status === 'draft' ? '草稿已保存' : `${noun}已保存`}${deployMessage(r.deployed)}`, tone: 'success' });
      if (cid === null) go(`/write/${type}/${r.cid}`);
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    ask({
      title: `删除这篇${noun}？`,
      message: '删除后无法恢复。',
      onConfirm: async () => {
        try {
          await api(`/admin/contents/${cid}`, { method: 'DELETE' });
          setDirty(false);
          toast({ message: '已删除', tone: 'success' });
          go(`/content?tab=${type}`);
        } catch (e) {
          toast({ message: (e as Error).message, tone: 'error' });
        }
      },
    });
  }

  if (!loaded) return <p className="muted admin-empty">加载中…</p>;

  const cats = (metas?.metas ?? []).filter((m) => m.type === 'category');
  const path = `/${type === 'post' ? 'archives/' : ''}${draft.slug || (cid ?? '（保存后生成）')}/`;

  return (
    <>
      {dialog}
      <PageHead title={cid === null ? `撰写${noun}` : `编辑${noun}`} hint={dirty ? '有未保存的修改' : draft.status === 'publish' ? <a href={path} target="_blank" rel="noopener">查看 {path}</a> : undefined}>
        <GlassButton variant="plain" onClick={() => go(`/content?tab=${type}`)}>返回</GlassButton>
        <GlassButton variant="gray" loading={saving} onClick={() => save('draft')}>存为草稿</GlassButton>
        <GlassButton variant="glassProminent" loading={saving} onClick={() => save(draft.status === 'draft' ? 'publish' : draft.status)}>
          {draft.status === 'draft' ? '发布' : '保存'}
        </GlassButton>
      </PageHead>

      <div className="editor">
        <section className="editor-main">
          <TextField label="标题" labelHidden placeholder="标题" controlSize="large" value={draft.title} onChange={(e) => set('title', e.target.value)} />
          <div className="editor-bar">
            <GlassToolbar aria-label="编辑工具">
              <ToolbarGroup
                items={[
                  { key: 'b', label: '粗体', onSelect: () => insert('**', '**', '粗体') },
                  { key: 'i', label: '斜体', onSelect: () => insert('*', '*', '斜体') },
                  { key: 'h', label: '标题', onSelect: () => insert('\n## ', '\n', '小标题') },
                  { key: 'a', label: '链接', onSelect: () => insert('[', '](https://)', '链接文字') },
                  { key: 'q', label: '引用', onSelect: () => insert('\n> ', '\n', '引用') },
                  { key: 'c', label: '代码', onSelect: () => insert('\n```\n', '\n```\n', '代码') },
                  { key: 'g', label: '图片组', onSelect: () => insert('\n[PicGrid]\n', '\n[/PicGrid]\n', '') },
                  { key: 'p', label: '折叠面板', onSelect: () => insert('\n[collapsible-panel title="标题"]\n', '\n[/collapsible-panel]\n', '内容') },
                ]}
              />
              <ToolbarGroup
                items={[
                  { key: 'up', label: uploading ? `上传中（${uploading}）` : '上传', onSelect: () => picker.current?.click() },
                  { key: 'lz', label: '外链转存', onSelect: localize },
                ]}
              />
            </GlassToolbar>
            <GlassSegmentedControl aria-label="编辑或预览" items={[{ value: 'write', label: '编辑' }, { value: 'preview', label: '预览' }]} value={mode} onValueChange={(v) => setMode(v as 'write' | 'preview')} />
          </div>
          <input ref={picker} type="file" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
          {mode === 'write' ? (
            <textarea
              ref={area}
              className="editor-area"
              aria-label="正文（Markdown）"
              placeholder="用 Markdown 写作。图片或文件可以直接拖进来或粘贴，会自动上传到 R2。"
              spellCheck={false}
              value={draft.text}
              onChange={(e) => set('text', e.target.value)}
              onPaste={onPaste}
              onDrop={onDrop}
            />
          ) : (
            <div className="sheet editor-preview"><div className="prose" dangerouslySetInnerHTML={{ __html: preview }} /></div>
          )}
        </section>

        <aside className="editor-side">
          <div className="admin-panel">
            <Text variant="footnote" tone="secondary" as="div">状态</Text>
            <GlassSegmentedControl aria-label="状态" items={STATUS} value={draft.status} onValueChange={(v) => set('status', v)} />
            <TextField label="缩略名（网址）" value={draft.slug} onChange={(e) => set('slug', e.target.value)} hint={`留空则用编号。地址：${path}`} />
            <TextField label="发布时间" type="datetime-local" value={toLocal(draft.created)} onChange={(e) => set('created', Math.floor(new Date(e.target.value).getTime() / 1000) || 0)} />
            {type === 'page' && (
              <>
                <Picker label="页面模板" options={TEMPLATES} value={draft.template} onValueChange={(v) => set('template', v)} />
                <TextField label="导航顺序" type="number" value={String(draft.sort_order)} onChange={(e) => set('sort_order', Number(e.target.value))} hint="数字小的排前面；状态为「隐藏」的页面不进导航" />
              </>
            )}
          </div>

          {type === 'post' && (
            <div className="admin-panel">
              <Text variant="footnote" tone="secondary" as="div">分类</Text>
              {cats.map((c) => (
                <GlassCheckbox
                  key={c.mid}
                  label={c.name}
                  checked={categories.includes(c.mid)}
                  onCheckedChange={(on) => { setCategories((cur) => (on ? [...cur, c.mid] : cur.filter((x) => x !== c.mid))); setDirty(true); }}
                />
              ))}
              <TextField label="标签" value={tags} onChange={(e) => { setTags(e.target.value); setDirty(true); }} hint="多个标签用逗号分隔，不存在的会自动创建" />
            </div>
          )}

          <div className="admin-panel">
            <TextField label="封面图" value={draft.cover} onChange={(e) => set('cover', e.target.value)} placeholder="https://…（留空则取正文第一张图）" />
            {draft.cover && <img className="editor-cover" src={draft.cover} alt="封面预览" />}
            <label className="admin-file">
              <input type="file" accept="image/*" hidden onChange={(e) => { uploadCover(e.target.files?.[0]); e.target.value = ''; }} />
              <span>上传封面到 R2</span>
            </label>
            <TextField label="摘要" multiline rows={3} value={draft.summary} onChange={(e) => set('summary', e.target.value)} hint="显示在列表卡片与搜索结果里" />          </div>

          {cid !== null && <GlassButton variant="destructive" onClick={remove}>删除这篇{noun}</GlassButton>}
        </aside>
      </div>
    </>
  );
}
