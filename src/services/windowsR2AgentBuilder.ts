export function buildWindowsR2AgentScript(params: {
  serverUrl: string;
  batchId: number;
  batchCode: string;
  agentToken: string;
  syncMode: string;
}): string {
  const safeServer = params.serverUrl.replace(/\/+$/, '');
  return `#!/usr/bin/env node
/**
 * Invicta / FinancePro — Agente Local de Migração & Sincronização 64 GB -> Cloudflare R2 (bucketdainvicta)
 * Lote: ${params.batchCode} (#${params.batchId}) | Modo: ${params.syncMode}
 *
 * Requisitos: Node.js 18+ (zero dependências externas)
 * Uso no Windows (PowerShell ou CMD):
 *   node invicta-r2-sync-${params.batchCode}.mjs --dir "D:\\Dados_Unidades"
 * Opções úteis:
 *   --concurrency 6     Número de uploads simultâneos (padrão: 6)
 *   --dry-run           Apenas analisa pastas, vínculos e deduplicação sem enviar bytes
 *   --force-rescan      Ignora checkpoint local e revalida todos os hashes com o servidor
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const CONFIG = {
  serverUrl: ${JSON.stringify(safeServer)},
  batchId: ${params.batchId},
  batchCode: ${JSON.stringify(params.batchCode)},
  agentToken: ${JSON.stringify(params.agentToken)},
  syncMode: ${JSON.stringify(params.syncMode)},
  partSizeBytes: 8 * 1024 * 1024, // 8 MiB (R2 S3 Multipart: min 5 MiB, max 5 GiB, max 10k partes)
  multipartThresholdBytes: 32 * 1024 * 1024, // >= 32 MiB usa Multipart Upload S3
  manifestChunkSize: 100,
};

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.rtf': 'application/rtf',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.eml': 'message/rfc822',
  '.msg': 'application/vnd.ms-outlook',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
};

function parseArgs(argv) {
  const args = { dir: '', concurrency: 6, dryRun: false, forceRescan: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dir' && argv[i + 1]) args.dir = argv[++i];
    else if (k === '--concurrency' && argv[i + 1]) args.concurrency = Math.max(1, Math.min(16, Number(argv[++i]) || 6));
    else if (k === '--dry-run') args.dryRun = true;
    else if (k === '--force-rescan') args.forceRescan = true;
    else if (k === '--server' && argv[i + 1]) CONFIG.serverUrl = argv[++i].replace(/\\/+$/, '');
    else if (k === '--token' && argv[i + 1]) CONFIG.agentToken = argv[++i];
  }
  return args;
}

function guessMime(fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

async function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function apiJson(endpointPath, method = 'GET', bodyObj = undefined) {
  const headers = {
    'x-migration-agent-token': CONFIG.agentToken,
  };
  if (bodyObj !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(\`\${CONFIG.serverUrl}\${endpointPath}\`, {
    method,
    headers,
    body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data.error || \`HTTP \${res.status}: \${text.slice(0, 200)}\`);
  }
  return data;
}

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delayMs = 800 * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function walkDirectory(rootDir) {
  const entries = [];
  const topDirs = await fsp.readdir(rootDir, { withFileTypes: true });
  for (const unitEntry of topDirs) {
    if (!unitEntry.isDirectory()) continue;
    if (unitEntry.name.startsWith('.')) continue;
    const unitFolderName = unitEntry.name;
    const unitFullPath = path.join(rootDir, unitFolderName);

    async function walkSub(currentDir, relSegments) {
      const children = await fsp.readdir(currentDir, { withFileTypes: true });
      for (const ch of children) {
        if (ch.name.startsWith('.') || ch.name === 'Thumbs.db' || ch.name === 'desktop.ini') continue;
        const full = path.join(currentDir, ch.name);
        if (ch.isDirectory()) {
          await walkSub(full, [...relSegments, ch.name]);
        } else if (ch.isFile()) {
          const st = await fsp.stat(full);
          entries.push({
            unitFolderName,
            pathSegmentsFromUnit: [...relSegments, ch.name],
            fileName: ch.name,
            fullPath: full,
            sizeBytes: st.size,
            mtimeMs: Math.trunc(st.mtimeMs),
          });
        }
      }
    }
    await walkSub(unitFullPath, []);
  }
  return entries;
}

async function readSlice(filePath, start, length) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buf, 0, length, start);
    return bytesRead === length ? buf : buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function uploadSinglePresigned(url, filePath, mimeType) {
  const buf = await fsp.readFile(filePath);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': mimeType || 'application/octet-stream' },
    body: buf,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(\`R2 PutObject HTTP \${res.status}: \${txt.slice(0, 160)}\`);
  }
}

async function uploadMultipartPresigned(item) {
  const totalParts = Math.ceil(item.sizeBytes / CONFIG.partSizeBytes);
  const signedRes = await apiJson(\`/api/migration/batches/\${CONFIG.batchId}/multipart/sign-parts\`, 'POST', {
    itemId: item.itemId,
    objectKey: item.objectKey,
    uploadId: item.uploadId,
    partNumbers: Array.from({ length: totalParts }, (_, i) => i + 1),
  });
  const partUrls = signedRes.partUrls || {};
  const completedParts = [];
  for (let p = 1; p <= totalParts; p++) {
    const start = (p - 1) * CONFIG.partSizeBytes;
    const len = Math.min(CONFIG.partSizeBytes, item.sizeBytes - start);
    const chunk = await readSlice(item.fullPath, start, len);
    const etag = await withRetry(async () => {
      const res = await fetch(partUrls[String(p)], {
        method: 'PUT',
        body: chunk,
      });
      if (!res.ok) {
        throw new Error(\`R2 UploadPart #\${p} HTTP \${res.status}\`);
      }
      return res.headers.get('etag') || res.headers.get('ETag') || '';
    });
    completedParts.push({ partNumber: p, etag });
  }
  await apiJson(\`/api/migration/batches/\${CONFIG.batchId}/multipart/complete\`, 'POST', {
    itemId: item.itemId,
    objectKey: item.objectKey,
    uploadId: item.uploadId,
    parts: completedParts,
  });
}

async function uploadFallbackToServer(itemId, filePath, mimeType) {
  const buf = await fsp.readFile(filePath);
  const res = await fetch(\`\${CONFIG.serverUrl}/api/migration/batches/\${CONFIG.batchId}/upload-fallback/\${itemId}\`, {
    method: 'PUT',
    headers: {
      'x-migration-agent-token': CONFIG.agentToken,
      'content-type': mimeType || 'application/octet-stream',
    },
    body: buf,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(\`Fallback Upload HTTP \${res.status}: \${txt.slice(0, 160)}\`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.dir) {
    console.error('Erro: informe o diretório raiz das unidades via --dir "C:\\\\Caminho\\\\Unidades"');
    process.exit(1);
  }
  const rootDir = path.resolve(args.dir);
  if (!fs.existsSync(rootDir)) {
    console.error(\`Erro: diretório não encontrado: \${rootDir}\`);
    process.exit(1);
  }

  const checkpointPath = path.join(rootDir, \`.invicta-r2-checkpoint-\${CONFIG.batchCode}.json\`);
  let checkpoint = {};
  if (!args.forceRescan && fs.existsSync(checkpointPath)) {
    try {
      checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
      console.log(\`[Checkpoint] Retomando sessão com \${Object.keys(checkpoint).length} arquivos já validados localmente.\`);
    } catch {
      checkpoint = {};
    }
  }

  console.log(\`[Scan] Mapeando pastas de unidades em: \${rootDir}\`);
  const allFiles = await walkDirectory(rootDir);
  console.log(\`[Scan] \${allFiles.length} arquivos detectados. Analisando alterações contra checkpoint...\`);

  const filesToProcess = allFiles.filter((f) => {
    const cp = checkpoint[f.fullPath];
    return !cp || cp.sizeBytes !== f.sizeBytes || cp.mtimeMs !== f.mtimeMs;
  });
  console.log(\`[Delta] \${filesToProcess.length} arquivos novos/modificados para processar com o servidor.\`);

  const stats = { created: 0, updatedContent: 0, updatedPath: 0, deduplicated: 0, unmatched: 0, blocked: 0, failed: 0 };

  for (let offset = 0; offset < filesToProcess.length; offset += CONFIG.manifestChunkSize) {
    const slice = filesToProcess.slice(offset, offset + CONFIG.manifestChunkSize);
    const manifest = [];
    for (const f of slice) {
      const sha256Hash = await computeFileSha256(f.fullPath);
      manifest.push({
        unitFolderName: f.unitFolderName,
        pathSegmentsFromUnit: f.pathSegmentsFromUnit,
        fileName: f.fileName,
        legacySourcePath: f.fullPath,
        mimeType: guessMime(f.fileName),
        sizeBytes: f.sizeBytes,
        mtimeMs: f.mtimeMs,
        sha256Hash,
      });
    }

    const diffRes = await apiJson(\`/api/migration/batches/\${CONFIG.batchId}/manifest-diff\`, 'POST', {
      sourceRootPath: rootDir,
      dryRun: args.dryRun,
      files: manifest,
    });

    const uploadQueue = [];
    for (const d of diffRes.decisions || []) {
      const sourceFile = manifest.find((m) => m.legacySourcePath === d.legacySourcePath);
      if (d.action === 'unchanged') {
        stats.deduplicated++;
        if (sourceFile) checkpoint[sourceFile.legacySourcePath] = { sizeBytes: sourceFile.sizeBytes, mtimeMs: sourceFile.mtimeMs, sha256Hash: sourceFile.sha256Hash };
      } else if (d.action === 'update_path') {
        stats.updatedPath++;
        if (sourceFile) checkpoint[sourceFile.legacySourcePath] = { sizeBytes: sourceFile.sizeBytes, mtimeMs: sourceFile.mtimeMs, sha256Hash: sourceFile.sha256Hash };
      } else if (d.action === 'blocked_ext') {
        stats.blocked++;
      } else if (d.action === 'unmatched_unit' || d.action === 'unmatched_contract') {
        stats.unmatched++;
      } else if (d.action === 'create' || d.action === 'update_content') {
        if (!args.dryRun && sourceFile) {
          uploadQueue.push({ ...d, fullPath: sourceFile.legacySourcePath, mimeType: sourceFile.mimeType, sizeBytes: sourceFile.sizeBytes, mtimeMs: sourceFile.mtimeMs, sha256Hash: sourceFile.sha256Hash });
        }
      }
    }

    if (!args.dryRun && uploadQueue.length > 0) {
      const committedItems = [];
      let cursor = 0;
      const workers = Array.from({ length: Math.min(args.concurrency, uploadQueue.length) }, async () => {
        while (cursor < uploadQueue.length) {
          const item = uploadQueue[cursor++];
          try {
            if (item.uploadMode === 'r2_multipart') {
              await uploadMultipartPresigned(item);
              committedItems.push({ itemId: item.itemId, storageUri: item.storageUri, success: true });
            } else if (item.uploadMode === 'r2_presigned' && item.presignedPutUrl) {
              await withRetry(() => uploadSinglePresigned(item.presignedPutUrl, item.fullPath, item.mimeType));
              committedItems.push({ itemId: item.itemId, storageUri: item.storageUri, success: true });
            } else {
              await withRetry(() => uploadFallbackToServer(item.itemId, item.fullPath, item.mimeType));
            }
            if (item.action === 'update_content') stats.updatedContent++;
            else stats.created++;
            checkpoint[item.fullPath] = { sizeBytes: item.sizeBytes, mtimeMs: item.mtimeMs, sha256Hash: item.sha256Hash };
          } catch (err) {
            stats.failed++;
            committedItems.push({ itemId: item.itemId, success: false, errorMessage: err instanceof Error ? err.message : String(err) });
          }
        }
      });
      await Promise.all(workers);

      const needCommit = committedItems.filter((c) => c.storageUri || !c.success);
      if (needCommit.length > 0) {
        await apiJson(\`/api/migration/batches/\${CONFIG.batchId}/commit-items\`, 'POST', { items: needCommit });
      }
    }

    if (!args.dryRun) {
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint));
    }
    const processed = Math.min(offset + slice.length, filesToProcess.length);
    console.log(\`[Progresso] \${processed}/\${filesToProcess.length} | Novos: \${stats.created} · Atualizados: \${stats.updatedContent} · Pastas movidas: \${stats.updatedPath} · Deduplicados: \${stats.deduplicated} · Pend. vínculo: \${stats.unmatched} · Bloq: \${stats.blocked}\`);
  }

  if (!args.dryRun) {
    await apiJson(\`/api/migration/batches/\${CONFIG.batchId}/finalize\`, 'POST', {});
  }
  console.log('[Concluído] Sincronização finalizada com sucesso.');
}

main().catch((err) => {
  console.error('[Erro Fatal]', err);
  process.exit(1);
});
`;
}

export function buildWindowsBatchLauncher(params: {
  scriptFileName: string;
  batchCode: string;
}): string {
  return `@echo off
setlocal
echo ============================================================================
echo   Invicta / FinancePro - Agente de Migracao 64GB -> Cloudflare R2
echo   Lote: ${params.batchCode}
echo ============================================================================
set /p ROOT_DIR="Informe o caminho completo da pasta raiz das Unidades (ex: D:\\Dados_Unidades): "
if "%ROOT_DIR%"=="" (
  echo Caminho nao informado.
  pause
  exit /b 1
)
node "%~dp0${params.scriptFileName}" --dir "%ROOT_DIR%" --concurrency 6
echo.
echo Processo finalizado! Confira o Painel Web para emitir os Codigos Seguros Integrativos.
pause
`;
}
