import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  FileKey2,
  KeyRound,
  Landmark,
  Loader2,
  QrCode,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
  Wifi,
  X,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { apiFetch, formatDateTimeBR } from '../../../lib/api.ts';
import { BankAccount, SantanderApiConfigSummary, SantanderEmissionLog } from '../../../types.ts';

interface SantanderApiConfigModalProps {
  account: BankAccount | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

type ConfigTab = 'credentials' | 'boleto' | 'pix' | 'logs';

export const SantanderApiConfigModal: React.FC<SantanderApiConfigModalProps> = ({
  account,
  onClose,
  onSaved,
}) => {
  const [activeTab, setActiveTab] = useState<ConfigTab>('credentials');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingWs, setSyncingWs] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [config, setConfig] = useState<SantanderApiConfigSummary | null>(null);
  const [logs, setLogs] = useState<SantanderEmissionLog[]>([]);
  const [testResults, setTestResults] = useState<
    Array<{ scope: string; ok: boolean; endpoint: string; message: string }>
  >([]);

  // Editable form state
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [executionMode, setExecutionMode] = useState<'live_mtls' | 'homologation_offline'>('homologation_offline');
  const [clientId, setClientId] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [certType, setCertType] = useState<'pfx' | 'pem'>('pfx');
  const [pfxBase64Input, setPfxBase64Input] = useState('');
  const [pfxFileName, setPfxFileName] = useState('');
  const [pfxPasswordInput, setPfxPasswordInput] = useState('');
  const [certPemInput, setCertPemInput] = useState('');
  const [keyPemInput, setKeyPemInput] = useState('');
  const [certSubject, setCertSubject] = useState('');
  const [certExpiresAt, setCertExpiresAt] = useState('');

