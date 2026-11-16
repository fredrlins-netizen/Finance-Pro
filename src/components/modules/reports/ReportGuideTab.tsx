import React, { useMemo, useState } from 'react';
import { BookOpen, Copy, Search } from 'lucide-react';
import { GUIDE_SECTIONS } from '../../../lib/reportCatalogs.ts';

interface GuideArticle {
  id: (typeof GUIDE_SECTIONS)[number]['id'];
  title: string;
  body: string[];
  codeSnippet?: string;
}

const GUIDE_ARTICLES: GuideArticle[] = [
  {
    id: 'visao_geral',
    title: 'Visão Geral do Módulo Relatórios Gerais',
    body: [
      'O módulo Relatórios Gerais permite construir, salvar e distribuir relatórios corporativos com consultas SQL parametrizadas, gráficos interativos, agrupamentos visuais, subtotais, sub-relatórios e exportação multi-formato.',
      'Administradores têm acesso ao editor completo e ao controle de acesso (ACL) por usuários ou grupos. Usuários operacionais visualizam apenas os relatórios autorizados para seu perfil.',
    ],
  },
  {
    id: 'fonte_dados',
    title: 'Fonte de Dados: Construtor Visual vs Editor SQL',
    body: [
      'No Construtor Visual, navegue pelo Schema Explorer (schema public), marque tabelas e colunas, clique em "Sugerir via FK" para gerar JOINs automáticos pelas chaves estrangeiras reais do PostgreSQL e adicione cláusulas WHERE, GROUP BY e ORDER BY.',
      'No Editor SQL, escreva qualquer consulta SELECT ou CTE (WITH ... SELECT). Apenas consultas de leitura são aceitas pelo validador de segurança no servidor.',
    ],
    codeSnippet: `SELECT c.full_name AS cliente, a.status, ROUND(a.debt_amount_cents / 100.0, 2) AS divida_reais\nFROM admissions a\nJOIN clients c ON c.id = a.client_id\nWHERE NULLIF({{status}}, '') IS NULL OR a.status = {{status}}`,
  },
  {
    id: 'layout',
    title: 'Layout, Colunas, Agrupamento e Totalizadores',
    body: [
      'Configure papel (A4, Carta ou Ofício), orientação (Retrato ou Paisagem), margens, fonte, zebrado, cabeçalho com logo (URL ou Upload Base64) e rodapé.',
      'Na seção de Agrupamento Visual, escolha um ou mais campos e defina o Template de Cabeçalho usando {{grupo}} (ex: "Unidade: {{grupo}}"). Ative "Exibir linha de subtotal" para totalizar grupos individualmente.',
    ],
  },
  {
    id: 'graficos',
    title: 'Gráficos Interativos e Séries Mistas',
    body: [
      'Crie gráficos de Barra (Vertical, Horizontal ou Empilhado), Pizza ou Rosca, Linhas ou Área, e Misto (Barra + Linha com eixo secundário).',
      'Defina a posição em relação à tabela (Antes, Entre ou Depois) e ative "Rótulos" para exibir os valores diretamente sobre barras, linhas e fatias.',
    ],
  },
  {
    id: 'subreports',
    title: 'Sub-relatórios (Resumo e SQL Próprio)',
    body: [
      'Sub-relatórios do tipo Resumo agregam os dados já retornados pela consulta principal por um campo agrupador (ex: somar honorários por unidade).',
      'Sub-relatórios do tipo Consulta SQL executam uma query independente no servidor usando os mesmos filtros informados pelo usuário.',
    ],
  },
  {
    id: 'preview',
    title: 'Preview Paginado e Exportações (PDF, Excel, Word, CSV, HTML)',
    body: [
      'No modo Preview, os filtros são exibidos no topo. A execução no servidor impõe limite de segurança de 500 linhas por consulta.',
      'Exporte para PDF (com gráficos em alta resolução e paginação), Excel (.xlsx multi-aba com gráficos e sub-relatórios), Word (.doc), CSV (com proteção contra formula injection) ou HTML standalone, além de impressão via janela A4 integrada.',
    ],
  },
  {
    id: 'modelos',
    title: 'Modelos Pré-Configurados e Controle de Acesso (ACL)',
    body: [
      'O sistema inclui 6 modelos corporativos pré-carregados (Admissões por Status, Títulos Financeiros, Processos Jurídicos, Negociações Bancárias, Casos de Cobrança e Base de Clientes).',
      'Ao salvar, administradores podem restringir um modelo a usuários específicos e/ou grupos. Quando ambos ficam vazios, todos os usuários com permissão no módulo visualizam o relatório.',
    ],
  },
  {
    id: 'tabelas',
    title: 'Principais Tabelas do Banco FinancePro (PostgreSQL)',
    body: [
      '• admissions (dossiês, debt_amount_cents, service_fee_cents, status, client_id, unit_id)',
      '• clients (clientes, full_name, cpf_cnpj, phone, email, city, state, unit_id)',
      '• financial_titles (contas a receber/pagar, scope, status, amount_cents, current_balance_cents, due_date)',
      '• legal_processes (processos Escavador, process_number, court_name, status, client_id)',
      '• negotiations (redução bancária, original_debt_cents, closed_value_cents, estimated_savings_cents, status)',
      '• collection_cases (casos de cobrança, status, priority_value_cents, assigned_collector_id)',
      '• units (unidades regionais, code, name, city, state) e users (colaboradores)',
    ],
  },
  {
    id: 'sql_ref',
    title: 'Referência SQL para Filtros Opcionais no PostgreSQL',
    body: [
      'IMPORTANTE: No FinancePro, parâmetros de filtro não preenchidos são enviados como string vazia (""). Use NULLIF({{meu_filtro}}, \'\') IS NULL para evitar erros de cast em datas ou números.',
    ],
    codeSnippet: `WHERE (NULLIF({{data_inicio}}, '') IS NULL OR ft.due_date >= NULLIF({{data_inicio}}, '')::date)\n  AND (NULLIF({{status}}, '') IS NULL OR ft.status = {{status}})\n  AND (NULLIF({{busca}}, '') IS NULL OR c.full_name ILIKE '%' || {{busca}} || '%')`,
  },
  {
    id: 'dicas',
    title: 'Dicas e Soluções Rápidas',
    body: [
      '• Valores monetários nas tabelas do FinancePro são armazenados em centavos (*_cents). Divida por 100.0 na query SQL antes de aplicar a formatação "Moeda BRL".',
      '• Se alterar a estrutura de colunas na query, abra a aba Layout e clique em "Sincronizar Colunas do Preview".',
      '• Usuários não administradores executam apenas consultas salvas no servidor (nunca SQL arbitrário enviado pelo navegador).',
    ],
  },
];

