import React from 'react';
import {
  ScheduleBlock,
  ScheduleConfig,
  ScheduleStatusColors,
} from '../../../types.ts';

export type AppointmentsTabId = 'agenda' | 'bloqueios' | 'fila' | 'servicos' | 'config';

export const STATUS_OPTIONS: Array<{
  value: keyof ScheduleStatusColors;
  label: string;
  shortLabel: string;
}> = [
  { value: 'aguardando', label: 'Aguardando', shortLabel: 'Aguardando' },
  { value: 'agendado', label: 'Agendado', shortLabel: 'Agendado' },
  { value: 'confirmado', label: 'Confirmado', shortLabel: 'Confirmado' },
  { value: 'cancelado_cliente', label: 'Cancelado Pelo Cliente', shortLabel: 'Cancel. (Cliente)' },
  { value: 'cancelado_consultor', label: 'Cancelado Pelo Consultor', shortLabel: 'Cancel. (Consultor)' },
  { value: 'nao_compareceu', label: 'Cliente Não Veio', shortLabel: 'Não Compareceu' },
];

export const DEFAULT_STATUS_COLORS: ScheduleStatusColors = {
  aguardando: '#fbbf24',
  agendado: '#3b82f6',
  confirmado: '#10b981',
  cancelado_cliente: '#ef4444',
  cancelado_consultor: '#9ca3af',
  nao_compareceu: '#7f1d1d',
};

export const WEEKDAY_LABELS = [
  { value: 0, short: 'Dom', full: 'Domingo' },
  { value: 1, short: 'Seg', full: 'Segunda' },
  { value: 2, short: 'Ter', full: 'Terça' },
  { value: 3, short: 'Qua', full: 'Quarta' },
  { value: 4, short: 'Qui', full: 'Quinta' },
  { value: 5, short: 'Sex', full: 'Sexta' },
  { value: 6, short: 'Sáb', full: 'Sábado' },
];

export function toDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function toTimeKey(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map((x) => Number(x) || 0);
  return h * 60 + m;
}

export function minutesToTimeKey(totalMins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMins));
  const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mm = String(clamped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function addDaysToKey(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + delta);
  return toDateKey(dt);
}

export function getWeekStartKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const diffToSunday = dt.getDay();
  dt.setDate(dt.getDate() - diffToSunday);
  return toDateKey(dt);
}

export function formatDateLongBR(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatShortDateBR(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function formatDayMonthBR(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export function getWeekdayShortBR(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return WEEKDAY_LABELS[dt.getDay()]?.short || '';
}

export function buildDateKeysBetween(startKey: string, endKey: string, maxDays = 31): string[] {
  if (!startKey) return [toDateKey(new Date())];
  const safeEnd = endKey && endKey >= startKey ? endKey : startKey;
  const result: string[] = [];
  let cur = startKey;
  for (let i = 0; i < maxDays; i++) {
    result.push(cur);
    if (cur >= safeEnd) break;
    cur = addDaysToKey(cur, 1);
  }
  return result;
}

export function buildTimeSlots(config: ScheduleConfig): string[] {
  const startMin = timeToMinutes(config.startTime || '08:00');
  const endMin = timeToMinutes(config.endTime || '19:00');
  const step = Math.max(15, Number(config.slotIntervalMinutes || 30));
  const slots: string[] = [];
  for (let cur = startMin; cur < endMin; cur += step) {
    slots.push(minutesToTimeKey(cur));
  }
  return slots;
}

export function getStatusMeta(status: string, colors: ScheduleStatusColors): {
  label: string;
  hex: string;
} {
  const palette = { ...DEFAULT_STATUS_COLORS, ...(colors || {}) };
  switch (status) {
    case 'aguardando':
      return { label: 'Aguardando', hex: palette.aguardando };
    case 'agendado':
      return { label: 'Agendado', hex: palette.agendado };
    case 'confirmado':
    case 'cumprido':
      return { label: status === 'cumprido' ? 'Cumprido' : 'Confirmado', hex: palette.confirmado };
    case 'cancelado_cliente':
    case 'cancelado':
      return { label: 'Cancelado (Cliente)', hex: palette.cancelado_cliente };
    case 'cancelado_consultor':
      return { label: 'Cancelado (Consultor)', hex: palette.cancelado_consultor };
    case 'nao_compareceu':
    case 'faltoso':
      return { label: 'Não Compareceu', hex: palette.nao_compareceu };
    default:
      return { label: status || 'Agendado', hex: palette.agendado };
  }
}

export function findBlockingEntryForSlot(params: {
  blocks: ScheduleBlock[];
  collaboratorId: number | null;
  consultantUserId: number | null;
  dateKey: string;
  slotStartMin: number;
  slotEndMin: number;
}): ScheduleBlock | null {
  const [y, m, d] = params.dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const weekday = dt.getDay();

  for (const blk of params.blocks) {
    const matchesCollab =
      (params.collaboratorId && blk.collaboratorId === params.collaboratorId) ||
      (params.consultantUserId && blk.consultantId === params.consultantUserId);
    if (!matchesCollab) continue;

    const blkStartKey = toDateKey(new Date(blk.startAt));
    const blkEndKey = toDateKey(new Date(blk.endAt));
    if (params.dateKey < blkStartKey || params.dateKey > blkEndKey) continue;

    const days =
      Array.isArray(blk.weekdays) && blk.weekdays.length > 0
        ? blk.weekdays
        : [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(weekday)) continue;

    if (blk.allDay !== false) return blk;

    const bStart = timeToMinutes(blk.startTime || toTimeKey(new Date(blk.startAt)));
    const bEnd = timeToMinutes(blk.endTime || toTimeKey(new Date(blk.endAt)));
    if (params.slotStartMin < bEnd && params.slotEndMin > bStart) {
      return blk;
    }
  }
  return null;
}

export const HexColorSwatch: React.FC<{
  hex: string;
  className?: string;
}> = ({ hex, className = 'w-4 h-4 rounded-sm shrink-0 border border-slate-300' }) =>
  React.createElement(
    'svg',
    { viewBox: '0 0 16 16', className, 'aria-hidden': true },
    React.createElement('rect', { width: '16', height: '16', fill: hex || '#e0e7ff' })
  );

export const CardTintOverlay: React.FC<{
  hex: string;
}> = ({ hex }) =>
  React.createElement(
    'svg',
    {
      viewBox: '0 0 100 100',
      preserveAspectRatio: 'none',
      className: 'absolute inset-0 w-full h-full pointer-events-none',
      'aria-hidden': true,
    },
    React.createElement('rect', { width: '100', height: '100', fill: hex || '#3b82f6', fillOpacity: '0.14' }),
    React.createElement('rect', { width: '100', height: '4', fill: hex || '#3b82f6', fillOpacity: '0.88' })
  );

export const BlockedHatchOverlay: React.FC<{ patternId: string }> = ({ patternId }) =>
  React.createElement(
    'svg',
    {
      className: 'absolute inset-0 w-full h-full pointer-events-none opacity-65',
      'aria-hidden': true,
    },
    React.createElement(
      'defs',
      null,
      React.createElement(
        'pattern',
        {
          id: patternId,
          width: '8',
          height: '8',
          patternTransform: 'rotate(45 0 0)',
          patternUnits: 'userSpaceOnUse',
        },
        React.createElement('line', {
          x1: '0',
          y1: '0',
          x2: '0',
          y2: '8',
          stroke: '#cbd5e1',
          strokeWidth: '3',
        })
      )
    ),
    React.createElement('rect', { width: '100%', height: '100%', fill: `url(#${patternId})` })
  );
