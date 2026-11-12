// 后台与 /api 的通信，以及几个共用的小工具。
import { useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body || init.form ? 'POST' : 'GET'),
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined),
    credentials: 'same-origin',
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('admin:unauthorized'));
    throw new ApiError(res.status, data?.error || `请求失败（${res.status}）`);
  }
  return data as T;
}

/** 取数据：返回 [数据, 重新加载, 错误信息] */
export function useData<T>(path: string | null): [T | undefined, () => void, string] {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setError('');
    api<T>(path)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  return [data, () => setTick((t) => t + 1), error];
}

export function useHash(): string {
  const [hash, setHash] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}
export const go = (path: string) => {
  location.hash = path;
};

export const fmtTime = (ts: number) => {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export interface DeployResult {
  triggered: number;
  total: number;
  note?: string;
}
export const deployMessage = (d: DeployResult | null | undefined) =>
  !d ? '' : d.total === 0 ? '（未配置部署钩子，前台需手动重新部署）' : d.triggered === d.total ? '，已触发重新构建，约一两分钟后生效' : `，但有 ${d.total - d.triggered} 个部署钩子调用失败`;

/** 图片转 WebP（浏览器内完成）。转完反而更大、或不是 PNG/JPEG 时返回原文件。 */
export async function toWebp(file: File, quality = 0.86): Promise<File> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}

export interface Uploaded {
  key: string;
  url: string;
  size: number;
  type: string;
}
export async function uploadFile(file: File, opts: { webp?: boolean; dir?: string } = {}): Promise<Uploaded & { name: string }> {
  const f = opts.webp ? await toWebp(file) : file;
  const form = new FormData();
  form.append('file', f, f.name);
  if (opts.dir) form.append('dir', opts.dir);
  const out = await api<Uploaded>('/admin/upload', { form });
  return { ...out, name: f.name };
}