interface ReportGuideTabProps {
  onApplySnippet?: (sql: string) => void;
}

export const ReportGuideTab: React.FC<ReportGuideTabProps> = ({ onApplySnippet }) => {
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string>('');

  const filteredArticles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return GUIDE_ARTICLES.filter((art) => {
      if (activeSection !== 'all' && art.id !== activeSection) return false;
      if (!q) return true;
      return (
        art.title.toLowerCase().includes(q) ||
        art.body.some((p) => p.toLowerCase().includes(q)) ||
        (art.codeSnippet || '').toLowerCase().includes(q)
      );
    });
  }, [search, activeSection]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div className="lg:col-span-3 rounded-xl border border-slate-200 bg-white p-3 space-y-2 h-fit">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
          <BookOpen className="w-4 h-4 text-blue-600" />
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-800">
            Tópicos do Guia
          </h4>
        </div>
        <button
          type="button"
          onClick={() => setActiveSection('all')}
          className={`w-full text-left rounded-lg px-2.5 py-1.5 text-xs font-medium ${
            activeSection === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Todos os Tópicos ({GUIDE_ARTICLES.length})
        </button>
        {GUIDE_SECTIONS.map((sec) => (
          <button
            key={sec.id}
            type="button"
            onClick={() => setActiveSection(sec.id)}
            className={`w-full text-left rounded-lg px-2.5 py-1.5 text-xs font-medium ${
              activeSection === sec.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {sec.label}
          </button>
        ))}
      </div>

      <div className="lg:col-span-9 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar no guia (ex: NULLIF, centavos, PDF, grouping, ACL)..."
            className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {filteredArticles.map((art) => (
          <div key={art.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
            <h5 className="text-sm font-bold text-slate-900">{art.title}</h5>
            {art.body.map((p, idx) => (
              <p key={idx} className="text-xs text-slate-600 leading-relaxed">
                {p}
              </p>
            ))}
            {art.codeSnippet && (
              <div className="rounded-lg bg-slate-950 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Exemplo SQL PostgreSQL
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(art.codeSnippet || '');
                        setCopiedId(art.id);
                        window.setTimeout(() => setCopiedId(''), 2000);
                      }}
                      className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-700"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedId === art.id ? 'Copiado!' : 'Copiar'}
                    </button>
                    {onApplySnippet && (
                      <button
                        type="button"
                        onClick={() => onApplySnippet(art.codeSnippet!)}
                        className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-blue-500"
                      >
                        Usar no Editor SQL
                      </button>
                    )}
                  </div>
                </div>
                <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap">
                  {art.codeSnippet}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
