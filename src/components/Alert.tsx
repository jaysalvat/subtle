/**
 * Every warning (orange) or good news (green) in a window or panel: a framed box, the first thing in
 * its body, right under the title (Dialog's `alert`). A number in <strong> stands out. `actions`:
 * buttons on a line under the text.
 */
import type { ReactNode } from 'react';

export function Alert({ tone = 'warning', children, actions }: { tone?: 'warning' | 'success'; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={`alert ${tone}`} role={tone === 'warning' ? 'alert' : 'status'}>
      <div>{children}</div>
      {actions && <div className="alert-actions">{actions}</div>}
    </div>
  );
}
