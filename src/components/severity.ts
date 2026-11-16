import type { Severity } from '../lib/rules/types';

/** The label and colours for each level of finding, shared by the findings and comparison panels. */
export const BADGE: Record<Severity, { label: string; className: string }> = {
  high: { label: 'High', className: 'bg-red text-white' },
  warn: { label: 'Warning', className: 'bg-amber-tint text-amber' },
  info: { label: 'Note', className: 'bg-surface text-ink-soft' },
};
