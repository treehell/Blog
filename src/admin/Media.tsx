// 媒体库：直接浏览 R2 存储桶。点文件复制 CDN 地址，拖文件进来即上传到当前目录。
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { GlassButton, useToast } from '@ttqtt/liquid-glass-react';
import { api, fmtSize, fmtTime, uploadFile, useData } from './api';
import { Empty, PageHead, useConfirm } from './ui';

interface Obj {
  key: string;
  size: number;
  uploaded: number;
  url: string;
}
interface Listing {
  prefix: string;
  folders: string[];
  objects: Obj[];
  cursor: string | null;
}

const isImage = (key: string) => /\.(webp|png|jpe?g|gif|avif|svg|ico)$/i.test(key);

// 线条图标（lucide 的 folder / file），颜色跟随次要文字
const svg = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const FolderIcon = () => (
  <svg {...svg}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
);
const FileIcon = () => (
  <svg {...svg}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
);

export default function Media() {
  const toast = useToast();
  const [ask, dialog] = useConfirm();
  const [prefix, setPrefix] = useState('');
  const [objects, setObjects] = useState<Obj[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [opts] = useData<{ options: Record<string, string> }>('/admin/options');
  const picker = useRef<HTMLInputElement>(null);

  async function load(p: string, more?: string | null) {
    try {
      setError('');
      const r = await api<Listing>(`/admin/media?prefix=${encodeURIComponent(p)}${more ? `&cursor=${encodeURIComponent(more)}` : ''}`);
      setFolders(r.folders);
      setObjects((cur) => (more ? [...cur, ...r.objects] : r.objects));
      setCursor(r.cursor);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load(prefix);
  }, [prefix]);

  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of files) {
      try {
        await uploadFile(f, { webp: opts?.options.upload_webp !== '0', dir: prefix || undefined });
        ok++;
      } catch (e) {
        toast({ message: `${f.name}：${(e as Error).message}`, tone: 'error' });
      }
    }
    setBusy(false);
    if (ok) {
      toast({ message: `已上传 ${ok} 个文件（按「目录/年/月」归档）`, tone: 'success' });
      load(prefix);
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    upload([...e.dataTransfer.files]);
  };

  async function copy(o: Obj) {
    const text = isImage(o.key) ? `![](${o.url})` : o.url;
    try {
      await navigator.clipboard.writeText(text);
      toast({ message: isImage(o.key) ? '已复制 Markdown 图片代码' : '已复制地址', tone: 'success' });
    } catch {
      toast({ message: o.url });
    }
  }

  const crumbs = prefix ? prefix.split('/') : [];

  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop} className={over ? 'media-drop on' : 'media-drop'}>
      {dialog}
      <PageHead title="媒体" hint="R2 存储桶里的文件，通过 CDN 域名访问">
        <input ref={picker} type="file" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <GlassButton variant="glassProminent" loading={busy} onClick={() => picker.current?.click()}>上传文件</GlassButton>
      </PageHead>

      <nav className="media-crumbs" aria-label="目录">
        <button type="button" onClick={() => setPrefix('')}>全部文件</button>
        {crumbs.map((c, i) => (
          <span key={i}> / <button type="button" onClick={() => setPrefix(crumbs.slice(0, i + 1).join('/'))}>{c}</button></span>
        ))}
      </nav>

      {error && <Empty>{error}</Empty>}
      {!error && !folders.length && !objects.length && <Empty>这个目录是空的。把文件拖到这里即可上传。</Empty>}

      <div className="media-grid">
        {folders.map((f) => (
          <button type="button" key={f} className="media-item media-folder" onClick={() => setPrefix(f)}>
            <span className="media-thumb" aria-hidden="true"><FolderIcon /></span>
            <span className="media-name">{f.split('/').pop()}</span>
          </button>
        ))}
        {objects.map((o) => (
          <div key={o.key} className="media-item">
            <button type="button" className="media-thumb" onClick={() => copy(o)} title="点击复制地址">
              {isImage(o.key) ? <img src={o.url} alt="" loading="lazy" decoding="async" /> : <FileIcon />}
            </button>
            <span className="media-name" title={o.key}>{o.key.split('/').pop()}</span>
            <span className="muted-inline">{fmtSize(o.size)} · {fmtTime(o.uploaded).slice(0, 10)}</span>
            <button
              type="button"
              className="media-del"
              aria-label={`删除 ${o.key}`}
              onClick={() =>
                ask({
                  title: '从 R2 删除这个文件？',
                  message: `${o.key}\n引用它的文章会出现裂图，且无法恢复。`,
                  onConfirm: async () => {
                    try {
                      await api(`/admin/media?key=${encodeURIComponent(o.key)}`, { method: 'DELETE' });
                      setObjects((cur) => cur.filter((x) => x.key !== o.key));
                    } catch (e) {
                      toast({ message: (e as Error).message, tone: 'error' });
                    }
                  },
                })
              }
            >
              删除
            </button>
          </div>
        ))}
      </div>
      {cursor && <div className="admin-actions" style={{ justifyContent: 'center' }}><GlassButton variant="gray" onClick={() => load(prefix, cursor)}>加载更多</GlassButton></div>}
    </div>
  );
}
