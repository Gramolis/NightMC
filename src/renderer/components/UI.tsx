/** Podstawowe elementy interfejsu NightMC. */

import { useEffect, type ReactNode } from 'react';
import { formatBytes, formatEta, formatSpeed } from '../api.js';
import type { DownloadProgress } from '../../shared/types.js';
import { IconWarn } from './Icons.js';

/* ---------------------------------------------------------- przyciski */

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  small,
  title,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  small?: boolean;
  title?: string;
  type?: 'button' | 'submit';
}) {
  const cls = ['btn', variant !== 'default' ? variant : '', small ? 'small' : ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- karty */

export function Card({
  title,
  subtitle,
  children,
  actions,
  tight,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  tight?: boolean;
}) {
  return (
    <section className={`card${tight ? ' tight' : ''}`}>
      {(title || actions) && (
        <div className="row" style={{ marginBottom: subtitle ? 2 : 12 }}>
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub" style={{ marginBottom: 0 }}>{subtitle}</p>}
          </div>
          <div className="spacer" />
          {actions}
        </div>
      )}
      {subtitle && <div style={{ height: 12 }} />}
      {children}
    </section>
  );
}

/* -------------------------------------------------------------- pola */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span>{label}</span>
    </label>
  );
}

/* ------------------------------------------------------------ postęp */

export function ProgressBar({ progress, indeterminate }: { progress: number; indeterminate?: boolean }) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div
      className={`progress${indeterminate ? ' indeterminate' : ''}`}
      role="progressbar"
      aria-label="Postęp pobierania"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      <div className="progress-fill" style={{ width: `${indeterminate ? 34 : pct}%` }} />
    </div>
  );
}

export function DownloadPanel({ progress }: { progress: DownloadProgress }) {
  const known = progress.bytesTotal > 0 || progress.filesTotal > 0;
  const percent = Math.round(Math.max(0, Math.min(1, progress.progress)) * 100);
  return (
    <div className="fade-in">
      <div className="row" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{progress.phase}</strong>
        <div className="spacer" />
        <span className="progress-percent">{known ? `${percent}%` : '…'}</span>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {progress.filesTotal > 0 ? `${progress.filesDone} / ${progress.filesTotal}` : ''}
        </span>
      </div>
      <ProgressBar progress={progress.progress} indeterminate={!known} />
      <div className="progress-meta">
        <span className="file" title={progress.currentFile}>{progress.currentFile || 'Przygotowanie…'}</span>
        <span>
          {formatBytes(progress.bytesDone)}
          {progress.bytesTotal > 0 ? ` / ${formatBytes(progress.bytesTotal)}` : ''} · {formatSpeed(progress.speed)} ·
          pozostało {formatEta(progress.etaSeconds)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ modale */

export function Modal({
  title,
  children,
  onClose,
  actions,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(940px, 94vw)' } : undefined}>
        <h2>{title}</h2>
        <div style={{ marginTop: 14 }}>{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Potwierdź',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>Anuluj</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p style={{ margin: 0, lineHeight: 1.65, color: 'var(--text-dim)' }}>{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------ banery */

export function Banner({
  kind = 'warn',
  children,
}: {
  kind?: 'warn' | 'info' | 'err';
  children: ReactNode;
}) {
  return (
    <div className={`banner${kind === 'warn' ? '' : ` ${kind}`}`}>
      <IconWarn size={17} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {hint && <p style={{ margin: '0 auto', maxWidth: '52ch', lineHeight: 1.65 }}>{hint}</p>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}

export function Chip({ children, tone = 'violet' }: { children: ReactNode; tone?: 'violet' | 'cyan' | 'ok' | 'warn' | 'err' | 'dim' }) {
  return <span className={`chip${tone === 'violet' ? '' : ` ${tone}`}`}>{children}</span>;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
