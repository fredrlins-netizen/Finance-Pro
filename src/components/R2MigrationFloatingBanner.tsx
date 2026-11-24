import React, { useState, useSyncExternalStore } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  FileText,
  FolderOpen,
  Loader2,
  ShieldCheck,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import {
  cancelBrowserFolderSync,
  dismissR2SyncBanner,
  getR2SyncSnapshot,
  ProcessingFileStage,
  subscribeR2Sync,
} from '../services/r2BrowserSyncManager.ts';

interface R2MigrationFloatingBannerProps {
  isOnMigrationTab: boolean;
  onOpenMigrationTab: () => void;
}

function stageLabel(stage: ProcessingFileStage): { text: string; cls: string } {
  switch (stage) {
    case 'hashing':
      return {
        text: 'Lendo',
        cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
    case 'verificando':
      return {
        text: 'Verificando',
        cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300',
      };
    case 'enviando':
      return {
        text: 'Enviando',
        cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300',
      };
    case 'deduplicado':
      return {
        text: 'Já no cofre',
        cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
    case 'erro':
      return {
        text: 'Falha',
        cls: 'bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300',
      };
    default:
      return {
        text: 'Enviado',
        cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300',
      };
  }
}

export const R2MigrationFloatingBanner: React.FC<R2MigrationFloatingBannerProps> = ({
  isOnMigrationTab,
  onOpenMigrationTab,
}) => {
  const syncState = useSyncExternalStore(subscribeR2Sync, getR2SyncSnapshot);
  const [minimized, setMinimized] = useState(false);

  if (!syncState) return null;
  // On the Migration R2 screen itself, the full inline card is already displayed
  if (isOnMigrationTab) return null;

  const pct =
    syncState.totalFiles > 0
      ? Math.min(100, Math.round((syncState.processedFiles / syncState.totalFiles) * 100))
      : 0;

  return (
    <aside
      aria-label="Progresso da Migração R2 em segundo plano"
      className="fixed bottom-20 md:bottom-4 right-4 z-40 w-[min(94vw,430px)] rounded-xl border-2 border-emerald-500/80 bg-white shadow-2xl dark:border-emerald-600/80 dark:bg-slate-900 text-slate-900 dark:text-slate-100 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-slate-900 text-white dark:bg-slate-950 border-b border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          {syncState.running ? (
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400 shrink-0" />
          ) : syncState.cancelled ? (
            <XCircle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-display text-xs font-bold truncate">
              {syncState.running
                ? syncState.cancelling
                  ? 'Cancelando Migração R2...'
                  : 'Migração R2 (64 GB) em 2º plano'
                : syncState.cancelled
                ? 'Migração R2 Cancelada'
                : 'Migração R2 Concluída'}
            </div>
            <div className="font-mono text-[10px] text-slate-300 truncate">
              {syncState.batchCode ? `${syncState.batchCode} · ` : ''}
              {syncState.rootLabel} · {pct}% ({syncState.processedFiles}/{syncState.totalFiles})
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setMinimized((v) => !v)}
            title={minimized ? 'Expandir detalhes' : 'Minimizar'}
            className="p-1 rounded hover:bg-slate-800 text-slate-300 hover:text-white"
          >
            {minimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {!syncState.running && (
            <button
              type="button"
              onClick={dismissR2SyncBanner}
              title="Fechar aviso"
              className="p-1 rounded hover:bg-slate-800 text-slate-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar (always visible even when minimized) */}
      <div className="px-3.5 pt-2.5 pb-2 space-y-2">
        <progress
          value={syncState.processedFiles}
          max={Math.max(1, syncState.totalFiles)}
          className="w-full h-2 accent-emerald-600 rounded-full overflow-hidden"
        />

        {syncState.running && (
          <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/70 rounded-md px-2 py-1">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              Inatividade suspensa durante esta rotina
            </span>
            <span className="font-mono tabular-nums shrink-0">{pct}%</span>
          </div>
        )}

        {!minimized && (
          <>
            {/* Counters */}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
              <span>
                Subpastas: <strong className="text-slate-900 dark:text-white">{syncState.subfoldersCount}</strong>
              </span>
              <span>
                Novos: <strong className="text-emerald-700 dark:text-emerald-300">{syncState.created}</strong>
              </span>
              <span>
                Atualiz.: <strong className="text-blue-700 dark:text-blue-300">{syncState.updated}</strong>
              </span>
              <span>
                Dedup.: <strong>{syncState.deduplicated}</strong>
              </span>
              {syncState.failed > 0 && (
                <span>
                  Falhas: <strong className="text-red-700 dark:text-red-400">{syncState.failed}</strong>
                </span>
              )}
            </div>

            {/* Active Folders & Files Being Processed */}
            {(syncState.currentFolderPath || syncState.processingEntries.length > 0) && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-1.5 dark:border-slate-800 dark:bg-slate-950/70">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700 dark:text-slate-200">
                  <FolderOpen className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                  <span className="truncate" title={syncState.currentFolderPath}>
                    Pasta atual: {syncState.currentFolderPath || syncState.rootLabel}
                  </span>
                </div>

                {syncState.processingEntries.length > 0 && (
                  <div className="max-h-28 overflow-y-auto space-y-1 pr-0.5">
                    {syncState.processingEntries.slice(0, 5).map((entry) => {
                      const badge = stageLabel(entry.stage);
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between gap-2 text-[10px] rounded border border-slate-200/80 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {entry.fileName}
                              </div>
                              <div className="font-mono text-[9px] text-slate-500 dark:text-slate-400 truncate">
                                {entry.folderPath}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold shrink-0 ${badge.cls}`}
                          >
                            {badge.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <button
            type="button"
            onClick={onOpenMigrationTab}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <CloudUpload className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
            Abrir Migração R2
          </button>

          {syncState.running ? (
            <button
              type="button"
              disabled={syncState.cancelling}
              onClick={() => void cancelBrowserFolderSync()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-800 disabled:opacity-60 whitespace-nowrap"
            >
              <Square className="w-3 h-3" />
              {syncState.cancelling ? 'Cancelando...' : 'Cancelar Processo'}
            </button>
          ) : (
            <button
              type="button"
              onClick={dismissR2SyncBanner}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Ocultar
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
