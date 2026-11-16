// 后台入口：登录态、导航、路由。
// 导航用 TabBar：窄屏是底部胶囊，宽屏自动展开成侧边栏 —— 同一个组件，不用维护两套。
import { useEffect, useState, type FormEvent } from 'react';
import { Banner, GlassButton, GlassProvider, TabBar, Text, TextField, ToastProvider, useToast } from '@ttqtt/liquid-glass-react';
import '@ttqtt/liquid-glass-react/style.css';
import '../styles/site.css';
import './admin.css';
import { api, go, useHash } from './api';
import Dashboard from './Dashboard';
import Contents from './Contents';
import Editor from './Editor';
import Comments from './Comments';
import Media from './Media';
import Settings from './Settings';

const NAV = [
  { key: '', href: '#/', label: '概要' },
  { key: 'content', href: '#/content', label: '内容' },
  { key: 'media', href: '#/media', label: '媒体' },
  { key: 'settings', href: '#/settings', label: '设置' },
];

export default function Admin() {
  return (
    <GlassProvider theme="system">
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </GlassProvider>
  );
}

function Shell() {
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [proxyOrigin, setProxyOrigin] = useState('');
  const hash = useHash();

  useEffect(() => {
    // 经 EdgeOne 转发时请求体上限 1MB，提示改用 Cloudflare 域名下的后台
    api<{ mode: string; origin?: string }>('/health')
      .then((h) => h.mode === 'proxy' && setProxyOrigin(h.origin || ''))
      .catch(() => {});
    api<{ user: string | null }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
    const out = () => setUser(null);
    window.addEventListener('admin:unauthorized', out);
    return () => window.removeEventListener('admin:unauthorized', out);
  }, []);

  if (user === undefined) return <p className="admin-center muted">加载中…</p>;
  if (user === null) return <Login onDone={setUser} />;

  const [, section = '', ...rest] = hash.split('?')[0].split('/');
  const current = section === 'write' ? 'content' : section;

  return (
    <>
      <TabBar aria-label="后台导航" items={NAV} current={current} sidebarHeader={<Text variant="headline" as="div">博客后台</Text>} />
      <main className="admin-main">
        {proxyOrigin && (
          <Banner
            tone="warning"
            title="当前经 EdgeOne 转发访问"
            message="这条线路的上传上限是 1MB。传大图或附件请改用 Cloudflare 域名下的后台。"
            action={{ label: '前往', onSelect: () => (location.href = `${proxyOrigin}/admin/`) }}
          />
        )}
        {section === '' && <Dashboard />}
        {section === 'content' && <Contents />}
        {section === 'write' && <Editor key={rest.join('/')} type={rest[0] === 'page' ? 'page' : 'post'} cid={rest[1] && rest[1] !== 'new' ? Number(rest[1]) : null} />}
        {section === 'comments' && <Comments />}
        {section === 'media' && <Media />}
        {section === 'settings' && <Settings user={user} onLogout={() => setUser(null)} />}
      </main>
    </>
  );
}

function Login({ onDone }: { onDone: (user: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      const r = await api<{ user: string }>('/auth/login', { body: { user: f.get('user'), password: f.get('password') } });
      toast({ message: '已登录', tone: 'success' });
      if (!location.hash) go('/');
      onDone(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-login" onSubmit={submit}>
      <Text variant="title1" as="h1" emphasized>博客后台</Text>
      <Text tone="secondary" as="p">登录后管理文章与媒体文件</Text>
      <TextField label="用户名" name="user" autoComplete="username" required autoFocus />
      <TextField label="密码" name="password" type="password" autoComplete="current-password" required error={error || undefined} />
      <GlassButton type="submit" variant="glassProminent" controlSize="large" loading={busy}>登录</GlassButton>
      <a href="/" className="muted" style={{ textAlign: 'center' }}>← 返回前台</a>
    </form>
  );
}
