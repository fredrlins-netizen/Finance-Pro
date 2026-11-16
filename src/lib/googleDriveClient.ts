export interface DriveFolderItem {
  id: string;
  name: string;
  webViewLink?: string;
  createdTime?: string;
}

export interface DriveBackupFileItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function parseDriveError(res: Response, fallback: string): Promise<string> {
  try {
    const text = await res.text();
    const json = JSON.parse(text) as { error?: { message?: string; status?: string } };
    if (res.status === 401) {
      return 'Sessão do Google Drive expirada. Reconecte sua conta Google.';
    }
    return json?.error?.message || `${fallback} (HTTP ${res.status})`;
  } catch {
    return `${fallback} (HTTP ${res.status})`;
  }
}

export async function listDriveFolders(accessToken: string): Promise<DriveFolderItem[]> {
  const q = encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const fields = encodeURIComponent('files(id,name,webViewLink,createdTime)');
  const res = await fetch(`${DRIVE_API}/files?q=${q}&fields=${fields}&orderBy=name&pageSize=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseDriveError(res, 'Erro ao listar pastas do Google Drive'));
  }
  const data = (await res.json()) as { files?: DriveFolderItem[] };
  return data.files || [];
}

export async function createDriveFolder(accessToken: string, folderName: string): Promise<DriveFolderItem> {
  const cleanName = folderName.trim() || 'FinancePro_Backups';
  const res = await fetch(`${DRIVE_API}/files?fields=id,name,webViewLink,createdTime`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: cleanName,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { app: 'financepro_backup_root' },
    }),
  });
  if (!res.ok) {
    throw new Error(await parseDriveError(res, 'Erro ao criar pasta no Google Drive'));
  }
  return (await res.json()) as DriveFolderItem;
}

export async function ensureDriveBackupFolder(
  accessToken: string,
  folderName = 'FinancePro_Backups',
  preferredFolderId?: string
): Promise<DriveFolderItem> {
  const folders = await listDriveFolders(accessToken);
  if (preferredFolderId) {
    const matchedById = folders.find((f) => f.id === preferredFolderId);
    if (matchedById) return matchedById;
  }
  const cleanName = folderName.trim() || 'FinancePro_Backups';
  const matchedByName = folders.find((f) => f.name.toLowerCase() === cleanName.toLowerCase());
  if (matchedByName) return matchedByName;
  return createDriveFolder(accessToken, cleanName);
}

export async function listDriveBackupFiles(
  accessToken: string,
  folderId?: string
): Promise<DriveBackupFileItem[]> {
  const parts = ["mimeType != 'application/vnd.google-apps.folder'", 'trashed = false'];
  if (folderId) {
    parts.push(`'${folderId.replace(/'/g, "\\'")}' in parents`);
  }
  const q = encodeURIComponent(parts.join(' and '));
  const fields = encodeURIComponent(
    'files(id,name,size,mimeType,createdTime,modifiedTime,webViewLink,parents,appProperties)'
  );
  const res = await fetch(
    `${DRIVE_API}/files?q=${q}&fields=${fields}&orderBy=createdTime desc&pageSize=100`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    throw new Error(await parseDriveError(res, 'Erro ao listar backups no Google Drive'));
  }
  const data = (await res.json()) as {
    files?: Array<Omit<DriveBackupFileItem, 'size'> & { size?: string | number }>;
  };
  return (data.files || []).map((f) => ({
    ...f,
    size: Number(f.size || 0),
  }));
}

export async function uploadBackupToGoogleDrive(
  accessToken: string,
  params: {
    fileName: string;
    blob: Blob;
    mimeType: string;
    folderId?: string;
    appProperties?: Record<string, string>;
  }
): Promise<DriveBackupFileItem> {
  const metadata = {
    name: params.fileName,
    mimeType: params.mimeType,
    ...(params.folderId ? { parents: [params.folderId] } : {}),
    ...(params.appProperties ? { appProperties: params.appProperties } : {}),
  };

  // Use resumable upload for files > 3 MB, multipart for smaller files
  if (params.blob.size > 3 * 1024 * 1024) {
    const initRes = await fetch(
      `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,size,mimeType,createdTime,modifiedTime,webViewLink,parents,appProperties`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': params.mimeType,
          'X-Upload-Content-Length': String(params.blob.size),
        },
        body: JSON.stringify(metadata),
      }
    );
    if (!initRes.ok) {
      throw new Error(await parseDriveError(initRes, 'Falha ao iniciar upload resumable no Google Drive'));
    }
    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) {
      throw new Error('Google Drive não retornou URL de sessão de upload.');
    }
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': params.mimeType,
      },
      body: params.blob,
    });
    if (!putRes.ok) {
      throw new Error(await parseDriveError(putRes, 'Falha ao enviar arquivo para o Google Drive'));
    }
    const item = (await putRes.json()) as DriveBackupFileItem & { size?: string | number };
    return { ...item, size: Number(item.size || params.blob.size) };
  }

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', params.blob, params.fileName);

  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,size,mimeType,createdTime,modifiedTime,webViewLink,parents,appProperties`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    }
  );
  if (!res.ok) {
    throw new Error(await parseDriveError(res, 'Falha ao enviar backup para o Google Drive'));
  }
  const item = (await res.json()) as DriveBackupFileItem & { size?: string | number };
  return { ...item, size: Number(item.size || params.blob.size) };
}

export async function downloadBackupFromGoogleDrive(
  accessToken: string,
  fileId: string
): Promise<Blob> {
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseDriveError(res, 'Falha ao baixar arquivo de backup do Google Drive'));
  }
  return res.blob();
}

export async function deleteBackupFromGoogleDrive(
  accessToken: string,
  fileId: string
): Promise<void> {
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await parseDriveError(res, 'Falha ao excluir backup do Google Drive'));
  }
}
