import React, { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Check,
  Copy,
  Database,
  Download,
  FilePlus2,
  Filter,
  GraduationCap,
  Layers,
  Layout,
  Play,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

interface ReportTrainingModalProps {
  open: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onStartBlank: () => void;
  onStartGuidedStarter: () => void;
}

type TrainingTabId = 'usar' | 'do_zero' | 'dicionario';

export const GUIDED_STARTER_SQL = `SELECT
  c.id AS codigo,
  c.full_name AS cliente,
  c.city AS cidade,
  c.state AS uf,
  c.status AS situacao,
  COUNT(a.id) AS qtd_contratos,
  ROUND(COALESCE(SUM(a.debt_amount_cents), 0) / 100.0, 2) AS passivo_total
FROM clients c
LEFT JOIN admissions a ON a.client_id = c.id
WHERE (NULLIF({{uf}}, '') IS NULL OR UPPER(c.state) = UPPER({{uf}}))
GROUP BY c.id, c.full_name, c.city, c.state, c.status
ORDER BY passivo_total DESC, c.full_name ASC`;

const TABLE_CHEATSHEET = [
  {
    table: 'clients',
    desc: 'Cadastro mestre de clientes',
    cols: 'id, full_name, cpf_cnpj, phone, city, state (UF), status (ativo/suspenso/cancelado)',
  },
  {
    table: 'admissions',
    desc: 'Contratos e admissões bancárias',
    cols: 'protocol_code, client_id, bank_name, modality, status, debt_amount_cents, service_fee_cents',
  },
  {
    table: 'financial_titles',
    desc: 'Contas a Receber e a Pagar',
    cols: 'scope (RECEBER/PAGAR), client_id, status, due_date, original_value_cents, current_balance_cents',
  },
  {
    table: 'negotiations',
    desc: 'Mesa de negociações e acordos',
    cols: 'client_id, bank_name, status, original_debt_cents, closed_value_cents, estimated_savings_cents',
  },
  {
    table: 'legal_processes',
    desc: 'Monitoramento jurídico Escavador',
    cols: 'client_id, process_number, court_name, action_type, status, has_search_seizure, vehicle_seized',
  },
  {
    table: 'collection_cases',
    desc: 'Carteira de cobrança ativa',
    cols: 'client_id, title_id, assigned_collector_id, state_code, priority_value_cents, status',
  },
];

const STEPS_FROM_ZERO = [
  {
    step: '01',
    title: 'Criar Novo Modelo',
    icon: FilePlus2,
    summary:
      'Na Biblioteca à esquerda, clique em "+ Novo" (ou use "Iniciar Novo Relatório Guiado" abaixo) para abrir um rascunho limpo.',
    tip: 'Defina já se o relatório exibirá Dados + Gráficos (both) na aba Layout.',
  },
  {
    step: '02',
    title: 'Fonte de Dados (SQL ou Construtor Visual)',
    icon: Database,
    summary:
      'Use o Editor SQL para consultas customizadas ou alterne para o Construtor Visual, marque tabelas, clique em "Sugerir JOINs via FK" e clique em "Testar SQL".',
    tip: 'Valores financeiros ficam em centavos (*_cents): divida por 100.0 com ROUND(campo / 100.0, 2).',
  },
  {
    step: '03',
    title: 'Layout, Colunas e Totais',
    icon: Layout,
    summary:
      'Na aba Layout, clique em "Sincronizar Colunas do Preview". Renomeie rótulos, marque formato Moeda BRL / Data / CPF-CNPJ e ative agrupamento ou total geral no rodapé.',
    tip: 'Para tabelas largas com muitas colunas, selecione orientação Paisagem (A4).',
  },
  {
    step: '04',
    title: 'Povoar a Parte Gráfica',
    icon: BarChart3,
    summary:
      'Na aba Gráficos, clique em "+ Adicionar", escolha Barra, Pizza/Donut, Linha ou Misto (Barra+Linha). Defina Eixo X (categoria) e séries Y (Soma, Contagem ou Valor direto).',
    tip: 'Use Largura = 50% e Posição = Antes para exibir dois gráficos lado a lado no topo do relatório.',
  },
  {
    step: '05',
    title: 'Filtros e Sub-relatórios',
    icon: Filter,
    summary:
      'Vincule cada {{variavel}} do WHERE na aba Filtros para permitir filtragem pelo usuário sem alterar SQL. Adicione sub-relatórios do tipo Resumo para consolidar por status ou UF.',
    tip: "Prefira WHERE (NULLIF({{param}}, '') IS NULL OR coluna = {{param}}) para que filtros vazios tragam tudo.",
  },
  {
    step: '06',
    title: 'Preview, Permissões (ACL) e Salvar',
    icon: ShieldCheck,
    summary:
      'Clique em "Preview / Exportar" no topo para conferir dados reais, gráficos e paginação. Depois clique em "Salvar", informe Nome/Categoria e escolha os grupos autorizados.',
    tip: 'Use "Duplicar" para criar variações departamentais a partir de um relatório já pronto.',
  },
];

export const ReportTrainingModal: React.FC<ReportTrainingModalProps> = ({
  open,
  isAdmin,
  onClose,
  onStartBlank,
  onStartGuidedStarter,
}) => {
  const [tab, setTab] = useState<TrainingTabId>('do_zero');
  const [copiedSql, setCopiedSql] = useState(false);

  if (!open) return null;

  const handleCopyStarter = async () => {
    try {
      await navigator.clipboard.writeText(GUIDED_STARTER_SQL);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 2000);
    } catch {
      // Fallback ignored silently if clipboard is restricted in iframe
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-blue-600 text-white shrink-0">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Treinamento · Relatórios Gerais e Criação do Zero
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Orientação prática de como consultar, filtrar, montar gráficos e construir novos modelos em SQL ou Construtor Visual.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar treinamento"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-6 py-2.5">
          <button
            type="button"
            onClick={() => setTab('do_zero')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'do_zero'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Montar Relatório do Zero (6 Etapas)
          </button>
          <button
            type="button"
            onClick={() => setTab('usar')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'usar'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Como Utilizar e Exportar
          </button>
          <button
            type="button"
            onClick={() => setTab('dicionario')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'dicionario'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            Dicionário SQL &amp; Receita Inicial
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {tab === 'do_zero' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs text-blue-900 flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Fluxo recomendado:</strong> primeiro valide a consulta SQL com{' '}
                  <strong>Testar SQL</strong> para extrair os nomes exatos das colunas, depois configure{' '}
                  <strong>Layout</strong>, <strong>Gráficos</strong>, <strong>Filtros</strong> e{' '}
                  <strong>Sub-relatórios</strong> antes de salvar.
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {STEPS_FROM_ZERO.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.step}
                      className="rounded-xl border border-slate-200 bg-white p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-[11px] font-bold text-white tabular-nums">
                            {item.step}
                          </span>
                          <h3 className="text-xs font-bold text-slate-900">{item.title}</h3>
                        </div>
                        <Icon className="w-4 h-4 text-blue-600 shrink-0" />
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{item.summary}</p>
                      <div className="rounded-lg bg-slate-50 border border-slate-200/80 px-2.5 py-1.5 text-[11px] text-slate-600">
                        <strong className="text-slate-800">Dica:</strong> {item.tip}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'usar' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <Database className="w-4 h-4 text-blue-600" />
                    1. Selecionar Modelo na Biblioteca
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Use a barra lateral esquerda organizada por categoria (<strong>Comercial</strong>,{' '}
                    <strong>Financeiro</strong>, <strong>Jurídico</strong>, <strong>Negociação</strong>,{' '}
                    <strong>Cadastrais</strong> e <strong>Cobrança</strong>) ou digite na busca rápida para abrir qualquer relatório autorizado.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <Filter className="w-4 h-4 text-blue-600" />
                    2. Filtrar e Atualizar Dados
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Preencha um ou mais filtros disponíveis acima do relatório (por exemplo: <em>Status</em>,{' '}
                    <em>UF</em>, <em>Banco</em> ou <em>Cliente</em>) e clique em <strong>Aplicar Filtros</strong>.
                    Deixe em <strong>Todos</strong> para visualizar a carteira completa e use{' '}
                    <strong>Limpar Filtros</strong> para restaurar.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <BarChart3 className="w-4 h-4 text-blue-600" />
                    3. Ler Gráficos, Subtotais e Resumos
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Os gráficos interativos no topo reagem instantaneamente aos filtros aplicados. Passe o mouse sobre barras, fatias ou linhas para ler valores exatos em R$ ou quantidades. Logo abaixo aparecem a grade paginada e os quadros de <strong>Sub-relatórios</strong> consolidados.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <Download className="w-4 h-4 text-blue-600" />
                    4. Imprimir e Exportar em 6 Formatos
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Na barra superior do relatório, escolha <strong>Imprimir</strong> (visualização A4 pronta para impressão), <strong>PDF</strong> (inclui gráficos + tabela), <strong>Excel (.xlsx)</strong>, <strong>Word (.doc)</strong>, <strong>CSV</strong> ou <strong>HTML</strong> independente.
                  </p>
                </div>
              </div>
            </div>
          )}

          {tab === 'dicionario' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700 mb-2">
                  Principais Tabelas e Campos para Consultas
                </h3>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-900 text-white text-[11px] uppercase">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Tabela</th>
                        <th className="px-3 py-2 font-semibold">Finalidade</th>
                        <th className="px-3 py-2 font-semibold">Colunas-chave</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {TABLE_CHEATSHEET.map((t) => (
                        <tr key={t.table} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono font-semibold text-blue-700 whitespace-nowrap">
                            {t.table}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{t.desc}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{t.cols}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      Receita SQL Inicial Pronta (Clientes + Passivo por UF)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Já utiliza conversão de centavos, JOIN seguro com LEFT JOIN e filtro opcional{' '}
                      <code className="font-mono text-slate-700">{'{{uf}}'}</code>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyStarter()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {copiedSql ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        SQL Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copiar SQL
                      </>
                    )}
                  </button>
                </div>
                <pre className="rounded-lg bg-slate-900 text-slate-100 p-3 text-[11px] font-mono overflow-x-auto leading-relaxed">
                  {GUIDED_STARTER_SQL}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <div className="text-[11px] text-slate-500">
            {isAdmin
              ? 'Como Administrador, você pode criar e editar relatórios diretamente pelo construtor.'
              : 'Dúvidas de acesso ou novos modelos podem ser solicitadas ao administrador.'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartBlank();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <FilePlus2 className="w-3.5 h-3.5" />
                  Novo em Branco
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartGuidedStarter();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Play className="w-3.5 h-3.5" />
                  Iniciar Novo Relatório Guiado
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
