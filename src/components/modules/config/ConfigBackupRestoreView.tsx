import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudOff,
  CloudUpload,
  Database,
  Download,
  Edit3,
  ExternalLink,
  FolderPlus,
  HardDrive,
  History,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  apiFetch,
  formatBytes,
  formatDateTimeBR,
  getActiveUnitHeader,
  getAuthToken,
  parseJsonResponse,
} from '../../../lib/api.ts';
import {
  clearGoogleDriveAccessToken,
  getCachedGoogleDriveUser,
  getGoogleDriveAccessToken,
  initGoogleDriveAuth,
  signInWithGoogleDrive,
} from '../../../lib/googleDriveAuth.ts';
import {
  createDriveFolder,
  deleteBackupFromGoogleDrive,
  downloadBackupFromGoogleDrive,
  DriveBackupFileItem,
  DriveFolderItem,
  ensureDriveBackupFolder,
  listDriveBackupFiles,
  listDriveFolders,
  uploadBackupToGoogleDrive,
} from '../../../lib/googleDriveClient.ts';
import { ConfirmDeleteModal } from '../cadastros/CadastrosShared.tsx';

interface BackupScheduleItem {
  id: number;
  name: string;
  cloudProvider: string;
  targetFolderId: string;
  targetFolderName: string;
  daysOfWeek: number[];
  executionTime: string;
  includeUsersAndGroups: boolean;
  includeAuditLogs: boolean;
  compressGzip: boolean;
  retentionCount: number;
  active: boolean;
  lastRunAt: string | null;
  lastRunStatus: string;
  lastRunMessage: string;
  nextRunAt: string | null;
  createdByName: string;
  createdAt: string;
}

interface BackupExecutionItem {
  id: number;
  scheduleId: number | null;
  operationType: string;
  triggerType: string;
  cloudProvider: string;
  fileName: string;
  driveFileId: string;
  driveFolderId: string;
  driveWebViewLink: string;
  localVaultSha256: string;
  sizeBytes: number;
  sha256Hash: string;
  totalTables: number;
  totalRows: number;
  usersCount: number;
  userGroupsCount: number;
  includesUsersAndGroups: boolean;
  status: string;
  driveSyncStatus: string;
  errorMessage: string;
  executedByName: string;
  startedAt: string;
  completedAt: string | null;
}

interface DbInventory {
  databaseName: string;
  totalTables: number;
  totalRows: number;
  usersCount: number;
  userGroupsCount: number;
  tables: Array<{ tableName: string; rowCount: number }>;
}

interface BackupInspection {
  valid: boolean;
  format: string;
  version: string;
  createdAt: string;
  createdBy: string;
  databaseName: string;
  includesUsersAndGroups: boolean;
  includesAuditLogs: boolean;
  checksumValid: boolean;
  checksumSha256: string;
  totalTables: number;
  totalRows: number;
  usersCount: number;
  userGroupsCount: number;
  tableRowCounts: Record<string, number>;
  missingInTargetSchema: string[];
  warnings: string[];
}

interface PendingRestoreContext {
  sourceType: 'local_file' | 'google_drive' | 'server_snapshot';
  sourceLabel: string;
  fileName: string;
  file?: File;
  blob?: Blob;
  driveFileId?: string;
  executionId?: number;
  inspection: BackupInspection;
}

interface ConfigBackupRestoreViewProps {
  wsTick?: number;
  onToast: (msg: string) => void;
  onDatabaseRestored?: () => Promise<void> | void;
}

const WEEKDAYS = [
  { value: 0, short: 'Dom', full: 'Domingo' },
  { value: 1, short: 'Seg', full: 'Segunda' },
  { value: 2, short: 'Ter', full: 'Terça' },
  { value: 3, short: 'Qua', full: 'Quarta' },
  { value: 4, short: 'Qui', full: 'Quinta' },
  { value: 5, short: 'Sex', full: 'Sexta' },
  { value: 6, short: 'Sáb', full: 'Sábado' },
];

