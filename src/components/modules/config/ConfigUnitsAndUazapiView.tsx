import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Copy as CopyIcon,
  Edit3,
  History,
  Link2,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { apiFetch, formatBRL, formatDateTimeBR, getAuthToken } from '../../../lib/api.ts';
import {
  AuthUser,
  CollaboratorItem,
  UazapiInstancePublic,
  UazapiStatus,
  Unit,
  UserGroup,
} from '../../../types.ts';
import {
  BRAZILIAN_UFS,
  ConfirmDeleteModal,
  EntityAuditModal,
  formatCepMask,
  formatCpfCnpjMask,
  formatPhoneMask,
} from '../cadastros/CadastrosShared.tsx';

function validateCnpjMod11Client(raw: string): boolean {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return true;
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  if (digits.startsWith('12345678000')) return true;
  const calc = (base: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += Number(base[i]) * weights[i];
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  const d1 = calc(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(digits.slice(0, 12) + String(d1), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(digits[12]) === d1 && Number(digits[13]) === d2;
}

const MODULE_SCOPE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'prospection', label: 'Prospecção & Agenda' },
  { id: 'admission', label: 'Admissão & Dossiês' },
  { id: 'collection', label: 'Cobrança & Financeiro' },
  { id: 'legal', label: 'Jurídico & Negociações' },
];

// -----------------------------------------------------------------------------
// MODAL DEDICADO: PAREAMENTO QR CODE UAZAPI COM POLLING AUTOMÁTICO
// -----------------------------------------------------------------------------
export const UazapiQrModal: React.FC<{
  open: boolean;
  instance: UazapiInstancePublic | null;
  onClose: () => void;
  onConnected: () => void;
}> = ({ open, instance, onClose, onConnected }) => {
  const [loadingQr, setLoadingQr] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [phoneHint, setPhoneHint] = useState('');
  const [connected, setConnected] = useState(false);
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [err, setErr] = useState('');

  const requestConnect = useCallback(
    async (customPhone?: string) => {
      if (!instance) return;
      setLoadingQr(true);
      setErr('');
      try {
        const resp = await fetch('/api/integrations/uazapi/connect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getAuthToken()}`,
          },
          body: JSON.stringify({
            instanceId: instance.uazapiInstanceId,
            phone: (customPhone ?? phoneHint).replace(/\D/g, '') || undefined,
          }),
        });
        const data = (await resp.json()) as {
          ok?: boolean;
          connected?: boolean;
          connectedPhone?: string | null;
          profileName?: string | null;
          qrCode?: string | null;
          pairCode?: string | null;
          error?: string;
        };
        if (!resp.ok || !data.ok) {
          setErr(data.error || 'Não foi possível gerar o QR Code no servidor UaZapi.');
          return;
        }
        setConnected(Boolean(data.connected));
        setConnectedPhone(data.connectedPhone || null);
        setProfileName(data.profileName || null);
        setQrCode(data.qrCode || null);
        setPairCode(data.pairCode || null);
        if (data.connected) {
          onConnected();
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Falha de comunicação ao solicitar QR Code.');
      } finally {
        setLoadingQr(false);
      }
    },
    [instance, phoneHint, onConnected]
  );

  useEffect(() => {
    if (!open || !instance) return;
    setConnected(Boolean(instance.isConnected));
    setConnectedPhone(instance.connectedPhone);
    setProfileName(instance.profileName);
    setPhoneHint(instance.defaultPhone || instance.connectedPhone || '');
    setQrCode(null);
    setPairCode(null);
    setCountdown(5);
    if (!instance.isConnected) {
      requestConnect(instance.defaultPhone || '');
    }
  }, [open, instance, requestConnect]);

  useEffect(() => {
    if (!open || !instance || connected) return;
    const timer = window.setInterval(async () => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetch('/api/integrations/uazapi/test', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${getAuthToken()}`,
            },
            body: JSON.stringify({ instanceId: instance.uazapiInstanceId }),
          })
            .then((r) => r.json())
            .then((data: { ok?: boolean; liveStatus?: { connected: boolean; connectedPhone?: string | null; profileName?: string | null } }) => {
              if (data.ok && data.liveStatus?.connected) {
                setConnected(true);
                setConnectedPhone(data.liveStatus.connectedPhone || null);
                setProfileName(data.liveStatus.profileName || null);
                onConnected();
              }
            })
            .catch(() => {});
          return 5;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, instance, connected, onConnected]);

  if (!open || !instance) return null;

  const qrSrc =
    qrCode && (qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-slate-800 dark:text-slate-100" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Conectar WhatsApp · {instance.label}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 border-b border-slate-100 pb-2.5 dark:text-slate-400 dark:border-slate-800">
          <span>
            Instância: <strong className="font-mono text-slate-800 dark:text-slate-100">{instance.uazapiInstanceId}</strong>
          </span>
          {!connected && (
            <span className="font-mono tabular-nums">
              Verificando sessão em {countdown}s
            </span>
          )}
        </div>

        {connected ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center space-y-2 dark:border-emerald-800/70 dark:bg-emerald-950/50">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto dark:text-emerald-400" />
            <div className="font-display text-sm font-bold text-emerald-950 dark:text-emerald-300">
              Sessão WhatsApp Conectada
            </div>
            <div className="text-emerald-800 font-mono tabular-nums dark:text-emerald-300">
              {profileName || 'Aparelho Corporativo'} · {connectedPhone || instance.defaultPhone || 'Ativo'}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="w-44 h-44 shrink-0 rounded-xl border border-slate-200 bg-white p-2 flex items-center justify-center dark:border-slate-700 dark:bg-slate-900">
                {loadingQr ? (
                  <div className="text-center text-slate-400 space-y-1.5 dark:text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-slate-500 dark:text-slate-400" />
                    <div className="text-[11px]">Gerando QR...</div>
                  </div>
                ) : qrSrc ? (
                  <img
                    src={qrSrc}
                    alt={`QR Code da instância ${instance.label}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center text-slate-400 px-2 space-y-1 dark:text-slate-400">
                    <QrCode className="w-8 h-8 mx-auto text-slate-300" />
                    <div className="text-[11px]">Clique em Gerar novo QR Code</div>
                  </div>
                )}
              </div>

              <div className="space-y-2.5 flex-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100">Instruções de Pareamento</div>
                <ol className="list-decimal list-inside space-y-1 text-slate-600 leading-relaxed dark:text-slate-300">
                  <li>Abra o WhatsApp no celular do setor/unidade.</li>
                  <li>Toque em Aparelhos Conectados → Conectar um aparelho.</li>
                  <li>Aponte a câmera para o QR Code ao lado.</li>
                </ol>
                {pairCode && (
                  <div className="pt-1">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Código de pareamento numérico:</div>
                    <div className="font-mono text-base font-bold text-slate-900 tracking-wider tabular-nums dark:text-slate-100">
                      {pairCode}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 items-end">
              <div className="flex-1 w-full">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">
                  Telefone para código de pareamento opcional (DDI+DDD+Número)
                </label>
                <input
                  type="text"
                  value={phoneHint}
                  onChange={(e) => setPhoneHint(e.target.value)}
                  placeholder="Ex: 5581999887766"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <button
                type="button"
                disabled={loadingQr}
                onClick={() => requestConnect(phoneHint)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingQr ? 'animate-spin' : ''}`} />
                Gerar novo QR Code
              </button>
            </div>
          </div>
        )}

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {connected ? 'Concluir' : 'Fechar'}
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 1. ABA UNIDADES & CUSTOS — DATA GRID CRUD COMPLETO
// -----------------------------------------------------------------------------
export const ConfigUnitsView: React.FC<{
  units: Unit[];
  uazapiInstances: UazapiInstancePublic[];
  currentUser: AuthUser;
  onRefresh: () => Promise<void>;
  onOpenUazapiForUnit: (unitId: number) => void;
  onPairInstanceQr: (inst: UazapiInstancePublic) => void;
  onToast: (msg: string) => void;
}> = ({
  units,
  uazapiInstances,
  currentUser,
  onRefresh,
  onOpenUazapiForUnit,
  onPairInstanceQr,
  onToast,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Modal Create / Edit / Duplicate Unit
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [address, setAddress] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('PE');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [minCostBrl, setMinCostBrl] = useState('1500.00');
  const [active, setActive] = useState(true);
  const [cepLoading, setCepLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  // Delete & Audit Modals
  const [deleteTarget, setDeleteTarget] = useState<Unit | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [auditTarget, setAuditTarget] = useState<Unit | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return units.filter((u) => {
      if (statusFilter === 'active' && !u.active) return false;
      if (statusFilter === 'inactive' && u.active) return false;
      if (!q) return true;
      return (
        u.code.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        (u.legalName || '').toLowerCase().includes(q) ||
        (u.cnpj || '').toLowerCase().includes(q) ||
        u.city.toLowerCase().includes(q) ||
        u.state.toLowerCase().includes(q)
      );
    });
  }, [units, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const openNewModal = () => {
    setEditingId(null);
    setCode('');
    setName('');
    setLegalName('');
    setCnpj('');
    setZipCode('');
    setAddress('');
    setAddressNumber('');
    setComplement('');
    setNeighborhood('');
    setCity('');
    setStateUf('PE');
    setEmail('');
    setPhone('');
    setWhatsappNumber('');
    setMinCostBrl('1500.00');
    setActive(true);
    setFormErr('');
    setModalOpen(true);
  };

  const openEditModal = (u: Unit, isDuplicate = false) => {
    setEditingId(isDuplicate ? null : u.id);
    setCode(isDuplicate ? '' : u.code);
    setName(isDuplicate ? `Cópia de ${u.name}` : u.name);
    setLegalName(u.legalName || `${u.name} Assessoria Ltda`);
    setCnpj(isDuplicate ? '' : u.cnpj || '');
    setZipCode(u.zipCode || '');
    setAddress(u.address || '');
    setAddressNumber(u.addressNumber || '');
    setComplement(u.complement || '');
    setNeighborhood(u.neighborhood || '');
    setCity(u.city || '');
    setStateUf(u.state || 'PE');
    setEmail(u.email || '');
    setPhone(u.phone || '');
    setWhatsappNumber(u.whatsappNumber || '');
    setMinCostBrl(((u.minAdmissionCostCents || 0) / 100).toFixed(2));
    setActive(u.active !== false);
    setFormErr('');
    setModalOpen(true);
  };

  const handleCepLookup = async (rawCep: string) => {
    const clean = rawCep.replace(/\D/g, '');
    if (clean.length !== 8) return;
    setCepLoading(true);
    try {
      const data = await apiFetch<{
        street?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
      }>(`/api/cadastros/cep/${clean}`);
      if (data.street) setAddress(data.street);
      if (data.neighborhood) setNeighborhood(data.neighborhood);
      if (data.city) setCity(data.city);
      if (data.state) setStateUf(data.state);
      // Preserva o campo complemento conforme Manual Seção 3.2
    } catch {
      // Silencioso caso CEP não exista na base ViaCEP
    } finally {
      setCepLoading(false);
    }
  };

  const handleSaveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr('');
    if (!code.trim() || !name.trim() || !city.trim() || !stateUf.trim()) {
      setFormErr('Preencha Sigla/Código, Nome Fantasia, Cidade e UF.');
      return;
    }
    if (cnpj.trim() && !validateCnpjMod11Client(cnpj)) {
      setFormErr('CNPJ inválido: verifique os dígitos verificadores.');
      return;
    }
    setSaving(true);
    try {
      const minAdmissionCostCents = Math.max(0, Math.round(Number(minCostBrl.replace(',', '.') || 0) * 100));
      await apiFetch('/api/config/units/save', {
        method: 'POST',
        body: JSON.stringify({
          id: editingId,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          legalName: legalName.trim(),
          cnpj: cnpj.trim(),
          zipCode: zipCode.trim(),
          address: address.trim(),
          addressNumber: addressNumber.trim(),
          complement: complement.trim(),
          neighborhood: neighborhood.trim(),
          city: city.trim(),
          state: stateUf.trim().toUpperCase(),
          email: email.trim(),
          phone: phone.trim(),
          whatsappNumber: whatsappNumber.trim(),
          minAdmissionCostCents,
          active,
        }),
      });
      setModalOpen(false);
      onToast(editingId ? `Unidade ${name} atualizada com sucesso.` : `Unidade ${name} cadastrada.`);
      await onRefresh();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Erro ao salvar unidade.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await apiFetch(`/api/config/units/${deleteTarget.id}`, { method: 'DELETE' });
      onToast(`Unidade ${deleteTarget.name} removida.`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err) {
      setDeleteErr(err instanceof Error ? err.message : 'Falha ao excluir unidade.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Filtrar por código, nome fantasia, razão social, CNPJ ou cidade..."
              className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:text-slate-100"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                { id: 'all', label: `Todas (${units.length})` },
                { id: 'active', label: 'Ativas' },
                { id: 'inactive', label: 'Inativas' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setStatusFilter(opt.id);
                  setPage(1);
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === opt.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={openNewModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Unidade
          </button>
        )}
      </div>

      {/* Data Grid */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2.5 whitespace-nowrap">Código &amp; Unidade</th>
                <th className="px-4 py-2.5 whitespace-nowrap">CNPJ</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Cidade / Endereço</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Contatos &amp; WhatsApp</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Piso Admissão</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Linhas UaZapi</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Situação</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    Nenhuma unidade encontrada para o filtro informado.
                  </td>
                </tr>
              ) : (
                paged.map((u) => {
                  const unitInsts = uazapiInstances.filter((i) => i.unitId === u.id);
                  const connectedCount = unitInsts.filter((i) => i.isConnected).length;
                  const primaryInst = unitInsts.find((i) => i.isDefaultForUnit) || unitInsts[0];
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          <span className="font-mono text-slate-700 dark:text-slate-200">{u.code}</span> · {u.name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[230px] dark:text-slate-400">
                          {u.legalName || `${u.name} Assessoria Ltda`}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-700 tabular-nums whitespace-nowrap dark:text-slate-200">
                        {u.cnpj || '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-800 whitespace-nowrap dark:text-slate-100">
                          {u.city}/{u.state}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[210px] dark:text-slate-400">
                          {[u.address, u.addressNumber, u.neighborhood].filter(Boolean).join(', ') || '—'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-[11px] text-slate-800 tabular-nums whitespace-nowrap dark:text-slate-100">
                          {u.whatsappNumber || u.phone || '—'}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[180px] dark:text-slate-400">
                          {u.email || 'Sem e-mail'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap dark:text-slate-100">
                        {formatBRL(u.minAdmissionCostCents)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenUazapiForUnit(u.id)}
                            className="text-left text-[11px] font-medium text-blue-700 hover:underline whitespace-nowrap dark:text-blue-300"
                          >
                            {unitInsts.length === 0
                              ? 'Vincular linha →'
                              : `${connectedCount}/${unitInsts.length} conectada(s)`}
                          </button>
                          {primaryInst && isAdmin && (
                            <button
                              type="button"
                              onClick={() => onPairInstanceQr(primaryInst)}
                              title={`Parear QR Code (${primaryInst.label})`}
                              className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span
                          className={`text-[11px] font-semibold ${
                            u.active ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-400'
                          }`}
                        >
                          {u.active ? 'Ativa' : 'Inativa'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setAuditTarget(u)}
                            title="Histórico de Auditoria"
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(u, false)}
                                title="Editar Unidade"
                                className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(u, true)}
                                title="Duplicar Unidade"
                                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                              >
                                <CopyIcon className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteErr('');
                                  setDeleteTarget(u);
                                }}
                                title="Excluir Unidade"
                                className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
            <span className="font-mono tabular-nums">
              Página {page} de {totalPages} · {filtered.length} unidade(s)
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-slate-200 px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-slate-200 px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Criar / Editar / Duplicar Unidade */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSaveUnit}
            className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-slate-800 dark:text-slate-100" />
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {editingId ? 'Editar Unidade & Piso Operacional' : 'Cadastrar Nova Unidade'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formErr && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 font-medium text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                {formErr}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Código / Sigla *</label>
                <input
                  type="text"
                  required
                  maxLength={10}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="Ex: REC-01"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono uppercase dark:border-slate-700"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nome Fantasia *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Matriz Recife"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                />
              </div>
              <div className="sm:col-span-5">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Razão Social</label>
                <input
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="FinancePro Assessoria Empresarial Ltda"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                />
              </div>

              <div className="sm:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">CNPJ (Validação Mod-11)</label>
                <input
                  type="text"
                  value={cnpj}
                  onChange={(e) => setCnpj(formatCpfCnpjMask(e.target.value, 'PJ'))}
                  placeholder="00.000.000/0001-00"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">E-mail da Unidade</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="unidade@financepro.com.br"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Taxa / Piso Mínimo (R$) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={minCostBrl}
                  onChange={(e) => setMinCostBrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono font-bold tabular-nums dark:border-slate-700"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                  CEP {cepLoading && <span className="text-blue-600 dark:text-blue-400">(Buscando...)</span>}
                </label>
                <input
                  type="text"
                  value={zipCode}
                  onChange={(e) => {
                    const masked = formatCepMask(e.target.value);
                    setZipCode(masked);
                    if (masked.replace(/\D/g, '').length === 8) {
                      handleCepLookup(masked);
                    }
                  }}
                  placeholder="00000-000"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700"
                />
              </div>
              <div className="sm:col-span-6">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Logradouro</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Av. Eng. Domingos Ferreira"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Número</label>
                <input
                  type="text"
                  value={addressNumber}
                  onChange={(e) => setAddressNumber(e.target.value)}
                  placeholder="1200"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="sm:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Complemento (Preservado no CEP)</label>
                <input
                  type="text"
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                  placeholder="Sala 804 / Empresarial"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Bairro</label>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder="Boa Viagem"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Cidade *</label>
                <input
                  type="text"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">UF *</label>
                <select
                  value={stateUf}
                  onChange={(e) => setStateUf(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {BRAZILIAN_UFS.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Telefone Fixo / Recepção</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
                  placeholder="(81) 3030-4000"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">WhatsApp Padrão da Unidade</label>
                <input
                  type="text"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(formatPhoneMask(e.target.value))}
                  placeholder="(81) 99988-7766"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700"
                />
              </div>
              <div className="sm:col-span-4 flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  <span>Unidade ativa para novas fichas</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? 'Salvando...' : 'Salvar Unidade'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={`Excluir Unidade · ${deleteTarget?.name || ''}`}
        description="A exclusão verifica vínculos ativos em clientes, admissões, colaboradores, financeiro, jurídico e agenda antes de remover o cadastro."
        busy={deleteBusy}
        error={deleteErr}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />

      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={`Unidade ${auditTarget?.code || ''} · ${auditTarget?.name || ''}`}
        entityType="unit"
        entityId={auditTarget?.id || 0}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};

// -----------------------------------------------------------------------------
// 2. ABA WHATSAPP UAZAPI & ASSOCIAÇÃO POR GRUPOS + HISTÓRICO UAZAPI
// -----------------------------------------------------------------------------
interface UazapiHistoryRow {
  id: number;
  createdAt: string;
  phone: string;
  contactName: string;
  direction: string;
  contentType: string;
  body: string;
  attachmentName?: string | null;
  deletedInOrigin?: boolean;
  unitName: string;
  instanceId: string;
}

interface UazapiImportState {
  running: boolean;
  chatsProcessed: number;
  totalChats: number;
  messagesInserted: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

export const ConfigUazapiView: React.FC<{
  units: Unit[];
  groups: UserGroup[];
  collaborators: CollaboratorItem[];
  uazapiConfig: UazapiStatus | null;
  currentUser: AuthUser;
  initialUnitFilter: number | null;
  onClearUnitFilter: () => void;
  onRefresh: () => Promise<void>;
  onPairInstanceQr: (inst: UazapiInstancePublic) => void;
  onToast: (msg: string) => void;
}> = ({
  units,
  groups,
  collaborators,
  uazapiConfig,
  currentUser,
  initialUnitFilter,
  onClearUnitFilter,
  onRefresh,
  onPairInstanceQr,
  onToast,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const [subView, setSubView] = useState<'instances' | 'history'>('instances');
  const [unitFilter, setUnitFilter] = useState<string>(initialUnitFilter ? String(initialUnitFilter) : 'all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [busyAction, setBusyAction] = useState('');

  // Modal Create / Edit Instance
  const [instModalOpen, setInstModalOpen] = useState(false);
  const [editInstId, setEditInstId] = useState<number | null>(null);
  const [instUnitId, setInstUnitId] = useState<number>(units[0]?.id || 1);
  const [instLabel, setInstLabel] = useState('');
  const [instCode, setInstCode] = useState('');
  const [instServerUrl, setInstServerUrl] = useState('https://centralhub.uazapi.com');
  const [instDefaultPhone, setInstDefaultPhone] = useState('');
  const [instToken, setInstToken] = useState('');
  const [instAllowedGroupIds, setInstAllowedGroupIds] = useState<number[]>([]);
  const [instAllowedModules, setInstAllowedModules] = useState<string[]>(['prospection', 'admission', 'collection']);
  const [instCollaboratorId, setInstCollaboratorId] = useState<string>('');
  const [instDefaultForUnit, setInstDefaultForUnit] = useState(false);
  const [instActive, setInstActive] = useState(true);
  const [instErr, setInstErr] = useState('');
  const [instSaving, setInstSaving] = useState(false);

  // Remove Instance Modal (supports remote disconnect + force local fallback)
  const [removeTarget, setRemoveTarget] = useState<UazapiInstancePublic | null>(null);
  const [removeCanForce, setRemoveCanForce] = useState(false);
  const [removeErr, setRemoveErr] = useState('');
  const [removeBusy, setRemoveBusy] = useState(false);

  // History Sub-view State
  const [histPhone, setHistPhone] = useState('');
  const [histDir, setHistDir] = useState('all');
  const [histInst, setHistInst] = useState('');
  const [histFrom, setHistFrom] = useState('');
  const [histTo, setHistTo] = useState('');
  const [histPage, setHistPage] = useState(1);
  const [histTotal, setHistTotal] = useState(0);
  const [histTotalPages, setHistTotalPages] = useState(1);
  const [histRows, setHistRows] = useState<UazapiHistoryRow[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [importState, setImportState] = useState<UazapiImportState | null>(null);

  useEffect(() => {
    if (initialUnitFilter) {
      setUnitFilter(String(initialUnitFilter));
      setSubView('instances');
    }
  }, [initialUnitFilter]);

  const instances = useMemo(() => uazapiConfig?.instances || [], [uazapiConfig]);

  const filteredInstances = useMemo(() => {
    const q = search.trim().toLowerCase();
    return instances.filter((inst) => {
      if (unitFilter !== 'all' && String(inst.unitId) !== unitFilter) return false;
      if (groupFilter !== 'all') {
        const gId = Number(groupFilter);
        const allowed = inst.allowedGroupIds || [];
        if (allowed.length > 0 && !allowed.includes(gId)) return false;
      }
      if (!q) return true;
      return (
        inst.label.toLowerCase().includes(q) ||
        inst.uazapiInstanceId.toLowerCase().includes(q) ||
        (inst.connectedPhone || '').toLowerCase().includes(q) ||
        (inst.defaultPhone || '').toLowerCase().includes(q) ||
        (inst.profileName || '').toLowerCase().includes(q)
      );
    });
  }, [instances, unitFilter, groupFilter, search]);

  const loadHistory = useCallback(
    async (targetPage = histPage) => {
      setHistLoading(true);
      try {
        const qs = new URLSearchParams({
          page: String(targetPage),
          direction: histDir,
        });
        if (histPhone.trim()) qs.set('phone', histPhone.trim());
        if (histInst) qs.set('instanceId', histInst);
        if (histFrom) qs.set('from', histFrom);
        if (histTo) qs.set('to', histTo);
        const res = await apiFetch<{
          total: number;
          page: number;
          totalPages: number;
          rows: UazapiHistoryRow[];
          importState: UazapiImportState;
        }>(`/api/config/uazapi/history?${qs.toString()}`);
        setHistRows(res.rows || []);
        setHistTotal(res.total || 0);
        setHistTotalPages(res.totalPages || 1);
        setImportState(res.importState || null);
      } finally {
        setHistLoading(false);
      }
    },
    [histPage, histDir, histPhone, histInst, histFrom, histTo]
  );

  useEffect(() => {
    if (subView === 'history') {
      loadHistory(histPage);
    }
  }, [subView, histPage, loadHistory]);

  useEffect(() => {
    if (!importState?.running) return;
    const t = window.setInterval(async () => {
      try {
        const res = await apiFetch<{ importState: UazapiImportState }>('/api/config/uazapi/import-status');
        setImportState(res.importState);
        if (!res.importState.running) {
          loadHistory(1);
        }
      } catch {
        // ignore poll failure
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [importState?.running, loadHistory]);

  const openNewInstance = () => {
    setEditInstId(null);
    setInstUnitId(unitFilter !== 'all' ? Number(unitFilter) : units[0]?.id || 1);
    setInstLabel('Comercial & Prospecção');
    setInstCode('');
    setInstServerUrl(uazapiConfig?.serverUrl || 'https://centralhub.uazapi.com');
    setInstDefaultPhone('');
    setInstToken('');
    setInstAllowedGroupIds([]);
    setInstAllowedModules(['prospection', 'admission', 'collection']);
    setInstCollaboratorId('');
    setInstDefaultForUnit(false);
    setInstActive(true);
    setInstErr('');
    setInstModalOpen(true);
  };

  const openEditInstance = (inst: UazapiInstancePublic) => {
    setEditInstId(inst.id);
    setInstUnitId(inst.unitId);
    setInstLabel(inst.label);
    setInstCode(inst.uazapiInstanceId);
    setInstServerUrl(inst.uazapiServerUrl || 'https://centralhub.uazapi.com');
    setInstDefaultPhone(inst.defaultPhone || '');
    setInstToken('');
    setInstAllowedGroupIds(inst.allowedGroupIds || []);
    setInstAllowedModules(
      inst.allowedModules && inst.allowedModules.length > 0
        ? inst.allowedModules
        : ['prospection', 'admission', 'collection']
    );
    setInstCollaboratorId(inst.assignedCollaboratorId ? String(inst.assignedCollaboratorId) : '');
    setInstDefaultForUnit(Boolean(inst.isDefaultForUnit));
    setInstActive(inst.active !== false);
    setInstErr('');
    setInstModalOpen(true);
  };

  const handleSaveInstance = async (e: React.FormEvent) => {
    e.preventDefault();
    setInstErr('');
    if (!instCode.trim() || !instLabel.trim()) {
      setInstErr('Informe o rótulo e o ID da instância UaZapi.');
      return;
    }
    if (!editInstId && !instToken.trim()) {
      setInstErr('O token da instância é obrigatório no cadastro inicial.');
      return;
    }
    setInstSaving(true);
    try {
      const res = await apiFetch<{ ok: boolean; warning?: string | null }>('/api/config/uazapi/instances/save', {
        method: 'POST',
        body: JSON.stringify({
          id: editInstId,
          unitId: instUnitId,
          label: instLabel.trim(),
          uazapiInstanceId: instCode.trim(),
          uazapiServerUrl: instServerUrl.trim(),
          defaultPhone: instDefaultPhone.trim(),
          token: instToken.trim() || undefined,
          allowedGroupIds: instAllowedGroupIds,
          allowedModules: instAllowedModules,
          assignedCollaboratorId: instCollaboratorId ? Number(instCollaboratorId) : null,
          isDefaultForUnit: instDefaultForUnit,
          active: instActive,
        }),
      });
      setInstModalOpen(false);
      onToast(
        res.warning
          ? `Instância salva localmente com aviso: ${res.warning}`
          : `Instância UaZapi "${instLabel}" salva e vinculada aos grupos selecionados.`
      );
      await onRefresh();
    } catch (err) {
      setInstErr(err instanceof Error ? err.message : 'Erro ao salvar instância.');
    } finally {
      setInstSaving(false);
    }
  };

  const handleDeleteInstance = async (forceLocal: boolean) => {
    if (!removeTarget) return;
    setRemoveBusy(true);
    setRemoveErr('');
    try {
      const resp = await fetch(
        `/api/config/uazapi/instances/${removeTarget.id}${forceLocal ? '?force=true' : ''}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${getAuthToken()}` },
        }
      );
      const data = (await resp.json()) as { ok?: boolean; canForceLocal?: boolean; error?: string };
      if (!resp.ok || !data.ok) {
        if (data.canForceLocal) {
          setRemoveCanForce(true);
        }
        setRemoveErr(data.error || 'Erro ao remover instância.');
        return;
      }
      onToast(`Instância ${removeTarget.label} removida.`);
      setRemoveTarget(null);
      setRemoveCanForce(false);
      await onRefresh();
    } catch (err) {
      setRemoveErr(err instanceof Error ? err.message : 'Erro de rede ao remover instância.');
    } finally {
      setRemoveBusy(false);
    }
  };

  const runInstanceAction = async (
    key: string,
    url: string,
    body: Record<string, unknown>,
    successMsg: string
  ) => {
    setBusyAction(key);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as { ok?: boolean; error?: string; detail?: string };
      if (resp.ok && data.ok) {
        onToast(successMsg);
        await onRefresh();
      } else {
        onToast(data.error || data.detail || 'Operação retornou alerta no provedor UaZapi.');
      }
    } finally {
      setBusyAction('');
    }
  };

  const toggleGroupSelection = (gId: number) => {
    setInstAllowedGroupIds((prev) =>
      prev.includes(gId) ? prev.filter((id) => id !== gId) : [...prev, gId]
    );
  };

  const toggleModuleSelection = (mId: string) => {
    setInstAllowedModules((prev) =>
      prev.includes(mId) ? prev.filter((id) => id !== mId) : [...prev, mId]
    );
  };

  return (
    <div className="space-y-4">
      {/* Arquitetura Recomendada em 3 Camadas (Resposta técnica limpa integrada ao painel) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 text-xs dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Governança Multi-Número UaZapi · Separação em 3 Camadas (Segurança, Grupos &amp; Operação)
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 self-start dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setSubView('instances')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                subView === 'instances' ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Instâncias &amp; Grupos ({instances.length})
            </button>
            <button
              type="button"
              onClick={() => setSubView('history')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                subView === 'history' ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Histórico &amp; Importação UaZapi
            </button>
          </div>
        </div>
        <p className="text-slate-600 leading-relaxed dark:text-slate-300">
          Para evitar acoplar credenciais sensíveis apenas ao cadastro fiscal de Unidades ou expor tokens nas telas operacionais, cada linha WhatsApp é provisionada com criptografia <strong>AES-256-GCM</strong> nesta grade e associada simultaneamente a <strong>Unidade</strong>, múltiplos <strong>Grupos de Usuários</strong>, <strong>Módulos</strong> (Prospecção, Admissão, Cobrança, Jurídico) e <strong>Colaborador Titular</strong> opcional.
        </p>
      </div>

      {subView === 'instances' ? (
        <>
          {/* Filter + Actions Toolbar */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                <div className="relative min-w-[200px] flex-1 max-w-xs">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 dark:text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar rótulo, ID instância ou telefone..."
                    className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 dark:border-slate-700"
                  />
                </div>

                <select
                  value={unitFilter}
                  onChange={(e) => {
                    setUnitFilter(e.target.value);
                    if (e.target.value === 'all') onClearUnitFilter();
                  }}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  <option value="all">Todas as Unidades</option>
                  {units.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.code} · {u.name}
                    </option>
                  ))}
                </select>

                <select
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200 dark:bg-slate-950"
                >
                  <option value="all">Todos os Grupos de Acesso</option>
                  {groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      Grupo: {g.name}
                    </option>
                  ))}
                </select>
              </div>

              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busyAction === 'discover'}
                    onClick={() =>
                      runInstanceAction(
                        'discover',
                        '/api/integrations/uazapi/discover',
                        {},
                        'Auto-descoberta UaZapi concluída via AdminToken.'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'discover' ? 'animate-spin' : ''}`} />
                    Auto-Descobrir
                  </button>
                  <button
                    type="button"
                    disabled={busyAction === 'test-webhook'}
                    onClick={() =>
                      runInstanceAction(
                        'test-webhook',
                        '/api/integrations/uazapi/test-webhook',
                        {},
                        'Autoteste de Webhook UaZapi validado (Ingestão + ACK + Imutabilidade).'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Play className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Testar Webhook
                  </button>
                  <button
                    type="button"
                    onClick={openNewInstance}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Nova Instância / Número
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <div className="truncate">
                Endpoint Webhook UaZapi V2:{' '}
                <code className="font-mono text-slate-800 dark:text-slate-100">
                  {typeof window !== 'undefined'
                    ? `${window.location.origin}/api/integrations/uazapi/webhook`
                    : '/api/integrations/uazapi/webhook'}
                </code>
              </div>
              <button
                type="button"
                onClick={() => {
                  const url =
                    typeof window !== 'undefined'
                      ? `${window.location.origin}/api/integrations/uazapi/webhook`
                      : '/api/integrations/uazapi/webhook';
                  navigator.clipboard?.writeText(url).catch(() => {});
                  onToast('URL do Webhook UaZapi copiada.');
                }}
                className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900 whitespace-nowrap shrink-0 dark:text-slate-200 dark:hover:text-white"
              >
                <CopyIcon className="w-3 h-3" />
                Copiar URL Webhook
              </button>
            </div>
          </div>

          {/* Instances Data Grid */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-2.5 whitespace-nowrap">Rótulo &amp; ID Instância</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Número / Perfil</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Unidade</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Grupos Associados</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Módulos &amp; Titular</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Sessão &amp; Webhook</th>
                    <th className="px-4 py-2.5 text-right whitespace-nowrap">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredInstances.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center space-y-2 text-slate-500 dark:text-slate-400">
                        <div>Nenhuma instância UaZapi cadastrada neste filtro.</div>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={openNewInstance}
                            className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline dark:text-blue-300"
                          >
                            <Plus className="w-3.5 h-3.5" /> Adicionar primeira linha WhatsApp
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredInstances.map((inst) => {
                      const unit = units.find((u) => u.id === inst.unitId);
                      const groupNames = (inst.allowedGroupIds || [])
                        .map((gid) => groups.find((g) => g.id === gid)?.name)
                        .filter(Boolean);
                      const collab = inst.assignedCollaboratorId
                        ? collaborators.find((c) => c.id === inst.assignedCollaboratorId)
                        : null;
                      const modLabels = (inst.allowedModules || [])
                        .map((m) => MODULE_SCOPE_OPTIONS.find((o) => o.id === m)?.label.split(' ')[0] || m);

                      return (
                        <tr key={inst.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {inst.label}
                              {inst.isDefaultForUnit ? (
                                <span className="text-[11px] font-normal text-emerald-700 dark:text-emerald-300"> · Padrão</span>
                              ) : null}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {inst.uazapiInstanceId}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                              {inst.connectedPhone || inst.defaultPhone || 'Não pareado'}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate max-w-[160px] dark:text-slate-400">
                              {inst.profileName || 'AES-256-GCM Token Ativo'}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap font-medium text-slate-800 dark:text-slate-100">
                            {unit ? `${unit.code} · ${unit.name}` : `#${inst.unitId}`}
                          </td>
                          <td className="px-4 py-2.5 max-w-[230px]">
                            <div className="text-[11px] text-slate-700 truncate dark:text-slate-200">
                              {groupNames.length > 0
                                ? groupNames.join(' · ')
                                : 'Todos os grupos da unidade'}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 max-w-[220px]">
                            <div className="text-[11px] text-slate-700 truncate dark:text-slate-200">
                              {modLabels.join(' · ') || 'Geral'}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate dark:text-slate-400">
                              {collab ? `Titular: ${collab.name}` : 'Uso compartilhado do grupo'}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div
                              className={`font-semibold text-[11px] ${
                                !inst.active
                                  ? 'text-slate-400 dark:text-slate-400'
                                  : inst.isConnected
                                  ? 'text-emerald-700 dark:text-emerald-300'
                                  : 'text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {!inst.active
                                ? 'Inativa'
                                : inst.isConnected
                                ? 'Conectada'
                                : 'Aguardando QR Code'}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              {inst.webhookRegisteredAt ? 'Webhook ativo' : inst.webhookLastError || 'Webhook pendente'}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {isAdmin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onPairInstanceQr(inst)}
                                    title="Conectar / Parear via QR Code"
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                                  >
                                    <QrCode className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
                                    QR Code
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyAction === `status-${inst.id}`}
                                    onClick={() =>
                                      runInstanceAction(
                                        `status-${inst.id}`,
                                        '/api/integrations/uazapi/test',
                                        { instanceId: inst.uazapiInstanceId },
                                        `Status da instância ${inst.label} atualizado.`
                                      )
                                    }
                                    title="Verificar Status Remoto"
                                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                                  >
                                    <RefreshCw
                                      className={`w-3.5 h-3.5 ${
                                        busyAction === `status-${inst.id}` ? 'animate-spin' : ''
                                      }`}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyAction === `wh-${inst.id}`}
                                    onClick={() =>
                                      runInstanceAction(
                                        `wh-${inst.id}`,
                                        '/api/integrations/uazapi/register-webhook',
                                        { instanceId: inst.uazapiInstanceId },
                                        `Webhook registrado na instância ${inst.label}.`
                                      )
                                    }
                                    title="Registrar Webhook na UaZapi"
                                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-700 dark:text-slate-400 dark:hover:bg-slate-800"
                                  >
                                    <Link2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEditInstance(inst)}
                                    title="Editar Instância e Grupos"
                                    className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  {inst.isConnected && (
                                    <button
                                      type="button"
                                      disabled={busyAction === `disc-${inst.id}`}
                                      onClick={() =>
                                        runInstanceAction(
                                          `disc-${inst.id}`,
                                          '/api/integrations/uazapi/disconnect',
                                          { instanceId: inst.uazapiInstanceId },
                                          `Sessão WhatsApp de ${inst.label} desconectada.`
                                        )
                                      }
                                      title="Desconectar Sessão"
                                      className="rounded-md p-1.5 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/60"
                                    >
                                      <Unplug className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRemoveErr('');
                                      setRemoveCanForce(false);
                                      setRemoveTarget(inst);
                                    }}
                                    title="Remover Instância"
                                    className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* SUB-ABA: HISTÓRICO & IMPORTAÇÃO COMPLETA UAZAPI (Seção 4 do Manual) */
        <div className="space-y-4 text-xs">
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Importação Integral de Histórico UaZapi
                </div>
                <p className="text-slate-500 dark:text-slate-400">
                  Varre todas as instâncias ativas, cria threads ausentes e importa mensagens preservando deduplicação por ID externo.
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  disabled={Boolean(importState?.running)}
                  onClick={async () => {
                    try {
                      const res = await apiFetch<{ importState: UazapiImportState }>(
                        '/api/config/uazapi/import-history',
                        { method: 'POST' }
                      );
                      setImportState(res.importState);
                      onToast('Importação de histórico UaZapi concluída.');
                      loadHistory(1);
                    } catch (err) {
                      onToast(err instanceof Error ? err.message : 'Aviso na importação UaZapi.');
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${importState?.running ? 'animate-spin' : ''}`} />
                  {importState?.running ? 'Importando conversas...' : 'Importar Histórico Completo'}
                </button>
              )}
            </div>

            {importState && (importState.running || importState.startedAt) && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] tabular-nums">
                  <span>
                    Conversas processadas: <strong>{importState.chatsProcessed}</strong> / {importState.totalChats}
                  </span>
                  <span>
                    Mensagens inseridas: <strong>{importState.messagesInserted}</strong>
                  </span>
                  <span>
                    Início: {importState.startedAt ? formatDateTimeBR(importState.startedAt) : '—'}
                  </span>
                </div>
                <progress
                  value={
                    importState.totalChats > 0
                      ? Math.round((importState.chatsProcessed / importState.totalChats) * 100)
                      : importState.running
                      ? 20
                      : 100
                  }
                  max={100}
                  className="w-full h-2 rounded overflow-hidden accent-emerald-600"
                />
                {importState.lastError && (
                  <div className="text-red-700 font-medium dark:text-red-300">{importState.lastError}</div>
                )}
              </div>
            )}

            {/* Filter Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100 items-end dark:border-slate-800">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Número</label>
                <input
                  type="text"
                  value={histPhone}
                  onChange={(e) => setHistPhone(e.target.value)}
                  placeholder="DDD + Número"
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Direção</label>
                <select
                  value={histDir}
                  onChange={(e) => setHistDir(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="all">Todas</option>
                  <option value="inbound">Recebidas (Inbound)</option>
                  <option value="outbound">Enviadas (Outbound)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Instância</label>
                <select
                  value={histInst}
                  onChange={(e) => setHistInst(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Todas</option>
                  {instances.map((i) => (
                    <option key={i.id} value={i.uazapiInstanceId}>
                      {i.label} ({i.uazapiInstanceId})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">De</label>
                <input
                  type="date"
                  value={histFrom}
                  onChange={(e) => setHistFrom(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 dark:text-slate-300">Até</label>
                <input
                  type="date"
                  value={histTo}
                  onChange={(e) => setHistTo(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setHistPage(1);
                    loadHistory(1);
                  }}
                  className="flex-1 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  Filtrar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHistPhone('');
                    setHistDir('all');
                    setHistInst('');
                    setHistFrom('');
                    setHistTo('');
                    setHistPage(1);
                  }}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Limpar
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-2.5 whitespace-nowrap">Data / Hora</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Telefone &amp; Contato</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Direção</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Tipo</th>
                    <th className="px-4 py-2.5">Mensagem</th>
                    <th className="px-4 py-2.5 whitespace-nowrap">Unidade · Instância</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {histLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Carregando histórico UaZapi...
                      </td>
                    </tr>
                  ) : histRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Nenhuma mensagem UaZapi encontrada para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    histRows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600 tabular-nums whitespace-nowrap dark:text-slate-300">
                          {formatDateTimeBR(r.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">{r.phone}</div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[160px] dark:text-slate-400">{r.contactName}</div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span
                            className={`text-[11px] font-semibold ${
                              r.direction === 'inbound' ? 'text-blue-700 dark:text-blue-300' : 'text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            {r.direction === 'inbound' ? 'Recebida' : 'Enviada'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600 whitespace-nowrap dark:text-slate-300">
                          {r.contentType}
                        </td>
                        <td className="px-4 py-2.5 max-w-md">
                          <div className="text-slate-800 line-clamp-2 dark:text-slate-100">
                            {r.deletedInOrigin ? `[Apagada na origem] ${r.body}` : r.body}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-[11px] text-slate-600 whitespace-nowrap dark:text-slate-300">
                          {r.unitName} · <span className="font-mono">{r.instanceId}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <span className="font-mono tabular-nums">
                Total: {histTotal} mensagem(ns) · Página {histPage} de {histTotalPages} (50/pág)
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={histPage <= 1}
                  onClick={() => setHistPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-200 px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={histPage >= histTotalPages}
                  onClick={() => setHistPage((p) => Math.min(histTotalPages, p + 1))}
                  className="rounded border border-slate-200 px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-slate-700"
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nova / Editar Instância UaZapi + Associação por Grupos & Setores */}
      {instModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form
            onSubmit={handleSaveInstance}
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                {editInstId ? 'Editar Instância UaZapi & Grupos Autorizados' : 'Nova Instância / Número UaZapi'}
              </h3>
              <button
                type="button"
                onClick={() => setInstModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {instErr && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 font-medium text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                {instErr}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Rótulo Identificador *</label>
                <input
                  type="text"
                  required
                  value={instLabel}
                  onChange={(e) => setInstLabel(e.target.value)}
                  placeholder="Ex: Comercial Matriz #01"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">ID da Instância no UaZapi *</label>
                <input
                  type="text"
                  required
                  value={instCode}
                  onChange={(e) => setInstCode(e.target.value)}
                  placeholder="Ex: inst_recife_comercial_01"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Unidade Base *</label>
                <select
                  value={instUnitId}
                  onChange={(e) => setInstUnitId(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} · {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Telefone Padrão da Linha</label>
                <input
                  type="text"
                  value={instDefaultPhone}
                  onChange={(e) => setInstDefaultPhone(formatPhoneMask(e.target.value))}
                  placeholder="(81) 99988-7766"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Server URL UaZapi</label>
                <input
                  type="url"
                  value={instServerUrl}
                  onChange={(e) => setInstServerUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                  Token da Instância {editInstId ? '(Deixe em branco p/ manter)' : '*'}
                </label>
                <input
                  type="password"
                  required={!editInstId}
                  value={instToken}
                  onChange={(e) => setInstToken(e.target.value)}
                  placeholder={editInstId ? '••••••••••••••••' : 'Cole o token da instância'}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700"
                />
              </div>
            </div>

            {/* Associação Multi-Grupo */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-800 dark:text-slate-100">
                  Grupos de Usuários Autorizados a Operar este Número
                </label>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Vazio = liberado a todos os grupos da unidade
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={instAllowedGroupIds.includes(g.id)}
                      onChange={() => toggleGroupSelection(g.id)}
                    />
                    <span className="font-medium text-slate-800 dark:text-slate-100">{g.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Escopo de Módulos Operacionais */}
            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-800 dark:text-slate-100">
                Módulos Operacionais Habilitados para esta Linha
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                {MODULE_SCOPE_OPTIONS.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={instAllowedModules.includes(m.id)}
                      onChange={() => toggleModuleSelection(m.id)}
                    />
                    <span className="font-medium text-slate-800 dark:text-slate-100">{m.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">
                  Colaborador Titular Dedicado (Opcional)
                </label>
                <select
                  value={instCollaboratorId}
                  onChange={(e) => setInstCollaboratorId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Compartilhado entre o grupo / setor</option>
                  {collaborators.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name} ({c.jobTitle || c.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2 pb-1">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={instDefaultForUnit}
                    onChange={(e) => setInstDefaultForUnit(e.target.checked)}
                  />
                  <span>Definir como número padrão da unidade</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={instActive}
                    onChange={(e) => setInstActive(e.target.checked)}
                  />
                  <span>Instância ativa para envios e recepção</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setInstModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={instSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Check className="w-3.5 h-3.5" />
                {instSaving ? 'Criptografando & Salvando...' : 'Salvar Instância'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Remover Instância com Fallback Forçar Remoção Local */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0 dark:bg-red-900/50 dark:text-red-300">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Remover Instância · {removeTarget.label}
                </h3>
                <p className="text-slate-600 leading-relaxed dark:text-slate-300">
                  O sistema tentará desconectar a sessão remota antes de excluir as credenciais criptografadas locais. O histórico de mensagens já recebidas permanece preservado.
                </p>
              </div>
            </div>

            {removeErr && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 font-medium dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
                {removeErr}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                disabled={removeBusy}
                onClick={() => setRemoveTarget(null)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancelar
              </button>
              {removeCanForce ? (
                <button
                  type="button"
                  disabled={removeBusy}
                  onClick={() => handleDeleteInstance(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 font-semibold text-white hover:bg-amber-700"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {removeBusy ? 'Removendo...' : 'Forçar Remoção Local'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={removeBusy}
                  onClick={() => handleDeleteInstance(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 font-semibold text-white hover:bg-red-700"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {removeBusy ? 'Desconectando...' : 'Desconectar & Remover'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