  // Boleto v2
  const [boletoEnabled, setBoletoEnabled] = useState(true);
  const [covenantCode, setCovenantCode] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceType, setWorkspaceType] = useState('BILLING');
  const [documentKind, setDocumentKind] = useState('DUPLICATA_MERCANTIL');
  const [paymentType, setPaymentType] = useState('REGISTRO');
  const [walletCode, setWalletCode] = useState('101');
  const [defaultFinePct, setDefaultFinePct] = useState('2.00');
  const [defaultInterestPct, setDefaultInterestPct] = useState('1.00');
  const [defaultProtestDays, setDefaultProtestDays] = useState('0');
  const [defaultWriteOffDays, setDefaultWriteOffDays] = useState('30');
  const [hybridBoletoPixEnabled, setHybridBoletoPixEnabled] = useState(true);
  const [boletoWebhookUrl, setBoletoWebhookUrl] = useState('');
  const [boletoBaseUrlOverride, setBoletoBaseUrlOverride] = useState('');

  // PIX v2
  const [pixEnabled, setPixEnabled] = useState(true);
  const [pixKeyType, setPixKeyType] = useState('CNPJ');
  const [pixKey, setPixKey] = useState('');
  const [pixDefaultChargeType, setPixDefaultChargeType] = useState<'cob' | 'cobv'>('cobv');
  const [pixExpirationSeconds, setPixExpirationSeconds] = useState('3600');
  const [pixValidityDaysAfterDue, setPixValidityDaysAfterDue] = useState('30');
  const [pixBeneficiaryCity, setPixBeneficiaryCity] = useState('RECIFE');
  const [pixWebhookUrl, setPixWebhookUrl] = useState('');
  const [pixBaseUrlOverride, setPixBaseUrlOverride] = useState('');

  const hydrateFromConfig = (c: SantanderApiConfigSummary) => {
    setConfig(c);
    setEnvironment(c.environment === 'production' ? 'production' : 'sandbox');
    setExecutionMode(c.executionMode === 'live_mtls' ? 'live_mtls' : 'homologation_offline');
    setClientId(c.clientId || '');
    setClientSecretInput('');
    setCertType(c.certType === 'pem' ? 'pem' : 'pfx');
    setPfxBase64Input('');
    setPfxFileName('');
    setPfxPasswordInput('');
    setCertPemInput('');
    setKeyPemInput('');
    setCertSubject(c.certSubject || '');
    setCertExpiresAt(c.certExpiresAt || '');

    setBoletoEnabled(c.boletoEnabled);
    setCovenantCode(c.covenantCode || '');
    setWorkspaceId(c.workspaceId || '');
    setWorkspaceType(c.workspaceType || 'BILLING');
    setDocumentKind(c.documentKind || 'DUPLICATA_MERCANTIL');
    setPaymentType(c.paymentType || 'REGISTRO');
    setWalletCode(c.walletCode || '101');
    setDefaultFinePct(c.defaultFinePct || '2.00');
    setDefaultInterestPct(c.defaultInterestPct || '1.00');
    setDefaultProtestDays(String(c.defaultProtestDays ?? 0));
    setDefaultWriteOffDays(String(c.defaultWriteOffDays ?? 30));
    setHybridBoletoPixEnabled(c.hybridBoletoPixEnabled);
    setBoletoWebhookUrl(c.boletoWebhookUrl || '');
    setBoletoBaseUrlOverride(c.boletoBaseUrlOverride || '');

    setPixEnabled(c.pixEnabled);
    setPixKeyType(c.pixKeyType || 'CNPJ');
    setPixKey(c.pixKey || '');
    setPixDefaultChargeType(c.pixDefaultChargeType === 'cob' ? 'cob' : 'cobv');
    setPixExpirationSeconds(String(c.pixExpirationSeconds ?? 3600));
    setPixValidityDaysAfterDue(String(c.pixValidityDaysAfterDue ?? 30));
    setPixBeneficiaryCity(c.pixBeneficiaryCity || 'RECIFE');
    setPixWebhookUrl(c.pixWebhookUrl || '');
    setPixBaseUrlOverride(c.pixBaseUrlOverride || '');
  };

  const loadConfig = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{
        account: BankAccount;
        config: SantanderApiConfigSummary;
        logs: SantanderEmissionLog[];
      }>(`/api/finance/bank-accounts/${account.id}/santander-config`);
      hydrateFromConfig(res.config);
      setLogs(res.logs || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao carregar configuração Santander.');
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    if (account) {
      setActiveTab('credentials');
      setSuccessMsg('');
      setErrorMsg('');
      setTestResults([]);
      void loadConfig();
    }
  }, [account, loadConfig]);

  if (!account) return null;

  const handlePfxFileUpload = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 256 * 1024) {
      setErrorMsg('Arquivo de certificado excede 256 KB. Selecione um certificado A1 válido (.pfx / .p12).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const b64 = result.includes(',') ? result.split(',')[1] : result;
      setPfxBase64Input(b64);
      setPfxFileName(file.name);
      setErrorMsg('');
    };
    reader.onerror = () => {
      setErrorMsg('Não foi possível ler o arquivo de certificado.');
    };
    reader.readAsDataURL(file);
  };

  const buildPayload = () => ({
    environment,
    executionMode,
    clientId: clientId.trim(),
    ...(clientSecretInput.trim() ? { clientSecret: clientSecretInput.trim() } : {}),
    certType,
    ...(pfxBase64Input ? { pfxBase64: pfxBase64Input } : {}),
    ...(pfxPasswordInput ? { pfxPassword: pfxPasswordInput } : {}),
    ...(certPemInput.trim() ? { certPem: certPemInput.trim() } : {}),
    ...(keyPemInput.trim() ? { keyPem: keyPemInput.trim() } : {}),
    certSubject: certSubject.trim(),
    certExpiresAt: certExpiresAt.trim(),
    boletoEnabled,
    covenantCode: covenantCode.trim(),
    workspaceId: workspaceId.trim(),
    workspaceType,
    documentKind,
    paymentType,
    walletCode: walletCode.trim(),
    defaultFinePct: defaultFinePct.trim(),
    defaultInterestPct: defaultInterestPct.trim(),
    defaultProtestDays: Number(defaultProtestDays || 0),
    defaultWriteOffDays: Number(defaultWriteOffDays || 30),
    hybridBoletoPixEnabled,
    boletoWebhookUrl: boletoWebhookUrl.trim(),
    boletoBaseUrlOverride: boletoBaseUrlOverride.trim(),
    pixEnabled,
    pixKeyType,
    pixKey: pixKey.trim(),
    pixDefaultChargeType,
    pixExpirationSeconds: Number(pixExpirationSeconds || 3600),
    pixValidityDaysAfterDue: Number(pixValidityDaysAfterDue || 30),
    pixBeneficiaryCity: pixBeneficiaryCity.trim(),
    pixWebhookUrl: pixWebhookUrl.trim(),
    pixBaseUrlOverride: pixBaseUrlOverride.trim(),
    apiIntegrationEnabled: true,
  });

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await apiFetch<{ config: SantanderApiConfigSummary }>(
        `/api/finance/bank-accounts/${account.id}/santander-config`,
        {
          method: 'PUT',
          body: JSON.stringify(buildPayload()),
        }
      );
      hydrateFromConfig(res.config);
      setSuccessMsg('Configuração da API Santander salva com criptografia AES-256-GCM e vinculada à Conta Corrente.');
      await onSaved();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar configuração Santander.');
    } finally {
      setSaving(false);
    }
  };

  const handleClearCertificate = async () => {
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await apiFetch<{ config: SantanderApiConfigSummary }>(
        `/api/finance/bank-accounts/${account.id}/santander-config`,
        {
          method: 'PUT',
          body: JSON.stringify({ ...buildPayload(), clearCertificate: true }),
        }
      );
      hydrateFromConfig(res.config);
      setSuccessMsg('Certificado A1 removido desta conta corrente.');
      await onSaved();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao remover certificado.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setErrorMsg('');
    setSuccessMsg('');
    setTestResults([]);
    try {
      // Save current settings before testing so test reflects latest inputs
      await apiFetch(`/api/finance/bank-accounts/${account.id}/santander-config`, {
        method: 'PUT',
        body: JSON.stringify(buildPayload()),
      });
      const res = await apiFetch<{
        ok: boolean;
        message: string;
        results: Array<{ scope: string; ok: boolean; endpoint: string; message: string }>;
        logs: SantanderEmissionLog[];
      }>(`/api/finance/bank-accounts/${account.id}/santander/test-connection`, {
        method: 'POST',
        body: JSON.stringify({ scope: 'all' }),
      });
      setTestResults(res.results || []);
      setLogs(res.logs || []);
      if (res.ok) {
        setSuccessMsg(res.message);
      } else {
        setErrorMsg(res.message);
      }
      await loadConfig();
      await onSaved();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha no teste de conexão Santander.');
    } finally {
      setTesting(false);
    }
  };

  const handleSyncWorkspace = async () => {
    setSyncingWs(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await apiFetch(`/api/finance/bank-accounts/${account.id}/santander-config`, {
        method: 'PUT',
        body: JSON.stringify(buildPayload()),
      });
      const res = await apiFetch<{
        workspaceId: string;
        mode: string;
        config: SantanderApiConfigSummary | null;
        logs: SantanderEmissionLog[];
      }>(`/api/finance/bank-accounts/${account.id}/santander/workspaces`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (res.config) hydrateFromConfig(res.config);
      else setWorkspaceId(res.workspaceId);
      setLogs(res.logs || []);
      setSuccessMsg(`Workspace Santander provisionado e vinculado: ${res.workspaceId}`);
      await onSaved();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao criar Workspace Santander.');
    } finally {
      setSyncingWs(false);
    }
  };

  const hasSavedCert = Boolean(config?.hasPfx || (config?.hasCertPem && config?.hasKeyPem));
  const originUrl = typeof window !== 'undefined' ? window.location.origin : 'https://seu-dominio.com';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-xs p-4 dark:bg-slate-950/80">
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/80 flex items-start justify-between gap-4 dark:border-slate-800 dark:bg-slate-800/60">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-red-600/10 text-red-700 dark:bg-red-500/15 dark:text-red-400">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Configuração API Banco Santander · Emissão de Boletos v2 &amp; PIX v2
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums dark:text-slate-400">
                Conta: {account.bankName} · Ag {account.agency || '—'}
                {account.agencyDigit ? `-${account.agencyDigit}` : ''} · CC {account.accountNumber || '—'}
                {account.accountDigit ? `-${account.accountDigit}` : ''} · FEBRABAN{' '}
                {account.febrabanCode || '033'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-2 border-b border-slate-200 flex flex-wrap items-center gap-1 bg-white dark:border-slate-800 dark:bg-slate-900">
          {[
            { id: 'credentials' as const, label: 'Credenciais & mTLS (A1)', icon: KeyRound },
            { id: 'boleto' as const, label: 'Boletos (v2)', icon: FileText },
            { id: 'pix' as const, label: 'PIX QR Code (v2)', icon: QrCode },
            { id: 'logs' as const, label: `Logs & Diagnóstico (${logs.length})`, icon: Activity },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-red-600 text-red-700 dark:border-red-400 dark:text-red-300'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {loading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando parâmetros Santander...
            </div>
          ) : (
            <>
              {errorMsg && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-900 flex items-start gap-2 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-200"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-emerald-900 flex items-start gap-2 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  <span>{successMsg}</span>
                </div>
              )}

              {activeTab === 'credentials' && (
                <div className="space-y-4">
                  {/* Execution Mode & Environment */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-700 dark:bg-slate-800/50">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Ambiente Santander
                      </label>
                      <select
                        value={environment}
                        onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="sandbox">Sandbox / Homologação (trust-sandbox / trust-pix-h)</option>
                        <option value="production">Produção (trust-open / trust-pix)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Modo de Execução da Integração
                      </label>
                      <select
                        value={executionMode}
                        onChange={(e) =>
                          setExecutionMode(e.target.value as 'live_mtls' | 'homologation_offline')
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="homologation_offline">
                          Homologação Local (Gera Linha Digitável FEBRABAN 033 + BR Code EMV sem mTLS)
                        </option>
                        <option value="live_mtls">
                          Produção / Sandbox Real (OAuth2 + Certificado Digital A1 mTLS)
                        </option>
                      </select>
                    </div>
                  </div>

                  {/* OAuth2 Credentials */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Client ID (X-Application-Key)
                      </label>
                      <input
                        type="text"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        placeholder="Consumidor / Key do Portal Developer Santander"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Client Secret{' '}
                        {config?.hasClientSecret && (
                          <span className="font-normal text-emerald-700 dark:text-emerald-300">
                            · Já armazenado (deixe vazio para manter)
                          </span>
                        )}
                      </label>
                      <input
                        type="password"
                        value={clientSecretInput}
                        onChange={(e) => setClientSecretInput(e.target.value)}
                        placeholder={
                          config?.hasClientSecret
                            ? '•••••••••••••••• (preencha apenas para substituir)'
                            : 'Secret da aplicação no Portal Santander'
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  {/* mTLS A1 Certificate */}
                  <div className="rounded-lg border border-slate-200 p-4 space-y-3 dark:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                        <FileKey2 className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                        Certificado Digital A1 (mTLS obrigatório em Conexão Real)
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {hasSavedCert
                            ? 'Certificado A1 armazenado com criptografia'
                            : 'Nenhum certificado A1 enviado ainda'}
                        </span>
                        {hasSavedCert && (
                          <button
                            type="button"
                            onClick={handleClearCertificate}
                            className="text-[11px] font-semibold text-red-600 hover:underline dark:text-red-400"
                          >
                            Remover Certificado
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                          Formato do Certificado
                        </label>
                        <select
                          value={certType}
                          onChange={(e) => setCertType(e.target.value as 'pfx' | 'pem')}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        >
                          <option value="pfx">Arquivo .PFX / .P12 (Recomendado)</option>
                          <option value="pem">Par de Chaves PEM (Certificado + Chave Privada)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                          Titular / Subject (Informativo)
                        </label>
                        <input
                          type="text"
                          value={certSubject}
                          onChange={(e) => setCertSubject(e.target.value)}
                          placeholder="CN=FINANCEPRO ASSESSORIA..."
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                          Validade do Certificado
                        </label>
                        <input
                          type="date"
                          value={certExpiresAt}
                          onChange={(e) => setCertExpiresAt(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>
                    </div>

                    {certType === 'pfx' ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                            Upload Certificado A1 (.pfx / .p12)
                          </label>
                          <label className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 cursor-pointer hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800/60 dark:hover:bg-slate-800">
                            <span className="inline-flex items-center gap-2 text-slate-700 truncate dark:text-slate-200">
                              <Upload className="w-3.5 h-3.5 shrink-0" />
                              {pfxFileName || (config?.hasPfx ? 'PFX salvo · clique para substituir' : 'Selecionar arquivo .pfx ou .p12')}
                            </span>
                            <input
                              type="file"
                              accept=".pfx,.p12"
                              className="hidden"
                              onChange={(e) => handlePfxFileUpload(e.target.files?.[0])}
                            />
                          </label>
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                            Senha do Certificado (.pfx){' '}
                            {config?.hasPfxPassword && (
                              <span className="font-normal text-emerald-700 dark:text-emerald-300">· Salva</span>
                            )}
                          </label>
                          <input
                            type="password"
                            value={pfxPasswordInput}
                            onChange={(e) => setPfxPasswordInput(e.target.value)}
                            placeholder={config?.hasPfxPassword ? '•••••••• (manter atual)' : 'Senha do certificado A1'}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                            Certificado Público (-----BEGIN CERTIFICATE-----)
                          </label>
                          <textarea
                            rows={4}
                            value={certPemInput}
                            onChange={(e) => setCertPemInput(e.target.value)}
                            placeholder={config?.hasCertPem ? 'Certificado PEM armazenado (cole para substituir)' : 'Cole o conteúdo .crt / .pem'}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                            Chave Privada (-----BEGIN PRIVATE KEY-----)
                          </label>
                          <textarea
                            rows={4}
                            value={keyPemInput}
                            onChange={(e) => setKeyPemInput(e.target.value)}
                            placeholder={config?.hasKeyPem ? 'Chave privada armazenada (cole para substituir)' : 'Cole o conteúdo .key'}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Test Connection Bar */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-800 flex items-center gap-1.5 dark:text-slate-100">
                        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        Diagnóstico de Autenticação OAuth 2.0 + mTLS
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {config?.lastTestedAt
                          ? `Último teste em ${formatDateTimeBR(config.lastTestedAt)}: ${config.lastTestMessage}`
                          : 'Salva os parâmetros atuais e valida os endpoints Boleto v2 e PIX v2.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={testing}
                      onClick={handleTestConnection}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                      Testar Conexão Santander
                    </button>
                  </div>

                  {testResults.length > 0 && (
                    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                      {testResults.map((r, i) => (
                        <div key={i} className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                          <div>
                            <div className="font-mono font-bold uppercase text-slate-800 dark:text-slate-100">
                              API {r.scope} ·{' '}
                              <span className={r.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>
                                {r.ok ? 'CONECTADO' : 'FALHA'}
                              </span>
                            </div>
                            <div className="text-slate-600 dark:text-slate-300">{r.message}</div>
                            <div className="font-mono text-[10px] text-slate-400 mt-0.5">{r.endpoint}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'boleto' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        Habilitar Emissão de Boletos Santander (collection_bill_management/v2)
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Permite registrar títulos, alterar vencimento/valor (PATCH), baixar e consultar situação nos demais módulos.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={boletoEnabled}
                      onChange={(e) => setBoletoEnabled(e.target.checked)}
                      className="w-4 h-4 accent-emerald-600"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Código do Convênio (covenantCode) *
                      </label>
                      <input
                        type="text"
                        value={covenantCode}
                        onChange={(e) => setCovenantCode(e.target.value)}
                        placeholder="Ex: 0348901"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Workspace ID (POST /collection_bill_management/v2/workspaces)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={workspaceId}
                          onChange={(e) => setWorkspaceId(e.target.value)}
                          placeholder="UUID retornado pelo Santander ou clique em Sincronizar"
                          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          disabled={syncingWs || !covenantCode.trim()}
                          onClick={handleSyncWorkspace}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                        >
                          {syncingWs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          Criar / Sincronizar Workspace
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Tipo Workspace
                      </label>
                      <select
                        value={workspaceType}
                        onChange={(e) => setWorkspaceType(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="BILLING">BILLING (Cobrança)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Carteira Santander
                      </label>
                      <input
                        type="text"
                        value={walletCode}
                        onChange={(e) => setWalletCode(e.target.value)}
                        placeholder="101"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Espécie (documentKind)
                      </label>
                      <select
                        value={documentKind}
                        onChange={(e) => setDocumentKind(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="DUPLICATA_MERCANTIL">Duplicata Mercantil</option>
                        <option value="DUPLICATA_SERVICO">Duplicata de Serviço</option>
                        <option value="RECIBO">Recibo</option>
                        <option value="NOTA_PROMISSORIA">Nota Promissória</option>
                        <option value="OUTROS">Outros</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Modalidade (paymentType)
                      </label>
                      <select
                        value={paymentType}
                        onChange={(e) => setPaymentType(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="REGISTRO">REGISTRO (Valor exato)</option>
                        <option value="DIVERGENTE">DIVERGENTE</option>
                        <option value="PARCIAL">PARCIAL</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Multa Padrão (%)
                      </label>
                      <input
                        type="text"
                        value={defaultFinePct}
                        onChange={(e) => setDefaultFinePct(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Juros Mora (%/mês)
                      </label>
                      <input
                        type="text"
                        value={defaultInterestPct}
                        onChange={(e) => setDefaultInterestPct(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Dias p/ Baixa Automática
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={defaultWriteOffDays}
                        onChange={(e) => setDefaultWriteOffDays(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Dias p/ Protesto (0=Não)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={90}
                        value={defaultProtestDays}
                        onChange={(e) => setDefaultProtestDays(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 cursor-pointer dark:border-slate-700">
                    <input
                      type="checkbox"
                      checked={hybridBoletoPixEnabled}
                      onChange={(e) => setHybridBoletoPixEnabled(e.target.checked)}
                      className="mt-0.5 accent-emerald-600"
                    />
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Boleto SX Híbrido (Emite QR Code PIX integrado ao Boleto Santander)
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Envia o objeto <code className="font-mono">key: &#123; type, dictKey &#125;</code> no registro do boleto para liquidação via código de barras ou QR Code PIX.
                      </div>
                    </div>
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Webhook de Baixas / Boletos
                      </label>
                      <input
                        type="url"
                        value={boletoWebhookUrl}
                        onChange={(e) => setBoletoWebhookUrl(e.target.value)}
                        placeholder={`${originUrl}/api/santander/webhooks/boleto`}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        URL Base Customizada Boletos (Opcional)
                      </label>
                      <input
                        type="url"
                        value={boletoBaseUrlOverride}
                        onChange={(e) => setBoletoBaseUrlOverride(e.target.value)}
                        placeholder="Padrão oficial trust-sandbox / trust-open"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'pix' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        Habilitar API PIX QR Code Generation (trust-pix /api/v2)
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Suporta cobrança imediata (<code className="font-mono">PUT /api/v2/cob/&#123;txid&#125;</code>) e com vencimento (<code className="font-mono">PUT /api/v2/cobv/&#123;txid&#125;</code>).
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={pixEnabled}
                      onChange={(e) => setPixEnabled(e.target.checked)}
                      className="w-4 h-4 accent-emerald-600"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Tipo da Chave PIX (DICT)
                      </label>
                      <select
                        value={pixKeyType}
                        onChange={(e) => setPixKeyType(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="CNPJ">CNPJ</option>
                        <option value="CPF">CPF</option>
                        <option value="EMAIL">E-mail</option>
                        <option value="TELEFONE">Telefone (+55...)</option>
                        <option value="EVP">Chave Aleatória (EVP)</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Chave PIX Recebedora (pixKey) *
                      </label>
                      <input
                        type="text"
                        value={pixKey}
                        onChange={(e) => setPixKey(e.target.value)}
                        placeholder="Informe a chave DICT vinculada a esta conta corrente Santander"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Modalidade Padrão PIX
                      </label>
                      <select
                        value={pixDefaultChargeType}
                        onChange={(e) => setPixDefaultChargeType(e.target.value as 'cob' | 'cobv')}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="cobv">cobv (Com Vencimento, Juros/Multa)</option>
                        <option value="cob">cob (Cobrança Imediata)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Expiração `cob` (seg)
                      </label>
                      <input
                        type="number"
                        min={60}
                        max={2592000}
                        value={pixExpirationSeconds}
                        onChange={(e) => setPixExpirationSeconds(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Validade pós-venc. `cobv` (dias)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={pixValidityDaysAfterDue}
                        onChange={(e) => setPixValidityDaysAfterDue(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Cidade Beneficiário (BR Code)
                      </label>
                      <input
                        type="text"
                        maxLength={15}
                        value={pixBeneficiaryCity}
                        onChange={(e) => setPixBeneficiaryCity(e.target.value)}
                        placeholder="RECIFE"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 uppercase dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        Webhook de Recebimento PIX (/api/v2/webhook)
                      </label>
                      <input
                        type="url"
                        value={pixWebhookUrl}
                        onChange={(e) => setPixWebhookUrl(e.target.value)}
                        placeholder={`${originUrl}/api/santander/webhooks/pix`}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                        URL Base Customizada PIX (Opcional)
                      </label>
                      <input
                        type="url"
                        value={pixBaseUrlOverride}
                        onChange={(e) => setPixBaseUrlOverride(e.target.value)}
                        placeholder="Padrão oficial trust-pix-h / trust-pix"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'logs' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-slate-600 dark:text-slate-300">
                      Histórico recente de chamadas OAuth2, Workspaces, Boletos, PIX e Webhooks desta conta.
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadConfig()}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Atualizar
                    </button>
                  </div>

                  {logs.length === 0 ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                      Nenhuma operação registrada ainda para esta conta corrente.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-80 overflow-y-auto dark:border-slate-700">
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                          <tr>
                            <th className="px-3 py-2">Data/Hora</th>
                            <th className="px-3 py-2">Escopo · Operação</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Ref. (NSU/txid)</th>
                            <th className="px-3 py-2">Detalhe / Endpoint</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {logs.map((lg) => (
                            <tr key={lg.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                              <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap text-slate-500 dark:text-slate-400">
                                {formatDateTimeBR(lg.createdAt)}
                              </td>
                              <td className="px-3 py-2 font-mono">
                                <span className="font-bold text-slate-900 dark:text-slate-100">
                                  {lg.apiScope.toUpperCase()}
                                </span>{' '}
                                · {lg.operation}
                              </td>
                              <td className="px-3 py-2 font-mono whitespace-nowrap">
                                <span
                                  className={
                                    lg.ok
                                      ? 'font-bold text-emerald-700 dark:text-emerald-300'
                                      : 'font-bold text-red-700 dark:text-red-300'
                                  }
                                >
                                  {lg.httpStatus ?? (lg.ok ? 'OK' : 'ERR')}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-300">
                                {lg.externalRef || '—'}
                              </td>
                              <td className="px-3 py-2 max-w-[260px] truncate text-slate-600 dark:text-slate-300">
                                {lg.errorMessage ? (
                                  <span className="text-red-700 dark:text-red-300">{lg.errorMessage}</span>
                                ) : (
                                  <span className="font-mono">{lg.endpoint}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3 dark:border-slate-800 dark:bg-slate-800/60">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Segredos e certificados são armazenados com AES-256-GCM e nunca retornam ao navegador.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Fechar
            </button>
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Salvar Configuração Santander
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
