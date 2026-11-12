// 后台各页共用的小部件
import { useState, type ReactNode } from 'react';
import { GlassAlert, Text } from '@ttqtt/liquid-glass-react';

export function PageHead({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <header className="admin-head">
      <div>
        <Text variant="largeTitle" as="h1" emphasized>{title}</Text>
        {hint && <Text tone="secondary" variant="subhead" as="p">{hint}</Text>}
      </div>
      {children && <div className="admin-actions">{children}</div>}
    </header>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted admin-empty">{children}</p>;
}

/** 危险操作前的确认框。用法：const [ask, dialog] = useConfirm(); ask({ title, message, onConfirm }) */
export function useConfirm(): [(o: { title: string; message?: string; label?: string; onConfirm: () => void }) => void, ReactNode] {
  const [state, setState] = useState<{ title: string; message?: string; label?: string; onConfirm: () => void } | null>(null);
  const dialog = (
    <GlassAlert
      open={!!state}
      onOpenChange={(open) => !open && setState(null)}
      title={state?.title ?? ''}
      message={state?.message}
      actions={[
        { key: 'cancel', label: '取消', role: 'cancel' },
        { key: 'ok', label: state?.label ?? '删除', role: 'destructive', onSelect: () => state?.onConfirm() },
      ]}
    />
  );
  return [setState, dialog];
}

export const STATUS_LABEL: Record<string, string> = { publish: '已发布', draft: '草稿', hidden: '隐藏', approved: '已通过', pending: '待审核', spam: '垃圾' };