export const ConfigBackupRestoreView: React.FC<ConfigBackupRestoreViewProps> = ({
  wsTick,
  onToast,
  onDatabaseRestored,
}) => {
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<DbInventory | null>(null);
  const [showAllTables, setShowAllTables] = useState(false);
  const [schedules, setSchedules] = useState<BackupScheduleItem[]>([]);
  const [executions, setExecutions] = useState<BackupExecutionItem[]>([]);
  const [serverTimeBRT, setServerTimeBRT] = useState('');

  // Manual backup options
  const [includeUsersAndGroups, setIncludeUsersAndGroups] = useState(true);
  const [includeAuditLogs, setIncludeAuditLogs] = useState(true);
  const [compressGzip, setCompressGzip] = useState(true);
  const [backupBusy, setBackupBusy] = useState(false);

  // Google Drive Auth & State (strictly in-memory token)
  const [driveToken, setDriveToken] = useState<string | null>(() => getGoogleDriveAccessToken());
  const [driveUser, setDriveUser] = useState<{ email: string; displayName: string; photoURL: string } | null>(() =>
    getCachedGoogleDriveUser()
  );
  const [driveAuthBusy, setDriveAuthBusy] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [driveFolders, setDriveFolders] = useState<DriveFolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [newFolderName, setNewFolderName] = useState('FinancePro_Backups');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveBackupFileItem[]>([]);
  const [deleteDriveTarget, setDeleteDriveTarget] = useState<DriveBackupFileItem | null>(null);
  const [deleteDriveBusy, setDeleteDriveBusy] = useState(false);

  // Restore State
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<PendingRestoreContext | null>(null);
  const [restoreUsersOption, setRestoreUsersOption] = useState(true);
  const [preserveScheduleOption, setPreserveScheduleOption] = useState(true);
  const [restoreConfirmChecked, setRestoreConfirmChecked] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreErr, setRestoreErr] = useState('');

  // Schedule CRUD Modal
  const [schedModalOpen, setSchedModalOpen] = useState(false);
  const [editSchedId, setEditSchedId] = useState<number | null>(null);
  const [schedName, setSchedName] = useState('');
  const [schedProvider, setSchedProvider] = useState<'google_drive' | 'server_snapshot'>('google_drive');
  const [schedFolderName, setSchedFolderName] = useState('FinancePro_Backups');
  const [schedFolderId, setSchedFolderId] = useState('');
  const [schedDays, setSchedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [schedTime, setSchedTime] = useState('02:00');
  const [schedIncUsers, setSchedIncUsers] = useState(true);
  const [schedIncAudit, setSchedIncAudit] = useState(true);
  const [schedCompress, setSchedCompress] = useState(true);
  const [schedRetention, setSchedRetention] = useState(10);
  const [schedActive, setSchedActive] = useState(true);
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedErr, setSchedErr] = useState('');
  const [deleteSchedTarget, setDeleteSchedTarget] = useState<BackupScheduleItem | null>(null);
  const [runningSchedId, setRunningSchedId] = useState<number | null>(null);
  const [syncingExecutionId, setSyncingExecutionId] = useState<number | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const data = await apiFetch<{
        inventory: DbInventory;
        schedules: BackupScheduleItem[];
        executions: BackupExecutionItem[];
        serverTimeBRT: string;
      }>('/api/admin/backup/overview');
      setInventory(data.inventory || null);
      setSchedules(data.schedules || []);
      setExecutions(data.executions || []);
      setServerTimeBRT(data.serverTimeBRT || '');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao carregar dados de backup.');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  const loadDriveContents = useCallback(
    async (token: string, folderIdOverride?: string) => {
      setDriveBusy(true);
      setDriveError('');
      try {
        const folders = await listDriveFolders(token);
        setDriveFolders(folders);
        let activeFolderId = folderIdOverride || selectedFolderId;
        if (!activeFolderId || !folders.some((f) => f.id === activeFolderId)) {
          const ensured = await ensureDriveBackupFolder(token, 'FinancePro_Backups');
          activeFolderId = ensured.id;
          if (!folders.some((f) => f.id === ensured.id)) {
            setDriveFolders((prev) => [ensured, ...prev]);
          }
          setSelectedFolderId(ensured.id);
        }
        const files = await listDriveBackupFiles(token, activeFolderId);
        setDriveFiles(files);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao acessar Google Drive.';
        setDriveError(msg);
        if (msg.toLowerCase().includes('expirada') || msg.toLowerCase().includes('401')) {
          clearGoogleDriveAccessToken();
          setDriveToken(null);
          setDriveUser(null);
        }
      } finally {
        setDriveBusy(false);
      }
    },
    [selectedFolderId]
  );

  useEffect(() => {
    loadOverview();
  }, [loadOverview, wsTick]);

  useEffect(() => {
    const unsub = initGoogleDriveAuth(
      (_user, tok) => {
        setDriveToken(tok);
        setDriveUser(getCachedGoogleDriveUser());
      },
      () => {
        setDriveToken(null);
        setDriveUser(null);
        setDriveFiles([]);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (driveToken) {
      loadDriveContents(driveToken);
    }
  }, [driveToken, loadDriveContents]);

  const handleConnectGoogleDrive = async () => {
    setDriveAuthBusy(true);
    setDriveError('');
    try {
      const res = await signInWithGoogleDrive();
      setDriveToken(res.accessToken);
      setDriveUser({
        email: res.email,
        displayName: res.displayName,
        photoURL: res.photoURL,
      });
      onToast(`Google Drive conectado (${res.email}).`);
      await loadDriveContents(res.accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível conectar ao Google Drive.';
      setDriveError(msg);
    } finally {
      setDriveAuthBusy(false);
    }
  };

  const handleDisconnectDrive = () => {
    clearGoogleDriveAccessToken();
    setDriveToken(null);
    setDriveUser(null);
    setDriveFiles([]);
    setDriveFolders([]);
    setSelectedFolderId('');
    onToast('Sessão do Google Drive desconectada da memória.');
  };

  const handleCreateDriveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driveToken || !newFolderName.trim()) return;
    setDriveBusy(true);
    try {
      const folder = await createDriveFolder(driveToken, newFolderName.trim());
      setDriveFolders((prev) => [folder, ...prev]);
      setSelectedFolderId(folder.id);
      setShowNewFolderInput(false);
      onToast(`Pasta "${folder.name}" criada no Google Drive.`);
      await loadDriveContents(driveToken, folder.id);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Erro ao criar pasta.');
    } finally {
      setDriveBusy(false);
    }
  };

  const requestServerBackupBlob = async (cloudProvider: 'google_drive' | 'local_download') => {
    const token = getAuthToken();
    const res = await fetch('/api/admin/backup/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-unit-id': String(getActiveUnitHeader()),
      },
      body: JSON.stringify({
        includeUsersAndGroups,
        includeAuditLogs,
        compressGzip,
        cloudProvider,
        driveFolderId: selectedFolderId,
        saveToLocalVault: true,
      }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error || `Falha ao gerar backup (HTTP ${res.status}).`);
    }

    const executionId = Number(res.headers.get('X-Backup-Execution-Id') || 0);
    const fileName =
      res.headers.get('X-Backup-File-Name') ||
      `financepro_full_backup.${compressGzip ? 'fpbackup.json.gz' : 'fpbackup.json'}`;
    const sha256 = res.headers.get('X-Backup-Sha256') || '';
    const tables = res.headers.get('X-Backup-Tables') || '0';
    const rows = res.headers.get('X-Backup-Rows') || '0';
    const users = res.headers.get('X-Backup-Users') || '0';
    const groups = res.headers.get('X-Backup-Groups') || '0';
    const blob = await res.blob();

    return { executionId, fileName, sha256, tables, rows, users, groups, blob };
  };

  const handleBackupToGoogleDrive = async () => {
    if (!driveToken) {
      onToast('Conecte sua conta do Google Drive primeiro.');
      return;
    }
    setBackupBusy(true);
    setDriveError('');
    try {
      const folder = await ensureDriveBackupFolder(
        driveToken,
        driveFolders.find((f) => f.id === selectedFolderId)?.name || 'FinancePro_Backups',
        selectedFolderId || undefined
      );
      setSelectedFolderId(folder.id);

      const exported = await requestServerBackupBlob('google_drive');
      const uploaded = await uploadBackupToGoogleDrive(driveToken, {
        fileName: exported.fileName,
        blob: exported.blob,
        mimeType: compressGzip ? 'application/gzip' : 'application/json',
        folderId: folder.id,
        appProperties: {
          app: 'financepro',
          sha256: exported.sha256,
          tables: exported.tables,
          rows: exported.rows,
          users: exported.users,
          groups: exported.groups,
        },
      });

      if (exported.executionId) {
        await apiFetch(`/api/admin/backup/executions/${exported.executionId}/drive-metadata`, {
          method: 'POST',
          body: JSON.stringify({
            driveFileId: uploaded.id,
            driveFolderId: folder.id,
            driveWebViewLink: uploaded.webViewLink || '',
            driveSyncStatus: 'sincronizado',
          }),
        });
      }

      onToast(
        `Backup completo enviado ao Google Drive (${exported.tables} tabelas · ${exported.rows} registros · ${exported.users} usuários · ${exported.groups} grupos).`
      );
      await Promise.all([loadOverview(), loadDriveContents(driveToken, folder.id)]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha no backup para o Google Drive.';
      setDriveError(msg);
      onToast(msg);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleDownloadLocalBackup = async () => {
    setBackupBusy(true);
    try {
      const exported = await requestServerBackupBlob('local_download');
      const url = URL.createObjectURL(exported.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exported.fileName;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      onToast(
        `Backup completo baixado (${exported.fileName} · ${exported.tables} tabelas · ${exported.users} usuários · ${exported.groups} grupos).`
      );
      await loadOverview();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao baixar backup.');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleSyncExecutionToDrive = async (exec: BackupExecutionItem) => {
    if (!driveToken) {
      onToast('Conecte o Google Drive para enviar snapshots pendentes.');
      return;
    }
    setSyncingExecutionId(exec.id);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/admin/backup/executions/${exec.id}/download`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'x-unit-id': String(getActiveUnitHeader()),
        },
      });
      if (!res.ok) throw new Error('Falha ao obter arquivo do cofre para sincronização.');
      const blob = await res.blob();

      const folder = await ensureDriveBackupFolder(
        driveToken,
        driveFolders.find((f) => f.id === (exec.driveFolderId || selectedFolderId))?.name || 'FinancePro_Backups',
        exec.driveFolderId || selectedFolderId || undefined
      );

      const uploaded = await uploadBackupToGoogleDrive(driveToken, {
        fileName: exec.fileName,
        blob,
        mimeType: exec.fileName.endsWith('.gz') ? 'application/gzip' : 'application/json',
        folderId: folder.id,
        appProperties: {
          app: 'financepro',
          executionId: String(exec.id),
          sha256: exec.sha256Hash || '',
        },
      });

      await apiFetch(`/api/admin/backup/executions/${exec.id}/drive-metadata`, {
        method: 'POST',
        body: JSON.stringify({
          driveFileId: uploaded.id,
          driveFolderId: folder.id,
          driveWebViewLink: uploaded.webViewLink || '',
          driveSyncStatus: 'sincronizado',
        }),
      });

      onToast(`Snapshot "${exec.fileName}" sincronizado com o Google Drive.`);
      await Promise.all([loadOverview(), loadDriveContents(driveToken, folder.id)]);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao sincronizar snapshot com o Drive.');
    } finally {
      setSyncingExecutionId(null);
    }
  };

  const handleInspectFile = async (file: File) => {
    setInspectBusy(true);
    setRestoreErr('');
    try {
      const form = new FormData();
      form.append('file', file);
      const token = getAuthToken();
      const res = await fetch('/api/admin/backup/inspect', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'x-unit-id': String(getActiveUnitHeader()),
        },
        body: form,
      });
      const data = await parseJsonResponse<{ inspection: BackupInspection }>(
        res,
        'Erro ao validar arquivo de backup'
      );
      setRestoreUsersOption(data.inspection.includesUsersAndGroups);
      setPreserveScheduleOption(true);
      setRestoreConfirmChecked(false);
      setPendingRestore({
        sourceType: 'local_file',
        sourceLabel: 'Arquivo Local',
        fileName: file.name,
        file,
        inspection: data.inspection,
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Arquivo de backup inválido.');
    } finally {
      setInspectBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleInspectDriveFile = async (driveFile: DriveBackupFileItem) => {
    if (!driveToken) return;
    setInspectBusy(true);
    setRestoreErr('');
    try {
      const blob = await downloadBackupFromGoogleDrive(driveToken, driveFile.id);
      const form = new FormData();
      form.append('file', blob, driveFile.name);
      const token = getAuthToken();
      const res = await fetch('/api/admin/backup/inspect', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'x-unit-id': String(getActiveUnitHeader()),
        },
        body: form,
      });
      const data = await parseJsonResponse<{ inspection: BackupInspection }>(
        res,
        'Erro ao validar backup do Google Drive'
      );
      setRestoreUsersOption(data.inspection.includesUsersAndGroups);
      setPreserveScheduleOption(true);
      setRestoreConfirmChecked(false);
      setPendingRestore({
        sourceType: 'google_drive',
        sourceLabel: 'Google Drive (Nuvem)',
        fileName: driveFile.name,
        blob,
        driveFileId: driveFile.id,
        inspection: data.inspection,
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao inspecionar backup do Google Drive.');
    } finally {
      setInspectBusy(false);
    }
  };

  const handleInspectServerSnapshot = async (exec: BackupExecutionItem) => {
    setInspectBusy(true);
    setRestoreErr('');
    try {
      const data = await apiFetch<{ inspection: BackupInspection }>('/api/admin/backup/inspect', {
        method: 'POST',
        body: JSON.stringify({ executionId: exec.id }),
      });
      setRestoreUsersOption(data.inspection.includesUsersAndGroups);
      setPreserveScheduleOption(true);
      setRestoreConfirmChecked(false);
      setPendingRestore({
        sourceType: 'server_snapshot',
        sourceLabel: 'Snapshot no Cofre do Servidor',
        fileName: exec.fileName,
        executionId: exec.id,
        inspection: data.inspection,
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao validar snapshot.');
    } finally {
      setInspectBusy(false);
    }
  };

  const handleExecuteRestore = async () => {
    if (!pendingRestore || !restoreConfirmChecked) return;
    setRestoreBusy(true);
    setRestoreErr('');
    try {
      const token = getAuthToken();
      let res: Response;
      if (pendingRestore.sourceType === 'server_snapshot' && pendingRestore.executionId) {
        res = await fetch('/api/admin/backup/restore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'x-unit-id': String(getActiveUnitHeader()),
          },
          body: JSON.stringify({
            executionId: pendingRestore.executionId,
            restoreUsersAndGroups: restoreUsersOption,
            preserveBackupConfig: preserveScheduleOption,
            sourceLabel: pendingRestore.sourceLabel,
          }),
        });
      } else {
        const form = new FormData();
        if (pendingRestore.file) {
          form.append('file', pendingRestore.file, pendingRestore.fileName);
        } else if (pendingRestore.blob) {
          form.append('file', pendingRestore.blob, pendingRestore.fileName);
        }
        form.append('restoreUsersAndGroups', String(restoreUsersOption));
        form.append('preserveBackupConfig', String(preserveScheduleOption));
        form.append('sourceLabel', pendingRestore.sourceLabel);
        form.append('fileName', pendingRestore.fileName);
        if (pendingRestore.driveFileId) {
          form.append('driveFileId', pendingRestore.driveFileId);
        }
        res = await fetch('/api/admin/backup/restore', {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'x-unit-id': String(getActiveUnitHeader()),
          },
          body: form,
        });
      }

      const result = await parseJsonResponse<{
        ok: boolean;
        restoredTables: number;
        restoredRows: number;
        usersRestored: number;
        userGroupsRestored: number;
        preRestoreSnapshotFileName: string;
      }>(res, 'Erro ao restaurar base de dados');

      setPendingRestore(null);
      onToast(
        `Restauração concluída! ${result.restoredTables} tabelas · ${result.restoredRows} registros · ${result.usersRestored} usuários · ${result.userGroupsRestored} grupos. Snapshot pré-restore: ${result.preRestoreSnapshotFileName}`
      );
      await loadOverview();
      await onDatabaseRestored?.();
    } catch (err) {
      setRestoreErr(err instanceof Error ? err.message : 'Falha na restauração.');
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleDownloadDriveFile = async (driveFile: DriveBackupFileItem) => {
    if (!driveToken) return;
    try {
      const blob = await downloadBackupFromGoogleDrive(driveToken, driveFile.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = driveFile.name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao baixar arquivo do Google Drive.');
    }
  };

  const handleConfirmDeleteDriveFile = async () => {
    if (!driveToken || !deleteDriveTarget) return;
    setDeleteDriveBusy(true);
    try {
      await deleteBackupFromGoogleDrive(driveToken, deleteDriveTarget.id);
      onToast(`Arquivo "${deleteDriveTarget.name}" removido do Google Drive.`);
      setDeleteDriveTarget(null);
      await loadDriveContents(driveToken);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao excluir arquivo do Google Drive.');
    } finally {
      setDeleteDriveBusy(false);
    }
  };

  // Schedule CRUD handlers
  const openNewSchedule = () => {
    setEditSchedId(null);
    setSchedName('Backup Automático Diário');
    setSchedProvider('google_drive');
    setSchedFolderId(selectedFolderId || '');
    setSchedFolderName(
      driveFolders.find((f) => f.id === selectedFolderId)?.name || 'FinancePro_Backups'
    );
    setSchedDays([1, 2, 3, 4, 5]);
    setSchedTime('02:00');
    setSchedIncUsers(true);
    setSchedIncAudit(true);
    setSchedCompress(true);
    setSchedRetention(10);
    setSchedActive(true);
    setSchedErr('');
    setSchedModalOpen(true);
  };

  const openEditSchedule = (s: BackupScheduleItem) => {
    setEditSchedId(s.id);
    setSchedName(s.name);
    setSchedProvider(s.cloudProvider === 'server_snapshot' ? 'server_snapshot' : 'google_drive');
    setSchedFolderId(s.targetFolderId || selectedFolderId || '');
    setSchedFolderName(s.targetFolderName || 'FinancePro_Backups');
    setSchedDays(Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [1, 2, 3, 4, 5]);
    setSchedTime(s.executionTime || '02:00');
    setSchedIncUsers(s.includeUsersAndGroups !== false);
    setSchedIncAudit(s.includeAuditLogs !== false);
    setSchedCompress(s.compressGzip !== false);
    setSchedRetention(s.retentionCount || 10);
    setSchedActive(s.active !== false);
    setSchedErr('');
    setSchedModalOpen(true);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedName.trim()) {
      setSchedErr('Informe o nome da política de agendamento.');
      return;
    }
    if (schedDays.length === 0) {
      setSchedErr('Selecione pelo menos um dia da semana.');
      return;
    }
    setSchedSaving(true);
    setSchedErr('');
    try {
      const payload = {
        name: schedName.trim(),
        cloudProvider: schedProvider,
        targetFolderId: schedFolderId,
        targetFolderName: schedFolderName.trim() || 'FinancePro_Backups',
        daysOfWeek: schedDays,
        executionTime: schedTime,
        includeUsersAndGroups: schedIncUsers,
        includeAuditLogs: schedIncAudit,
        compressGzip: schedCompress,
        retentionCount: schedRetention,
        active: schedActive,
      };
      if (editSchedId) {
        await apiFetch(`/api/admin/backup/schedules/${editSchedId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast('Agendamento de backup atualizado.');
      } else {
        await apiFetch('/api/admin/backup/schedules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast('Agendamento automático de backup criado.');
      }
      setSchedModalOpen(false);
      await loadOverview();
    } catch (err) {
      setSchedErr(err instanceof Error ? err.message : 'Erro ao salvar agendamento.');
    } finally {
      setSchedSaving(false);
    }
  };

  const handleRunScheduleNow = async (s: BackupScheduleItem) => {
    setRunningSchedId(s.id);
    try {
      const res = await apiFetch<{ ok: boolean; execution: BackupExecutionItem }>(
        `/api/admin/backup/schedules/${s.id}/run-now`,
        { method: 'POST' }
      );
      onToast(`Backup "${s.name}" executado no cofre.`);
      if (driveToken && s.cloudProvider === 'google_drive' && res.execution) {
        await handleSyncExecutionToDrive(res.execution);
      } else {
        await loadOverview();
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erro ao executar agendamento.');
    } finally {
      setRunningSchedId(null);
    }
  };

  const pendingDriveSyncs = useMemo(
    () =>
      executions.filter(
        (e) =>
          e.operationType === 'backup' &&
          e.cloudProvider === 'google_drive' &&
          e.driveSyncStatus === 'pendente_sync' &&
          e.localVaultSha256
      ),
    [executions]
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        Carregando inventário do banco de dados e políticas de backup...
      </div>
    );
  }

  return (
    <div className="space-y-5 text-xs">
      {/* 1. Inventário da Base de Dados */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Backup &amp; Restore Completo da Base de Dados (PostgreSQL + Usuários &amp; Grupos RBAC)
              </h2>
            </div>
            <p className="mt-1 text-slate-500 dark:text-slate-400">
              Cópia integral em nuvem (Google Drive) ou local, com verificação SHA-256, snapshot automático pré-restore e agendamento por dias e horários (BRT: <span className="font-mono">{serverTimeBRT || 'America/Sao_Paulo'}</span>).
            </p>
          </div>
          <button
            type="button"
            onClick={loadOverview}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar Inventário
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Tabelas na Base ({inventory?.databaseName})</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums dark:text-slate-100">
              {inventory?.totalTables ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Total de Registros</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums dark:text-slate-100">
              {(inventory?.totalRows ?? 0).toLocaleString('pt-BR')}
            </div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-800/60 dark:bg-emerald-950/40">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
              <Users className="w-3.5 h-3.5" />
              Usuários &amp; Grupos RBAC
            </div>
            <div className="mt-1 font-mono text-lg font-bold text-emerald-900 tabular-nums dark:text-emerald-200">
              {inventory?.usersCount ?? 0} usuários · {inventory?.userGroupsCount ?? 0} grupos
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Agendamentos Ativos</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums dark:text-slate-100">
              {schedules.filter((s) => s.active).length} / {schedules.length}
            </div>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAllTables((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            {showAllTables ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showAllTables ? 'Ocultar lista detalhada de tabelas' : `Ver todas as ${inventory?.totalTables ?? 0} tabelas incluídas no backup`}
          </button>
          {showAllTables && inventory && (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 max-h-52 overflow-y-auto dark:border-slate-800 dark:bg-slate-950">
              {inventory.tables.map((t) => (
                <div
                  key={t.tableName}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-900"
                >
                  <span className="font-mono truncate text-slate-700 dark:text-slate-200" title={t.tableName}>
                    {t.tableName}
                  </span>
                  <span className="font-mono font-bold text-slate-900 tabular-nums dark:text-emerald-300">
                    {t.rowCount}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2. Conexão com Google Drive (Nuvem) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300 shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Armazenamento em Nuvem · Google Drive
              </h3>
              <p className="text-slate-500 dark:text-slate-400">
                {driveToken && driveUser
                  ? `Conectado como ${driveUser.displayName} (${driveUser.email}). Os backups são salvos na pasta dedicada do aplicativo.`
                  : 'Conecte sua conta Google para enviar, listar, baixar e restaurar backups completos diretamente no Google Drive.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {!driveToken ? (
              <button
                type="button"
                disabled={driveAuthBusy}
                onClick={handleConnectGoogleDrive}
                className="gsi-material-button inline-flex items-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <div className="gsi-material-button-state" />
                <div className="gsi-material-button-content-wrapper flex items-center gap-2.5">
                  <div className="gsi-material-button-icon w-4 h-4 shrink-0">
                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="block w-4 h-4">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {driveAuthBusy ? 'Conectando...' : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Google Drive Conectado
                </span>
                <button
                  type="button"
                  onClick={() => driveToken && loadDriveContents(driveToken)}
                  disabled={driveBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${driveBusy ? 'animate-spin' : ''}`} />
                  Atualizar Drive
                </button>
                <button
                  type="button"
                  onClick={handleDisconnectDrive}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-50 dark:border-red-800/70 dark:text-red-300 dark:hover:bg-red-950/60"
                >
                  <CloudOff className="w-3.5 h-3.5" />
                  Desconectar
                </button>
              </>
            )}
          </div>
        </div>

        {driveError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-800 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
            {driveError}
          </div>
        )}

        {driveToken && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-700 dark:text-slate-200">Pasta de Destino no Drive:</span>
              <select
                value={selectedFolderId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedFolderId(nextId);
                  if (driveToken && nextId) loadDriveContents(driveToken, nextId);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {driveFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    📁 {f.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewFolderInput((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                Nova Pasta
              </button>
            </div>

            {showNewFolderInput && (
              <form onSubmit={handleCreateDriveFolder} className="flex items-center gap-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Nome da pasta..."
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={driveBusy}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600"
                >
                  Criar
                </button>
              </form>
            )}
          </div>
        )}

        {driveToken && pendingDriveSyncs.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
            <div>
              <strong>{pendingDriveSyncs.length} backup(s) agendado(s)</strong> executados no servidor aguardando envio para o Google Drive.
            </div>
            <button
              type="button"
              onClick={async () => {
                for (const ex of pendingDriveSyncs) {
                  await handleSyncExecutionToDrive(ex);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 shrink-0"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              Sincronizar Todos para o Drive
            </button>
          </div>
        )}
      </div>

      {/* 3. Ações Manuais: Backup Completo & Restore */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Card Backup */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <CloudUpload className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Executar Backup Manual Completo
            </h3>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
              <input
                type="checkbox"
                checked={includeUsersAndGroups}
                onChange={(e) => setIncludeUsersAndGroups(e.target.checked)}
              />
              <span>Incluir Usuários, Senhas (Hash) e Grupos de Usuário (RBAC)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
              <input
                type="checkbox"
                checked={includeAuditLogs}
                onChange={(e) => setIncludeAuditLogs(e.target.checked)}
              />
              <span>Incluir Logs de Auditoria Corporativa</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
              <input
                type="checkbox"
                checked={compressGzip}
                onChange={(e) => setCompressGzip(e.target.checked)}
              />
              <span>Compactar em GZIP (.fpbackup.json.gz)</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={backupBusy || !driveToken}
              onClick={handleBackupToGoogleDrive}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <CloudUpload className="w-4 h-4" />
              {backupBusy ? 'Processando...' : 'Fazer Backup Agora → Google Drive'}
            </button>
            <button
              type="button"
              disabled={backupBusy}
              onClick={handleDownloadLocalBackup}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <Download className="w-4 h-4" />
              Baixar Backup Local
            </button>
          </div>
          {!driveToken && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              Conecte sua conta Google acima para habilitar o envio direto ao Google Drive.
            </p>
          )}
        </div>

        {/* Card Restore */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Restaurar Base de Dados (Restore Completo)
            </h3>
          </div>

          <p className="text-slate-600 dark:text-slate-300">
            Importe um arquivo de backup local (<span className="font-mono">.fpbackup.json.gz</span> ou <span className="font-mono">.json</span>) ou selecione um backup armazenado no <strong>Google Drive</strong> na lista abaixo. O sistema valida o checksum SHA-256 e cria um snapshot de segurança antes de restaurar.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".gz,.json,.fpbackup.json,.fpbackup.json.gz"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleInspectFile(file);
            }}
          />

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={inspectBusy}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-900/60"
            >
              <Upload className="w-4 h-4" />
              {inspectBusy ? 'Validando arquivo...' : 'Selecionar Arquivo Local para Restore'}
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 inline mr-1.5 text-emerald-600 dark:text-emerald-400" />
            Restauração transacional atômica: se ocorrer qualquer erro durante a gravação, toda a operação é revertida automaticamente (ROLLBACK).
          </div>
        </div>
      </div>

      {/* 4. Tabela de Agendamento Automático (Dias e Horários) */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
          <div>
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-slate-800 dark:text-emerald-400" />
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Tabela de Agendamento Automático de Backups (Dias &amp; Horários)
              </h3>
            </div>
            <p className="text-slate-500 dark:text-slate-400">
              Programe dias da semana e horários (fuso Brasília · BRT) para execução automática do backup integral da base, usuários e grupos.
            </p>
          </div>
          <button
            type="button"
            onClick={openNewSchedule}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Agendamento Automático
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2.5">Política / Nome</th>
                <th className="px-4 py-2.5">Destino em Nuvem</th>
                <th className="px-4 py-2.5">Dias da Semana</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Horário (BRT)</th>
                <th className="px-4 py-2.5">Escopo</th>
                <th className="px-4 py-2.5">Última / Próxima Execução</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {schedules.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    Nenhum agendamento automático cadastrado. Clique em &ldquo;Novo Agendamento Automático&rdquo; para programar dias e horários.
                  </td>
                </tr>
              ) : (
                schedules.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{s.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Retenção: {s.retentionCount} cópia(s) · {s.compressGzip ? 'GZIP' : 'JSON'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800 dark:text-slate-200">
                        {s.cloudProvider === 'google_drive' ? '☁️ Google Drive' : '🗄️ Cofre do Servidor'}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {s.targetFolderName || 'FinancePro_Backups'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {WEEKDAYS.map((wd) => {
                          const enabled = (s.daysOfWeek || []).includes(wd.value);
                          return (
                            <span
                              key={wd.value}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                enabled
                                  ? 'bg-slate-900 text-white dark:bg-emerald-600'
                                  : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                              }`}
                            >
                              {wd.short}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-emerald-300">
                      {s.executionTime}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-700 dark:text-slate-300">
                      <div>{s.includeUsersAndGroups ? 'Base + Usuários & Grupos' : 'Base (sem Usuários)'}</div>
                      <div className="text-slate-500 dark:text-slate-400">
                        {s.includeAuditLogs ? 'Com Auditoria' : 'Sem Auditoria'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[11px]">
                      <div className="text-slate-700 dark:text-slate-200">
                        Última: {s.lastRunAt ? formatDateTimeBR(s.lastRunAt) : 'Nunca'}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">
                        Próxima: {s.nextRunAt ? formatDateTimeBR(s.nextRunAt) : '—'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/admin/backup/schedules/${s.id}/toggle`, { method: 'PATCH' });
                          await loadOverview();
                        }}
                        className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                          s.active
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {s.active ? 'Ativo' : 'Pausado'}
                      </button>
                      {s.lastRunStatus && s.lastRunStatus !== 'pendente' && (
                        <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[140px]" title={s.lastRunMessage}>
                          {s.lastRunStatus.toUpperCase()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          disabled={runningSchedId === s.id}
                          onClick={() => handleRunScheduleNow(s)}
                          title="Executar Backup Agora"
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                        >
                          <Play className="w-3 h-3" />
                          {runningSchedId === s.id ? '...' : 'Executar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditSchedule(s)}
                          title="Editar Agendamento"
                          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteSchedTarget(s)}
                          title="Excluir Agendamento"
                          className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Backups Armazenados no Google Drive */}
      {driveToken && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Arquivos de Backup no Google Drive ({driveFiles.length})
              </h3>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Pasta: <strong>{driveFolders.find((f) => f.id === selectedFolderId)?.name || 'FinancePro_Backups'}</strong>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2.5">Arquivo no Google Drive</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Tamanho</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Criado em</th>
                  <th className="px-4 py-2.5">Metadados</th>
                  <th className="px-4 py-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {driveFiles.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                      Nenhum arquivo de backup encontrado nesta pasta do Google Drive ainda.
                    </td>
                  </tr>
                ) : (
                  driveFiles.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5">
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{f.name}</div>
                        {f.webViewLink && (
                          <a
                            href={f.webViewLink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                          >
                            Abrir no Google Drive <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {formatBytes(f.size)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {formatDateTimeBR(f.createdTime)}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {f.appProperties?.tables
                          ? `${f.appProperties.tables} tab. · ${f.appProperties.rows || '?'} reg. · ${f.appProperties.users || '?'} usr.`
                          : 'Backup FinancePro'}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={inspectBusy}
                            onClick={() => handleInspectDriveFile(f)}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Restaurar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadDriveFile(f)}
                            title="Baixar arquivo"
                            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteDriveTarget(f)}
                            title="Excluir do Google Drive"
                            className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. Histórico de Execuções (Backups & Restores) */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-700">
          <History className="w-4 h-4 text-slate-700 dark:text-slate-300" />
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Histórico de Execuções (Backups &amp; Restores)
          </h3>
        </div>

        <div className="overflow-x-auto max-h-[45vh] scroll-rulers">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2.5">Data / Hora</th>
                <th className="px-4 py-2.5">Operação</th>
                <th className="px-4 py-2.5">Arquivo</th>
                <th className="px-4 py-2.5">Conteúdo</th>
                <th className="px-4 py-2.5">Tamanho</th>
                <th className="px-4 py-2.5">Nuvem / Sync</th>
                <th className="px-4 py-2.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {executions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                    Nenhuma operação de backup ou restore registrada ainda.
                  </td>
                </tr>
              ) : (
                executions.map((ex) => (
                  <tr key={ex.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-200">
                      <div>{formatDateTimeBR(ex.startedAt)}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">{ex.executedByName}</div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          ex.operationType === 'restore'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                        }`}
                      >
                        {ex.operationType} · {ex.triggerType}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                        {ex.fileName}
                      </div>
                      {ex.sha256Hash && (
                        <div className="font-mono text-[10px] text-slate-400">
                          SHA-256: {ex.sha256Hash.slice(0, 16)}...
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-700 dark:text-slate-300">
                      {ex.totalTables} tab. · {ex.totalRows} reg. · {ex.usersCount} usr. · {ex.userGroupsCount} grp.
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatBytes(ex.sizeBytes)}
                    </td>
                    <td className="px-4 py-2.5 text-[11px]">
                      {ex.driveFileId ? (
                        <span className="font-semibold text-blue-700 dark:text-blue-400">
                          ☁️ Google Drive (Sincronizado)
                        </span>
                      ) : ex.driveSyncStatus === 'pendente_sync' ? (
                        <span className="font-semibold text-amber-700 dark:text-amber-300">
                          ⏳ Aguardando Sync Drive
                        </span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">{ex.cloudProvider}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {ex.operationType === 'backup' && ex.localVaultSha256 && (
                          <>
                            {ex.driveSyncStatus === 'pendente_sync' && driveToken && (
                              <button
                                type="button"
                                disabled={syncingExecutionId === ex.id}
                                onClick={() => handleSyncExecutionToDrive(ex)}
                                className="rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                              >
                                {syncingExecutionId === ex.id ? 'Enviando...' : 'Enviar p/ Drive'}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={inspectBusy}
                              onClick={() => handleInspectServerSnapshot(ex)}
                              className="rounded-md border border-amber-300 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/60"
                            >
                              Restaurar
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const token = getAuthToken();
                                const r = await fetch(`/api/admin/backup/executions/${ex.id}/download`, {
                                  headers: {
                                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                                    'x-unit-id': String(getActiveUnitHeader()),
                                  },
                                });
                                if (!r.ok) return onToast('Snapshot indisponível.');
                                const b = await r.blob();
                                const url = URL.createObjectURL(b);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = ex.fileName;
                                a.click();
                                window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
                              }}
                              title="Baixar snapshot do cofre"
                              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Criar / Editar Agendamento Automático */}
      {schedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSaveSchedule}
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {editSchedId ? 'Editar Agendamento Automático' : 'Novo Agendamento Automático de Backup'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSchedModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {schedErr && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                {schedErr}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                  Nome da Política de Backup *
                </label>
                <input
                  type="text"
                  required
                  value={schedName}
                  onChange={(e) => setSchedName(e.target.value)}
                  placeholder="Ex: Backup Diário Madrugada (Base + Usuários)"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Destino</label>
                  <select
                    value={schedProvider}
                    onChange={(e) => setSchedProvider(e.target.value as 'google_drive' | 'server_snapshot')}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="google_drive">Google Drive (Nuvem)</option>
                    <option value="server_snapshot">Cofre Seguro do Servidor</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                    Horário de Execução (BRT) *
                  </label>
                  <input
                    type="time"
                    required
                    value={schedTime}
                    onChange={(e) => setSchedTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              {schedProvider === 'google_drive' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                    Pasta de Destino no Google Drive
                  </label>
                  <input
                    type="text"
                    value={schedFolderName}
                    onChange={(e) => setSchedFolderName(e.target.value)}
                    placeholder="FinancePro_Backups"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-700 dark:text-slate-200">
                    Dias da Semana *
                  </label>
                  <div className="flex gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSchedDays([0, 1, 2, 3, 4, 5, 6])}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setSchedDays([1, 2, 3, 4, 5])}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Seg–Sex
                    </button>
                    <button
                      type="button"
                      onClick={() => setSchedDays([0, 6])}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Fim de semana
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {WEEKDAYS.map((wd) => {
                    const selected = schedDays.includes(wd.value);
                    return (
                      <button
                        key={wd.value}
                        type="button"
                        onClick={() =>
                          setSchedDays((prev) =>
                            prev.includes(wd.value)
                              ? prev.filter((d) => d !== wd.value)
                              : [...prev, wd.value].sort()
                          )
                        }
                        className={`rounded-lg border py-2 font-semibold transition-colors ${
                          selected
                            ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                            : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {wd.short}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                    Retenção (cópias mantidas)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={schedRetention}
                    onChange={(e) => setSchedRetention(Number(e.target.value || 10))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={schedIncUsers}
                    onChange={(e) => setSchedIncUsers(e.target.checked)}
                  />
                  <span>Incluir Usuários e Grupos RBAC</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={schedIncAudit}
                    onChange={(e) => setSchedIncAudit(e.target.checked)}
                  />
                  <span>Incluir Logs de Auditoria</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={schedCompress}
                    onChange={(e) => setSchedCompress(e.target.checked)}
                  />
                  <span>Compactar com GZIP</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-emerald-700 dark:text-emerald-300">
                  <input
                    type="checkbox"
                    checked={schedActive}
                    onChange={(e) => setSchedActive(e.target.checked)}
                  />
                  <span>Agendamento Ativo</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSchedModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={schedSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Check className="w-3.5 h-3.5" />
                {schedSaving ? 'Salvando...' : 'Salvar Agendamento'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Confirmação Obrigatória de Restore */}
      {pendingRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 dark:bg-slate-950/85">
          <div className="w-full max-w-xl rounded-2xl border border-amber-300 bg-white p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto dark:border-amber-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Confirmar Restauração Completa da Base de Dados
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Origem: {pendingRestore.sourceLabel} · {pendingRestore.fileName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingRestore(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {restoreErr && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                {restoreErr}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-800/60">
                <div className="text-[10px] text-slate-500">Tabelas</div>
                <div className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                  {pendingRestore.inspection.totalTables}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-800/60">
                <div className="text-[10px] text-slate-500">Registros</div>
                <div className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                  {pendingRestore.inspection.totalRows.toLocaleString('pt-BR')}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 dark:border-emerald-800 dark:bg-emerald-950/40">
                <div className="text-[10px] text-emerald-700 dark:text-emerald-300">Usuários</div>
                <div className="font-mono font-bold text-sm text-emerald-900 dark:text-emerald-200">
                  {pendingRestore.inspection.usersCount}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 dark:border-emerald-800 dark:bg-emerald-950/40">
                <div className="text-[10px] text-emerald-700 dark:text-emerald-300">Grupos RBAC</div>
                <div className="font-mono font-bold text-sm text-emerald-900 dark:text-emerald-200">
                  {pendingRestore.inspection.userGroupsCount}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1 text-[11px] dark:border-slate-800 dark:bg-slate-800/60">
              <div>
                <strong>Gerado em:</strong> {formatDateTimeBR(pendingRestore.inspection.createdAt)} por{' '}
                {pendingRestore.inspection.createdBy}
              </div>
              <div>
                <strong>Integridade SHA-256:</strong>{' '}
                <span
                  className={
                    pendingRestore.inspection.checksumValid
                      ? 'font-bold text-emerald-700 dark:text-emerald-300'
                      : 'font-bold text-red-700 dark:text-red-400'
                  }
                >
                  {pendingRestore.inspection.checksumValid ? 'VÁLIDO' : 'INVÁLIDO'}
                </span>
              </div>
            </div>

            {pendingRestore.inspection.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {pendingRestore.inspection.warnings.map((w, i) => (
                  <div key={i}>• {w}</div>
                ))}
              </div>
            )}

            <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={restoreUsersOption}
                  onChange={(e) => setRestoreUsersOption(e.target.checked)}
                />
                <span>Restaurar também Usuários e Grupos de Usuário (RBAC) do backup</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={preserveScheduleOption}
                  onChange={(e) => setPreserveScheduleOption(e.target.checked)}
                />
                <span>Preservar a Tabela de Agendamentos Automáticos e Histórico atuais</span>
              </label>
            </div>

            <label className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50/70 p-3 cursor-pointer text-red-900 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-200">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={restoreConfirmChecked}
                onChange={(e) => setRestoreConfirmChecked(e.target.checked)}
              />
              <span>
                Estou ciente de que os dados atuais das tabelas restauradas serão substituídos pelo backup{' '}
                <strong>{pendingRestore.fileName}</strong>. Um snapshot automático de segurança será gerado antes da restauração.
              </span>
            </label>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPendingRestore(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={restoreBusy || !restoreConfirmChecked || !pendingRestore.inspection.checksumValid}
                onClick={handleExecuteRestore}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {restoreBusy ? 'Restaurando base...' : 'Confirmar Restauração'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação Obrigatória para Excluir Backup no Google Drive */}
      <ConfirmDeleteModal
        open={Boolean(deleteDriveTarget)}
        title={`Excluir arquivo do Google Drive?`}
        description={`Tem certeza que deseja excluir permanentemente o arquivo "${deleteDriveTarget?.name || ''}" (${formatBytes(deleteDriveTarget?.size || 0)}) do seu Google Drive? Esta ação não pode ser desfeita.`}
        busy={deleteDriveBusy}
        onCancel={() => setDeleteDriveTarget(null)}
        onConfirm={handleConfirmDeleteDriveFile}
      />

      {/* Modal de Confirmação para Excluir Agendamento */}
      <ConfirmDeleteModal
        open={Boolean(deleteSchedTarget)}
        title={`Excluir Agendamento · ${deleteSchedTarget?.name || ''}`}
        description="Esta política de agendamento automático de backup será removida da tabela."
        onCancel={() => setDeleteSchedTarget(null)}
        onConfirm={async () => {
          if (!deleteSchedTarget) return;
          await apiFetch(`/api/admin/backup/schedules/${deleteSchedTarget.id}`, { method: 'DELETE' });
          setDeleteSchedTarget(null);
          onToast('Agendamento automático removido.');
          await loadOverview();
        }}
      />
    </div>
  );
};
