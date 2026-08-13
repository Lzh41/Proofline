import type { ReactNode } from 'react';
import { ArrowRight, Inbox } from 'lucide-react';
import clsx from 'clsx';
import styles from './PagePrimitives.module.css';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

interface SectionHeaderProps {
  title: string;
  meta?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, meta, action }: SectionHeaderProps) {
  return (
    <div className={styles.sectionHeader}>
      <div>
        <h2>{title}</h2>
        {meta && <span>{meta}</span>}
      </div>
      {action}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  message: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ title, message, action, compact }: EmptyStateProps) {
  return (
    <div className={clsx(styles.empty, compact && styles.compact)}>
      <Inbox size={20} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {action}
    </div>
  );
}

interface MetricProps {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: 'default' | 'accent' | 'danger' | 'info';
}

export function Metric({ label, value, detail, tone = 'default' }: MetricProps) {
  return (
    <div className={clsx(styles.metric, styles[`tone_${tone}`])}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export function InlineLink({ children }: { children: ReactNode }) {
  return <span className={styles.inlineLink}>{children}<ArrowRight size={14} /></span>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const safe = Math.min(100, Math.max(0, value));
  return (
    <div className={styles.progress}>
      <div className={styles.progressLabel}><span>{label}</span><strong>{Math.round(safe)}%</strong></div>
      <div className={styles.track}><span style={{ width: `${safe}%` }} /></div>
    </div>
  );
}
