// 全站唯一的玻璃浮层：主导航。
// 用组件库的 TabBar —— 它本身就是一组 <a>（aria-current 标当前页），无 JS 时也能正常跳转；
// 手机上是底部胶囊，宽屏由 site.css 挪到顶部居中。
import { useEffect, useState } from 'react';
import { GlassProvider, LibraryIcon, TabBar, type TabBarItem } from '@lg-nav';

type Theme = 'light' | 'dark';

// <head> 里的内联脚本已经把主题写在 <html data-lg-theme> 上；这里直接读，保证水合前后一致、不闪。
const readTheme = (): Theme =>
  typeof document !== 'undefined' && document.documentElement.dataset.lgTheme === 'dark' ? 'dark' : 'light';

export interface NavLink {
  key: string;
  href: string;
  label: string;
}

export default function SiteNav({ links, current }: { links: NavLink[]; current?: string }) {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const sync = () => setTheme(readTheme());
    window.addEventListener('themechange', sync);
    return () => window.removeEventListener('themechange', sync);
  }, []);

  const items: TabBarItem[] = links.map((l) => ({ key: l.key, href: l.href, label: l.label }));

  return (
    <GlassProvider theme={theme}>
      <TabBar
        aria-label="主导航"
        items={items}
        current={current}
        search={{ key: 'search', href: '/search/', label: <span className="sr-only">搜索</span>, icon: <LibraryIcon name="search" size={20} /> }}
        sidebarBreakpoint={100000}
      />
    </GlassProvider>
  );
}
