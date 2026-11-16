import React, { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  History,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../../../lib/api.ts';
import {
  BankContactItem,
  BankItem,
  BankServiceItem,
  FebrabanBankItem,
  MeasurementUnitItem,
  ModalityItem,
  ProductItem,
  SeriesItem,
  SeriesUnitNumberingItem,
  Unit,
} from '../../../types.ts';
import { ConfirmDeleteModal, EntityAuditModal, formatPhoneMask } from './CadastrosShared.tsx';

// =============================================================================
// 5. BANCOS + FEBRABAN (BrasilAPI) + SUBGRADES (Serviços & Contatos)
// =============================================================================
export const BanksCrudView: React.FC<{
  banks: BankItem[];
  febrabanBanks: FebrabanBankItem[];
  modalities: ModalityItem[];
  onRefresh: () => Promise<void>;
}> = ({ banks, febrabanBanks, modalities, onRefresh }) => {
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [febrabanCode, setFebrabanCode] = useState('');
  const [status, setStatus] = useState<'ATIVO' | 'INATIVO'>('ATIVO');
  const [notes, setNotes] = useState('');
  const [services, setServices] = useState<BankServiceItem[]>([]);
  const [contacts, setContacts] = useState<BankContactItem[]>([]);

  // FEBRABAN picker
  const [febSearch, setFebSearch] = useState('');
  const [febOpen, setFebOpen] = useState(false);
  const [febRefreshing, setFebRefreshing] = useState(false);

  // List filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'status'>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BankItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [auditTarget, setAuditTarget] = useState<{ id: number; label: string } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = banks.filter((b) => {
      if (filterStatus && b.status !== filterStatus) return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        (b.code || '').toLowerCase().includes(q) ||
        (b.febrabanCode || '').toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => {
      const va = sortBy === 'status' ? a.status : a.name;
      const vb = sortBy === 'status' ? b.status : b.name;
      return sortAsc ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR');
    });
    return list;
  }, [banks, search, filterStatus, sortBy, sortAsc]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const filteredFebraban = useMemo(() => {
    const q = febSearch.trim().toLowerCase();
    return febrabanBanks
      .filter((f) => !q || f.code.includes(q) || f.name.toLowerCase().includes(q) || f.fullName.toLowerCase().includes(q))
      .slice(0, 40);
  }, [febrabanBanks, febSearch]);

  const openForm = (b?: BankItem, isDup = false) => {
    setErrorMsg('');
    setFeedback('');
    setFebOpen(false);
    setFebSearch('');
    if (b) {
      setEditingId(isDup ? null : b.id);
      setCode(isDup ? '' : b.code || '');
      setName(isDup ? `${b.name} (Cópia)` : b.name);
      setFebrabanCode(b.febrabanCode || '');
      setStatus(b.status === 'INATIVO' ? 'INATIVO' : 'ATIVO');
      setNotes(b.notes || '');
      setServices((b.services || []).map((s) => ({ ...s })));
      setContacts((b.contacts || []).map((c) => ({ ...c })));
    } else {
      setEditingId(null);
      setCode('');
      setName('');
      setFebrabanCode('');
      setStatus('ATIVO');
      setNotes('');
      setServices([
        {
          name: 'Revisão Bancária 45%',
          modalityId: modalities[0]?.id || null,
          modalityDescription: modalities[0]?.description || '',
          negotiationPercent: '45',
          defaultInstallments: 12,
        },
      ]);
      setContacts([]);
    }
    setMode('form');
  };

  const handleSyncFebraban = async () => {
    setFebRefreshing(true);
    setErrorMsg('');
    try {
      await apiFetch('/api/cadastros/febraban-banks?refresh=1');
      await onRefresh();
      setFeedback('Lista oficial FEBRABAN sincronizada via BrasilAPI.');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao sincronizar BrasilAPI.');
    } finally {
      setFebRefreshing(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Nome do banco é obrigatório.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        febrabanCode: febrabanCode.trim(),
        status,
        notes: notes.trim(),
        services: services.filter((s) => s.name.trim()),
        contacts: contacts.filter((c) => c.name.trim()),
      };
      if (editingId) {
        await apiFetch(`/api/cadastros/banks/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        setFeedback(`Banco "${payload.name}" e subgrades atualizados.`);
      } else {
        await apiFetch('/api/cadastros/banks', { method: 'POST', body: JSON.stringify(payload) });
        setFeedback(`Banco "${payload.name}" cadastrado com ${payload.services.length} serviço(s).`);
      }
      await onRefresh();
      setMode('list');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao salvar banco.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await apiFetch(`/api/cadastros/banks/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setFeedback(`Banco "${deleteTarget.name}" excluído.`);
      await onRefresh();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Erro ao excluir banco.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mode === 'list' ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Cadastros Comuns · Bancos</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Instituições financeiras FEBRABAN, Serviços &amp; Percentuais que alimentam o recálculo da Admissão
              </p>
            </div>
            <button
              type="button"
              onClick={() => openForm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" /> Novo Banco
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-wrap items-center gap-2 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar por nome, código interno ou código FEBRABAN..."
                className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 dark:border-slate-700"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">Todos Status</option>
              <option value="ATIVO">ATIVO</option>
              <option value="INATIVO">INATIVO</option>
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortBy === 'name') setSortAsc((s) => !s);
                        else {
                          setSortBy('name');
                          setSortAsc(true);
                        }
                      }}
                      className="inline-flex items-center gap-1"
                    >
                      Descrição (Nome) <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">FEBRABAN</th>
                  <th className="py-3 px-4">Serviços / Contatos</th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortBy === 'status') setSortAsc((s) => !s);
                        else {
                          setSortBy('status');
                          setSortAsc(true);
                        }
                      }}
                      className="inline-flex items-center gap-1"
                    >
                      Status <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      Nenhum banco localizado.
                    </td>
                  </tr>
                ) : (
                  paged.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{b.name}</div>
                        {b.code && <div className="font-mono text-[10px] text-slate-400 dark:text-slate-400">{b.code}</div>}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-200">{b.febrabanCode || '—'}</td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {b.services?.length || 0} serviço(s) · {b.contacts?.length || 0} contato(s)
                      </td>
                      <td className="py-3 px-4">
                        <span className={b.status === 'ATIVO' ? 'text-emerald-700 font-semibold dark:text-emerald-300' : 'text-slate-400 font-semibold dark:text-slate-400'}>
                          {b.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setAuditTarget({ id: b.id, label: b.name })}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            title="Auditoria"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openForm(b, false)}
                            className="rounded-md border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                            title="Editar"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openForm(b, true)}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            title="Duplicar"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteErr('');
                              setDeleteTarget(b);
                            }}
                            className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                            title="Excluir"
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

            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <span>
                Total: {filtered.length} banco(s) · Página {page} de {totalPages}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 disabled:opacity-40 dark:border-slate-700"
                >
                  Próxima <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  {editingId ? `Editar Banco · ${name}` : 'Novo Banco Credor'}
                </h2>
              </div>
              <button
                type="button"
                disabled={febRefreshing}
                onClick={handleSyncFebraban}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${febRefreshing ? 'animate-spin' : ''}`} />
                Sincronizar BrasilAPI ({febrabanBanks.length})
              </button>
            </div>

            {/* Seletor FEBRABAN */}
            <div className="relative rounded-xl border border-blue-200 bg-blue-50/50 p-3.5 space-y-2 dark:border-blue-800/70 dark:bg-blue-950/50">
              <div className="flex items-center justify-between">
                <label className="font-bold text-blue-950 flex items-center gap-1.5 dark:text-blue-300">
                  <Landmark className="w-3.5 h-3.5" /> Seletor FEBRABAN (Preenchimento automático)
                </label>
                <button type="button" onClick={() => setFebOpen((o) => !o)} className="text-blue-700 font-semibold hover:underline dark:text-blue-300">
                  {febOpen ? 'Fechar busca' : 'Pesquisar na base FEBRABAN'}
                </button>
              </div>
              {febOpen && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={febSearch}
                    onChange={(e) => setFebSearch(e.target.value)}
                    placeholder="Digite código COMPE (ex: 033, 341) ou nome do banco..."
                    className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 dark:border-blue-800/70 dark:bg-slate-900"
                  />
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-blue-100 bg-white divide-y divide-slate-100 dark:border-blue-800/70 dark:bg-slate-900 dark:divide-slate-800">
                    {filteredFebraban.map((fb) => (
                      <button
                        key={fb.code}
                        type="button"
                        onClick={() => {
                          setFebrabanCode(fb.code);
                          if (!code) setCode(`BCO-${fb.code}`);
                          setName(fb.name);
                          setFebOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2 dark:hover:bg-blue-950/60"
                      >
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{fb.name}</span>
                        <span className="font-mono text-slate-500 dark:text-slate-400">{fb.code} · {fb.fullName}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5">
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Código Interno</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="BCO-033"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="lg:col-span-5">
                <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Nome / Descrição *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Banco Santander (Brasil) S.A."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700"
                />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Código FEBRABAN</label>
                <input
                  type="text"
                  value={febrabanCode}
                  onChange={(e) => setFebrabanCode(e.target.value)}
                  placeholder="033"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'ATIVO' | 'INATIVO')}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="ATIVO">ATIVO</option>
                  <option value="INATIVO">INATIVO</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Anotações</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-slate-200 p-2.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          {/* SUBGRADE 1: Serviços Bancários & Percentuais */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Serviços Bancários &amp; Percentuais de Negociação ({services.length})
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Ao selecionar este banco em Admissão &amp; Dossiês, os cenários da Seção 05 usam estes percentuais e prazos.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setServices((p) => [
                    ...p,
                    {
                      name: '',
                      modalityId: modalities[0]?.id || null,
                      modalityDescription: modalities[0]?.description || '',
                      negotiationPercent: '45',
                      defaultInstallments: 12,
                    },
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar Serviço
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl dark:border-slate-700">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                    <th className="py-2 px-3">Serviço</th>
                    <th className="py-2 px-3">Modalidade</th>
                    <th className="py-2 px-3 w-28">Percentual (%)</th>
                    <th className="py-2 px-3 w-28">Parcelas Padrão</th>
                    <th className="py-2 px-3 text-right w-16">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {services.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-slate-400 dark:text-slate-400">
                        Nenhum serviço cadastrado. Clique em &quot;Adicionar Serviço&quot;.
                      </td>
                    </tr>
                  ) : (
                    services.map((srv, idx) => (
                      <tr key={idx}>
                        <td className="p-2">
                          <input
                            type="text"
                            value={srv.name}
                            onChange={(e) =>
                              setServices((p) => p.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                            }
                            placeholder="Ex: Quitação à Vista 35%"
                            className="w-full rounded border border-slate-200 px-2.5 py-1.5 dark:border-slate-700"
                          />
                        </td>
                        <td className="p-2">
                          <select
                            value={srv.modalityId || ''}
                            onChange={(e) => {
                              const mid = e.target.value ? Number(e.target.value) : null;
                              const mod = modalities.find((m) => m.id === mid);
                              setServices((p) =>
                                p.map((x, i) =>
                                  i === idx ? { ...x, modalityId: mid, modalityDescription: mod?.description || '' } : x
                                )
                              );
                            }}
                            className="w-full rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700"
                          >
                            <option value="">Geral</option>
                            {modalities.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.description}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={srv.negotiationPercent}
                            onChange={(e) =>
                              setServices((p) =>
                                p.map((x, i) => (i === idx ? { ...x, negotiationPercent: e.target.value } : x))
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2.5 py-1.5 font-mono dark:border-slate-700"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={1}
                            value={srv.defaultInstallments}
                            onChange={(e) =>
                              setServices((p) =>
                                p.map((x, i) =>
                                  i === idx ? { ...x, defaultInstallments: Math.max(1, Number(e.target.value || 1)) } : x
                                )
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2.5 py-1.5 font-mono dark:border-slate-700"
                          />
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            onClick={() => setServices((p) => p.filter((_, i) => i !== idx))}
                            className="rounded p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* SUBGRADE 2: Contatos Bancários */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Contatos do Banco ({contacts.length})
              </h3>
              <button
                type="button"
                onClick={() =>
                  setContacts((p) => [
                    ...p,
                    { name: '', sector: '', phone: '', mobile: '', isWhatsapp: false, email: '' },
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar Contato
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl dark:border-slate-700">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                    <th className="py-2 px-3">Nome</th>
                    <th className="py-2 px-3">Setor</th>
                    <th className="py-2 px-3">Telefone</th>
                    <th className="py-2 px-3">Celular / Zap</th>
                    <th className="py-2 px-3">E-mail</th>
                    <th className="py-2 px-3 text-right w-14">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {contacts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-slate-400 dark:text-slate-400">
                        Nenhum contato bancário adicionado.
                      </td>
                    </tr>
                  ) : (
                    contacts.map((c, idx) => (
                      <tr key={idx}>
                        <td className="p-2">
                          <input
                            type="text"
                            value={c.name}
                            onChange={(e) =>
                              setContacts((p) => p.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                            }
                            placeholder="Gerente / Mesa"
                            className="w-full rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={c.sector}
                            onChange={(e) =>
                              setContacts((p) => p.map((x, i) => (i === idx ? { ...x, sector: e.target.value } : x)))
                            }
                            placeholder="Acordos"
                            className="w-full rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={c.phone}
                            onChange={(e) =>
                              setContacts((p) =>
                                p.map((x, i) => (i === idx ? { ...x, phone: formatPhoneMask(e.target.value) } : x))
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono dark:border-slate-700"
                          />
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={c.mobile}
                              onChange={(e) =>
                                setContacts((p) =>
                                  p.map((x, i) => (i === idx ? { ...x, mobile: formatPhoneMask(e.target.value) } : x))
                                )
                              }
                              className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono dark:border-slate-700"
                            />
                            <label className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                              <input
                                type="checkbox"
                                checked={c.isWhatsapp}
                                onChange={(e) =>
                                  setContacts((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, isWhatsapp: e.target.checked } : x))
                                  )
                                }
                              />
                              Zap
                            </label>
                          </div>
                        </td>
                        <td className="p-2">
                          <input
                            type="email"
                            value={c.email}
                            onChange={(e) =>
                              setContacts((p) => p.map((x, i) => (i === idx ? { ...x, email: e.target.value } : x)))
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700"
                          />
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            onClick={() => setContacts((p) => p.filter((_, i) => i !== idx))}
                            className="rounded p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar Banco & Subgrades'}
            </button>
          </div>
        </form>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={`Excluir Banco "${deleteTarget?.name || ''}"`}
        description="A exclusão será bloqueada se existirem admissões vinculadas a esta instituição financeira."
        busy={deleteBusy}
        error={deleteErr}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />

      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={auditTarget?.label || ''}
        entityType="bank"
        entityId={auditTarget?.id || 0}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};

// =============================================================================
// 6. MODALIDADES
// =============================================================================
export const ModalitiesCrudView: React.FC<{
  modalities: ModalityItem[];
  onRefresh: () => Promise<void>;
}> = ({ modalities, onRefresh }) => {
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [typeVal, setTypeVal] = useState('');
  const [description, setDescription] = useState('');
  const [hasVehicleSection, setHasVehicleSection] = useState(false);
  const [active, setActive] = useState(true);

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'type' | 'description'>('type');
  const [sortAsc, setSortAsc] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ModalityItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [auditTarget, setAuditTarget] = useState<{ id: number; label: string } | null>(null);

  const knownTypes = useMemo(() => {
    const base = ['Veicular', 'Pessoal', 'Cartão', 'Consignado', 'Bancário', 'Imobiliário'];
    const merged = Array.from(new Set([...base, ...modalities.map((m) => m.type).filter(Boolean)]));
    return merged.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [modalities]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = modalities.filter(
      (m) => !q || m.type.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)
    );
    list.sort((a, b) => {
      const va = sortBy === 'description' ? a.description : a.type;
      const vb = sortBy === 'description' ? b.description : b.type;
      return sortAsc ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR');
    });
    return list;
  }, [modalities, search, sortBy, sortAsc]);

  const openForm = (m?: ModalityItem, isDup = false) => {
    setErrorMsg('');
    setFeedback('');
    if (m) {
      setEditingId(isDup ? null : m.id);
      setTypeVal(m.type);
      setDescription(isDup ? `${m.description} (Cópia)` : m.description);
      setHasVehicleSection(m.hasVehicleSection);
      setActive(m.active);
    } else {
      setEditingId(null);
      setTypeVal('Veicular');
      setDescription('');
      setHasVehicleSection(false);
      setActive(true);
    }
    setMode('form');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeVal.trim() || !description.trim()) {
      setErrorMsg('Tipo e Descrição são obrigatórios.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const payload = {
        type: typeVal.trim(),
        description: description.trim(),
        hasVehicleSection,
        active,
      };
      if (editingId) {
        await apiFetch(`/api/cadastros/modalities/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        setFeedback(`Modalidade "${payload.description}" atualizada.`);
      } else {
        await apiFetch('/api/cadastros/modalities', { method: 'POST', body: JSON.stringify(payload) });
        setFeedback(`Modalidade "${payload.description}" cadastrada.`);
      }
      await onRefresh();
      setMode('list');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao salvar modalidade.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await apiFetch(`/api/cadastros/modalities/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setFeedback(`Modalidade "${deleteTarget.description}" excluída.`);
      await onRefresh();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Erro ao excluir modalidade.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mode === 'list' ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Cadastros Comuns · Modalidades</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Classificação das operações em Admissão &amp; Dossiês e Serviços Bancários
              </p>
            </div>
            <button
              type="button"
              onClick={() => openForm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" /> Nova Modalidade
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por tipo ou descrição..."
                className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortBy === 'type') setSortAsc((s) => !s);
                        else {
                          setSortBy('type');
                          setSortAsc(true);
                        }
                      }}
                      className="inline-flex items-center gap-1"
                    >
                      Tipo <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortBy === 'description') setSortAsc((s) => !s);
                        else {
                          setSortBy('description');
                          setSortAsc(true);
                        }
                      }}
                      className="inline-flex items-center gap-1"
                    >
                      Descrição <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">Ativa Seção Veículo</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                    <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-200">{m.type}</td>
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100">{m.description}</td>
                    <td className="py-3 px-4">
                      <span className={m.hasVehicleSection ? 'text-emerald-700 font-semibold dark:text-emerald-300' : 'text-slate-400 dark:text-slate-400'}>
                        {m.hasVehicleSection ? 'Sim (Seção 03)' : 'Não'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setAuditTarget({ id: m.id, label: m.description })}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          title="Auditoria"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openForm(m, false)}
                          className="rounded-md border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                          title="Editar"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openForm(m, true)}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          title="Duplicar"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteErr('');
                            setDeleteTarget(m);
                          }}
                          className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <form onSubmit={handleSave} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {editingId ? 'Editar Modalidade' : 'Nova Modalidade'}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Tipo * (selecione ou digite um novo)</label>
              <input
                type="text"
                required
                list="modality-types-list"
                value={typeVal}
                onChange={(e) => setTypeVal(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <datalist id="modality-types-list">
                {knownTypes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Descrição *</label>
              <input
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: CDC Veículo"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-6 pt-2">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer dark:text-slate-100">
              <input
                type="checkbox"
                checked={hasVehicleSection}
                onChange={(e) => setHasVehicleSection(e.target.checked)}
              />
              Exibe seção &quot;03. Informações do Veículo&quot; na ficha de Admissão
            </label>
            <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer dark:text-slate-100">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Modalidade Ativa
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar Modalidade'}
            </button>
          </div>
        </form>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={`Excluir Modalidade "${deleteTarget?.description || ''}"`}
        description="A exclusão será bloqueada se existir admissão ou serviço bancário vinculado a esta modalidade."
        busy={deleteBusy}
        error={deleteErr}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />

      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={auditTarget?.label || ''}
        entityType="modality"
        entityId={auditTarget?.id || 0}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};

// =============================================================================
// 7. PRODUTOS & UNIDADES DE MEDIDA (Com Modal de Unidade)
// =============================================================================
export const ProductsCrudView: React.FC<{
  products: ProductItem[];
  measurementUnits: MeasurementUnitItem[];
  onRefresh: () => Promise<void>;
}> = ({ products, measurementUnits, onRefresh }) => {
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [typeVal, setTypeVal] = useState<'SERVICO' | 'MATERIAL'>('SERVICO');
  const [description, setDescription] = useState('');
  const [unitId, setUnitId] = useState<number | ''>('');

  // Modal de Unidade de Medida
  const [muModal, setMuModal] = useState<{ open: boolean; editing: MeasurementUnitItem | null }>({ open: false, editing: null });
  const [muName, setMuName] = useState('');
  const [muFactor, setMuFactor] = useState('1');
  const [muBusy, setMuBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProductItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [auditTarget, setAuditTarget] = useState<{ id: number; label: string } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (filterType && p.type !== filterType) return false;
      return !q || p.description.toLowerCase().includes(q) || (p.unitName || '').toLowerCase().includes(q);
    });
  }, [products, search, filterType]);

  const openForm = (p?: ProductItem, isDup = false) => {
    setErrorMsg('');
    setFeedback('');
    if (p) {
      setEditingId(isDup ? null : p.id);
      setTypeVal(p.type === 'MATERIAL' ? 'MATERIAL' : 'SERVICO');
      setDescription(isDup ? `${p.description} (Cópia)` : p.description);
      setUnitId(p.unitId || '');
    } else {
      setEditingId(null);
      setTypeVal('SERVICO');
      setDescription('');
      setUnitId(measurementUnits[0]?.id || '');
    }
    setMode('form');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || !unitId) {
      setErrorMsg('Descrição e Unidade de Medida são obrigatórias.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const payload = { type: typeVal, description: description.trim(), unitId: Number(unitId) };
      if (editingId) {
        await apiFetch(`/api/cadastros/products/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        setFeedback(`Produto "${payload.description}" atualizado.`);
      } else {
        await apiFetch('/api/cadastros/products', { method: 'POST', body: JSON.stringify(payload) });
        setFeedback(`Produto "${payload.description}" cadastrado.`);
      }
      await onRefresh();
      setMode('list');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao salvar produto.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMeasurementUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!muName.trim()) return;
    setMuBusy(true);
    try {
      let savedId: number | null = null;
      if (muModal.editing) {
        const res = await apiFetch<{ data: MeasurementUnitItem }>(`/api/cadastros/measurement-units/${muModal.editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: muName.trim().toUpperCase().slice(0, 5), conversionFactor: muFactor || '1' }),
        });
        savedId = res.data.id;
      } else {
        const res = await apiFetch<{ data: MeasurementUnitItem }>('/api/cadastros/measurement-units', {
          method: 'POST',
          body: JSON.stringify({ name: muName.trim().toUpperCase().slice(0, 5), conversionFactor: muFactor || '1' }),
        });
        savedId = res.data.id;
      }
      await onRefresh();
      if (savedId) setUnitId(savedId);
      setMuModal({ open: false, editing: null });
      setFeedback('Unidade de medida salva.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar unidade.');
    } finally {
      setMuBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await apiFetch(`/api/cadastros/products/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setFeedback(`Produto "${deleteTarget.description}" excluído.`);
      await onRefresh();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Erro ao excluir produto.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mode === 'list' ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Cadastros Comuns · Produtos</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Catálogo de Serviços e Materiais vinculados às Unidades de Medida</p>
            </div>
            <button
              type="button"
              onClick={() => openForm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" /> Novo Produto
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-wrap gap-2 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar produto/serviço..."
                className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">Todos Tipos</option>
              <option value="SERVICO">Serviço</option>
              <option value="MATERIAL">Material</option>
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <th className="py-3 px-4">Tipo</th>
                  <th className="py-3 px-4">Descrição</th>
                  <th className="py-3 px-4">Unidade</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-700 dark:text-slate-200">
                      {p.type === 'MATERIAL' ? 'Material' : 'Serviço'}
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100">{p.description}</td>
                    <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-200">{p.unitName || '—'}</td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setAuditTarget({ id: p.id, label: p.description })}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          title="Auditoria"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openForm(p, false)}
                          className="rounded-md border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                          title="Editar"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openForm(p, true)}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          title="Duplicar"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteErr('');
                            setDeleteTarget(p);
                          }}
                          className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <form onSubmit={handleSave} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 text-xs dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {editingId ? 'Editar Produto / Serviço' : 'Novo Produto / Serviço'}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
            <div className="sm:col-span-3">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Tipo *</label>
              <select
                value={typeVal}
                onChange={(e) => setTypeVal(e.target.value as 'SERVICO' | 'MATERIAL')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="SERVICO">Serviço</option>
                <option value="MATERIAL">Material</option>
              </select>
            </div>
            <div className="sm:col-span-5">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Descrição *</label>
              <input
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Unidade de Medida *</label>
              <div className="flex gap-1.5">
                <select
                  required
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value ? Number(e.target.value) : '')}
                  className="flex-1 rounded-lg border border-slate-200 px-2.5 py-2 font-mono font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {measurementUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} (fator {u.conversionFactor})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!unitId}
                  onClick={() => {
                    const current = measurementUnits.find((u) => u.id === Number(unitId)) || null;
                    if (current) {
                      setMuName(current.name);
                      setMuFactor(current.conversionFactor);
                      setMuModal({ open: true, editing: current });
                    }
                  }}
                  title="Editar unidade selecionada"
                  className="rounded-lg border border-slate-200 px-2.5 py-2 text-blue-700 hover:bg-blue-50 disabled:opacity-40 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMuName('');
                    setMuFactor('1');
                    setMuModal({ open: true, editing: null });
                  }}
                  title="Nova unidade de medida"
                  className="rounded-lg border border-slate-200 px-2.5 py-2 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar Produto'}
            </button>
          </div>
        </form>
      )}

      {/* Modal: Unidade de Medida (sigla <= 5 chars + fator de conversão) */}
      {muModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 dark:bg-slate-950/80">
          <form onSubmit={handleSaveMeasurementUnit} className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl space-y-4 text-xs dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                {muModal.editing ? 'Editar Unidade de Medida' : 'Nova Unidade de Medida'}
              </h3>
              <button type="button" onClick={() => setMuModal({ open: false, editing: null })} className="text-slate-400 dark:text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Sigla (até 5 caracteres) *</label>
                <input
                  type="text"
                  required
                  maxLength={5}
                  value={muName}
                  onChange={(e) => setMuName(e.target.value.toUpperCase())}
                  placeholder="UN"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono uppercase font-bold dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Fator de Conversão</label>
                <input
                  type="text"
                  value={muFactor}
                  onChange={(e) => setMuFactor(e.target.value)}
                  placeholder="1"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button type="button" onClick={() => setMuModal({ open: false, editing: null })} className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                Cancelar
              </button>
              <button type="submit" disabled={muBusy} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white dark:bg-emerald-600">
                {muBusy ? 'Salvando...' : 'Salvar Unidade'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={`Excluir Produto "${deleteTarget?.description || ''}"`}
        description="Tem certeza que deseja excluir este item do catálogo de produtos e serviços?"
        busy={deleteBusy}
        error={deleteErr}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />

      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={auditTarget?.label || ''}
        entityType="product"
        entityId={auditTarget?.id || 0}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};

// =============================================================================
// 8. SÉRIE / NÚMEROS (Com Subgrade de Numeração por Unidade 100% persistida)
// =============================================================================
export const SeriesCrudView: React.FC<{
  seriesList: SeriesItem[];
  units: Unit[];
  onRefresh: () => Promise<void>;
}> = ({ seriesList, units, onRefresh }) => {
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [sigla, setSigla] = useState('');
  const [description, setDescription] = useState('');
  const [generalNumber, setGeneralNumber] = useState('1');
  const [isDefault, setIsDefault] = useState(false);
  const [unitNumbering, setUnitNumbering] = useState<SeriesUnitNumberingItem[]>([]);

  const [newUnitId, setNewUnitId] = useState<number | ''>(units[0]?.id || '');
  const [newUnitNum, setNewUnitNum] = useState('1');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SeriesItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [auditTarget, setAuditTarget] = useState<{ id: number; label: string } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return seriesList.filter(
      (s) => !q || s.sigla.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }, [seriesList, search]);

  const openForm = (s?: SeriesItem, isDup = false) => {
    setErrorMsg('');
    setFeedback('');
    if (s) {
      setEditingId(isDup ? null : s.id);
      setSigla(isDup ? `${s.sigla.slice(0, 7)}2` : s.sigla);
      setDescription(isDup ? `${s.description} (Cópia)` : s.description);
      setGeneralNumber(String(s.generalNumber || 1));
      setIsDefault(isDup ? false : Boolean(s.isDefault));
      setUnitNumbering((s.unitNumbering || []).map((n) => ({ unitId: n.unitId, currentNumber: n.currentNumber })));
    } else {
      setEditingId(null);
      setSigla('');
      setDescription('');
      setGeneralNumber('1');
      setIsDefault(false);
      setUnitNumbering(units.map((u) => ({ unitId: u.id, currentNumber: 1 })));
    }
    setMode('form');
  };

  const handleAddUnitRow = () => {
    if (!newUnitId) return;
    const uid = Number(newUnitId);
    const num = Math.max(1, Number(newUnitNum || 1));
    setUnitNumbering((prev) => {
      if (prev.some((x) => x.unitId === uid)) {
        return prev.map((x) => (x.unitId === uid ? { ...x, currentNumber: num } : x));
      }
      return [...prev, { unitId: uid, currentNumber: num }];
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sigla.trim() || !description.trim()) {
      setErrorMsg('Sigla e Descrição são obrigatórias.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const payload = {
        sigla: sigla.trim().toUpperCase().slice(0, 10),
        description: description.trim(),
        generalNumber: Math.max(1, Number(generalNumber || 1)),
        isDefault,
        unitNumbering,
      };
      if (editingId) {
        await apiFetch(`/api/cadastros/series/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        setFeedback(`Série "${payload.sigla}" e numeração por unidade atualizadas.`);
      } else {
        await apiFetch('/api/cadastros/series', { method: 'POST', body: JSON.stringify(payload) });
        setFeedback(`Série "${payload.sigla}" cadastrada com ${payload.unitNumbering.length} unidade(s).`);
      }
      await onRefresh();
      setMode('list');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao salvar série.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await apiFetch(`/api/cadastros/series/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      setFeedback(`Série "${deleteTarget.sigla}" excluída.`);
      await onRefresh();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Erro ao excluir série.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 flex items-center justify-between dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800 flex items-center justify-between dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mode === 'list' ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Cadastros Comuns · Série / Números</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Prefixos contratuais e contadores sequenciais por unidade utilizados em Admissão &amp; Dossiês
              </p>
            </div>
            <button
              type="button"
              onClick={() => openForm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="w-3.5 h-3.5" /> Nova Série
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por sigla ou descrição..."
                className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <th className="py-3 px-4">Sigla</th>
                  <th className="py-3 px-4">Descrição</th>
                  <th className="py-3 px-4">Nº Geral</th>
                  <th className="py-3 px-4">Unidades Configuradas</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800">
                    <td className="py-3 px-4 font-mono font-extrabold text-slate-900 dark:text-slate-100">
                      {s.sigla}
                      {s.isDefault && <span className="ml-2 text-[10px] font-sans text-emerald-700 uppercase dark:text-emerald-300">Padrão</span>}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-100">{s.description}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-200">{s.generalNumber}</td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{s.unitNumbering?.length || 0} unidade(s)</td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setAuditTarget({ id: s.id, label: `${s.sigla} - ${s.description}` })}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          title="Auditoria"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openForm(s, false)}
                          className="rounded-md border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-blue-950/60"
                          title="Editar"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openForm(s, true)}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          title="Duplicar"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteErr('');
                            setDeleteTarget(s);
                          }}
                          className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800/70 dark:text-red-400 dark:hover:bg-red-950/60"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {editingId ? `Editar Série · ${sigla}` : 'Nova Série / Numeração'}
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
              <div className="sm:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Sigla *</label>
                <input
                  type="text"
                  required
                  maxLength={10}
                  value={sigla}
                  onChange={(e) => setSigla(e.target.value.toUpperCase())}
                  placeholder="ADM"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono uppercase font-extrabold dark:border-slate-700"
                />
              </div>
              <div className="sm:col-span-5">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Descrição *</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Admissão Matriz"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1 dark:text-slate-200">Nº Geral</label>
                <input
                  type="number"
                  min={1}
                  value={generalNumber}
                  onChange={(e) => setGeneralNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2 pb-2">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer dark:text-slate-100">
                  <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                  Série Padrão
                </label>
              </div>
            </div>
          </div>

          {/* SUBGRADE: Numeração por Unidade */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-700 dark:bg-slate-900">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Numeração por Unidade ({unitNumbering.length})
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Controle sequencial independente salvo diretamente no PostgreSQL por unidade selecionada na Admissão.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 dark:bg-slate-800/70 dark:border-slate-700">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Unidade</label>
                <select
                  value={newUnitId}
                  onChange={(e) => setNewUnitId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} · {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-32">
                <label className="block text-[11px] font-semibold text-slate-500 mb-1 dark:text-slate-400">Numeração Atual</label>
                <input
                  type="number"
                  min={1}
                  value={newUnitNum}
                  onChange={(e) => setNewUnitNum(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="button"
                onClick={handleAddUnitRow}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Plus className="w-3.5 h-3.5" /> Definir Unidade
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl dark:border-slate-700">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-300">
                    <th className="py-2 px-3">Unidade</th>
                    <th className="py-2 px-3 w-40">Numeração Atual</th>
                    <th className="py-2 px-3 text-right w-20">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {unitNumbering.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-slate-400 dark:text-slate-400">
                        Nenhuma numeração específica por unidade definida (usará o Nº Geral).
                      </td>
                    </tr>
                  ) : (
                    unitNumbering.map((row) => {
                      const u = units.find((x) => x.id === row.unitId);
                      return (
                        <tr key={row.unitId}>
                          <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-100">
                            {u ? `${u.code} · ${u.name}` : `Unidade #${row.unitId}`}
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              min={1}
                              value={row.currentNumber}
                              onChange={(e) =>
                                setUnitNumbering((prev) =>
                                  prev.map((x) =>
                                    x.unitId === row.unitId
                                      ? { ...x, currentNumber: Math.max(1, Number(e.target.value || 1)) }
                                      : x
                                  )
                                )
                              }
                              className="w-full rounded border border-slate-200 px-2.5 py-1.5 font-mono dark:border-slate-700"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => setUnitNumbering((prev) => prev.filter((x) => x.unitId !== row.unitId))}
                              className="text-red-600 hover:underline font-semibold dark:text-red-400"
                            >
                              Remover
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMode('list')} className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar Série & Unidades'}
            </button>
          </div>
        </form>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={`Excluir Série "${deleteTarget?.sigla || ''}"`}
        description="A exclusão será bloqueada se existirem admissões utilizando esta sigla."
        busy={deleteBusy}
        error={deleteErr}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />

      <EntityAuditModal
        open={Boolean(auditTarget)}
        title={auditTarget?.label || ''}
        entityType="series"
        entityId={auditTarget?.id || 0}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
};
