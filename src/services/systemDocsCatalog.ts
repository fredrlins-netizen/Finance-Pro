import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  iviKnowledgeArticles,
  SystemDocFieldDef,
  SystemDocIntegrationDef,
  SystemDocTrainingStep,
  systemModuleDocs,
  systemSettings,
} from '../db/schema.ts';

export interface SystemDocSeedItem {
  moduleKey: string;
  title: string;
  menuGroup: string;
  menuPath: string;
  sortOrder: number;
  summary: string;
  objective: string;
  screenshotUrl: string;
  fieldsJson: SystemDocFieldDef[];
  integrationsJson: SystemDocIntegrationDef;
  trainingStepsJson: SystemDocTrainingStep[];
}

export const SYSTEM_DOCS_CATALOG: SystemDocSeedItem[] = [
  {
    moduleKey: 'diagrama_integracao',
    title: 'Diagrama Geral de Integração do Sistema',
    menuGroup: '0. Abertura & Diagrama Geral',
    menuPath: 'Sala de Aula Invicta > Mapa Completo do Sistema',
    sortOrder: 0,
    summary:
      'Apresentação inicial da instrutora Ivi com a camisa oficial da Invicta, detalhando no quadro da sala de aula como todas as telas e setores do sistema se conectam ponta a ponta antes de entrar em cada tela individual.',
    objective:
      'Dar ao colaborador a visão completa do fluxo operacional da Invicta Assessoria — da entrada segura e prospecção até jurídico, negociação, financeiro, governança e nuvem.',
    screenshotUrl: '/assets/module-docs/diagrama.png',
    fieldsJson: [
      {
        fieldName: 'boasVindasInvicta',
        fieldLabel: 'Apresentação da Ivi & Visão Panorâmica',
        fieldType: 'Apresentação',
        required: false,
        description:
          'Eu sou a Ivi, instrutora oficial da Invicta Assessoria Financeira! Aqui na nossa sala de aula vamos enxergar como cada botão e tela conversa entre si para ninguém trabalhar no escuro.',
        originModule: 'Sala de Aula Invicta (Início do Treinamento)',
        destinationModule: 'Todas as 20 telas operacionais em sequência',
      },
      {
        fieldName: 'entradaSeguranca',
        fieldLabel: 'Portal de Acesso, Home & Visão Executiva',
        fieldType: 'Bloco de Entrada',
        required: false,
        description:
          'Mostra como a jornada começa pelo Acesso Corporativo com dupla verificação LGPD, passa pela Home institucional e pelos painéis executivos e gerenciais.',
        originModule: 'Acesso Corporativo & Dupla Verificação (LGPD)',
        destinationModule: 'Home Corporativa, Visão Executiva e Dashboard Gerencial',
      },
      {
        fieldName: 'captacaoComercial',
        fieldLabel: 'Captação: Prospecção, Agendamentos & Admissão',
        fieldType: 'Fluxo Comercial',
        required: false,
        description:
          'Explica o caminho do cliente desde o primeiro atendimento na Prospecção, passando pelo registro na agenda em Agendamentos, até a montagem completa do dossiê na Admissão com apoio de Cadastros Comuns.',
        originModule: 'Prospecção & Atendimento e Cadastros Comuns',
        destinationModule: 'Agendamentos e Admissão & Dossiê',
      },
      {
        fieldName: 'operacaoJuridica',
        fieldLabel: 'Operação: Auditoria, Jurídico, Negociações & Alertas',
        fieldType: 'Fluxo Operacional',
        required: false,
        description:
          'Detalha a conferência documental na Auditoria & Boletos, a abertura de processos no Jurídico & Escavador, as tratativas de acordo em Negociações Bancárias e os avisos vermelhos na Mensageria Interna.',
        originModule: 'Admissão & Dossiê',
        destinationModule: 'Auditoria & Boletos, Jurídico & Escavador, Negociações Bancárias e Mensageria Interna',
      },
      {
        fieldName: 'receitaGovernanca',
        fieldLabel: 'Receita & Base: Financeiro, Cobrança, Governança & Nuvem',
        fieldType: 'Fechamento & Governança',
        required: false,
        description:
          'Fecha o mapa mostrando a gestão de títulos em Administração Financeira, a régua em Cobrança & Ranking, Formulários, Relatórios Gerais e toda a governança em Configurações, Backup no Drive e esta Academia da Ivi.',
        originModule: 'Auditoria & Boletos e Negociações Bancárias',
        destinationModule: 'Administração Financeira, Cobrança & Ranking, Governança & Configurações e Backup & Restore (Google Drive)',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'login', label: 'Acesso Corporativo (LGPD)', description: 'Porta de entrada segura que autentica o operador e inicia o ciclo diário.' },
      ],
      outputsTo: [
        { moduleKey: 'login', label: 'Acesso Corporativo & Dupla Verificação', description: 'Primeira tela prática analisada campo a campo logo após o diagrama.' },
        { moduleKey: 'prospection', label: 'Prospecção & Atendimento', description: 'Origem comercial do relacionamento com o cliente.' },
        { moduleKey: 'finance', label: 'Administração Financeira', description: 'Consolidação financeira e baixas bancárias do fluxo completo.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Apresentação da Ivi & Visão Panorâmica',
        fieldLabel: 'Apresentação da Ivi & Visão Panorâmica',
        scriptText:
          'Olá! Eu sou a Ivi, sua instrutora aqui na sala de aula da Invicta Assessoria Financeira, vestindo nossa camisa oficial da Invicta! Antes de irmos tela a tela, olhe no quadro o mapa completo do sistema: aqui cada área alimenta a próxima de forma organizada e rastreável.',
        fromX: 160,
        fromY: 170,
        toX: 545,
        toY: 175,
        boxW: 990,
        boxH: 270,
        relatedModule: 'login',
      },
      {
        stepOrder: 2,
        title: 'Entrada, Home & Painéis de Gestão',
        fieldLabel: 'Portal de Acesso, Home & Visão Executiva',
        scriptText:
          'Tudo começa pela entrada segura com dupla verificação LGPD, passando pela Home limpa para privacidade e pelos painéis Visão Executiva e Dashboard Gerencial que resumem os números em tempo real.',
        fromX: 520,
        fromY: 220,
        toX: 625,
        toY: 291,
        boxW: 245,
        boxH: 64,
        relatedModule: 'login',
      },
      {
        stepOrder: 3,
        title: 'Fluxo Comercial: Prospecção, Agenda & Admissão',
        fieldLabel: 'Captação: Prospecção, Agendamentos & Admissão',
        scriptText:
          'Aqui em cima no diagrama você vê a linha comercial: o cliente entra por Prospecção & Atendimento, ganha horário em Agendamentos e tem o dossiê fechado em Admissão & Dossiê usando dados padronizados de Cadastros Comuns.',
        fromX: 140,
        fromY: 195,
        toX: 330,
        toY: 68,
        boxW: 590,
        boxH: 76,
        relatedModule: 'prospection',
      },
      {
        stepOrder: 4,
        title: 'Operação: Auditoria, Jurídico, Negociações & Alertas',
        fieldLabel: 'Operação: Auditoria, Jurídico, Negociações & Alertas',
        scriptText:
          'Quando o dossiê avança, ele entra em Auditoria & Boletos para validação, dispara processos no Jurídico & Escavador, segue para acordos em Negociações Bancárias e acende alertas automáticos na Mensageria Interna.',
        fromX: 300,
        fromY: 100,
        toX: 645,
        toY: 145,
        boxW: 620,
        boxH: 135,
        relatedModule: 'audit',
      },
      {
        stepOrder: 5,
        title: 'Receita, Governança, Backup & Próxima Tela',
        fieldLabel: 'Receita & Base: Financeiro, Cobrança, Governança & Nuvem',
        scriptText:
          'Por fim, Administração Financeira e Cobrança & Ranking cuidam dos recebimentos, enquanto Governança & Configurações e Backup & Restore protegem tudo na nuvem. Agora vamos mergulhar tela a tela começando pelo Acesso Corporativo!',
        fromX: 700,
        fromY: 120,
        toX: 920,
        toY: 190,
        boxW: 320,
        boxH: 190,
        relatedModule: 'finance',
      },
    ],
  },
  {
    moduleKey: 'login',
    title: 'Acesso Corporativo & Dupla Verificação (LGPD)',
    menuGroup: 'Segurança & Entrada',
    menuPath: 'Portal Inicial > Login',
    sortOrder: 1,
    summary:
      'Tela de autenticação corporativa com bloqueio automático após tentativas inválidas, CAPTCHA matemático + visual, e-mail de redefinição e desconexão automática após 3 horas sem interação (LGPD).',
    objective:
      'Garantir que apenas usuários ativos, autenticados e dentro da janela de horário permitida acessem os dados dos clientes e unidades.',
    screenshotUrl: '/assets/module-docs/login.png',
    fieldsJson: [
      {
        fieldName: 'email',
        fieldLabel: 'E-mail cadastrado',
        fieldType: 'E-mail',
        required: true,
        description: 'Identificador único corporativo do colaborador ou administrador.',
        originModule: 'Governança > Usuários',
        destinationModule: 'Validação de Sessão Corporativa & Auditoria Geral',
      },
      {
        fieldName: 'password',
        fieldLabel: 'Senha corporativa',
        fieldType: 'Senha',
        required: true,
        description: 'Credencial protegida por criptografia no banco da empresa; bloqueia o usuário após 3 falhas consecutivas até reabilitação pelo administrador.',
        originModule: 'Governança > Usuários (Criação ou Redefinição de Senha)',
        destinationModule: 'Validação de Acesso & Auditoria Geral',
      },
      {
        fieldName: 'mathCaptchaAnswer',
        fieldLabel: '1º Desafio Matemático',
        fieldType: 'Número',
        required: true,
        description: 'Conta matemática simples gerada na tela de entrada para evitar acessos automáticos.',
        originModule: 'Tela de Acesso Corporativo (Gerador de Desafios)',
        destinationModule: 'Tela de Acesso Corporativo (Botão Entrar)',
      },
      {
        fieldName: 'visualSelectedIds',
        fieldLabel: '2º Desafio Visual (Cartões de Categoria)',
        fieldType: 'Seleção Visual',
        required: true,
        description: 'Seleção visual dos cartões pertencentes à categoria solicitada (como Banco/Boleto, Veículo ou Documento) contra acessos automatizados.',
        originModule: 'Tela de Acesso Corporativo (Gerador de Desafios)',
        destinationModule: 'Tela de Acesso Corporativo (Botão Entrar)',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'config', label: 'Governança & Usuários', description: 'Recebe credenciais, perfis, quadro de horários e cores do Portal & Identidade.' },
      ],
      outputsTo: [
        { moduleKey: 'home', label: 'Home Corporativa', description: 'Libera acesso autenticado ao portal com desconexão automática após 3 horas sem uso.' },
        { moduleKey: 'config', label: 'Auditoria & Segurança', description: 'Registra falhas, bloqueios automáticos e histórico de acessos na Auditoria Geral.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'E-mail e Senha Corporativa',
        fieldLabel: 'E-mail cadastrado & Senha',
        scriptText:
          'Comece preenchendo seu e-mail corporativo e senha definidos pelo administrador em Governança. Por segurança LGPD, 3 erros seguidos suspendem temporariamente o acesso até reabilitação.',
        fromX: 460,
        fromY: 270,
        toX: 480,
        toY: 465,
        boxW: 520,
        boxH: 85,
        relatedModule: 'config',
      },
      {
        stepOrder: 2,
        title: '1º CAPTCHA Matemático',
        fieldLabel: '1° CAPTCHA Matemático',
        scriptText:
          'Resolva o desafio matemático simples no campo Resultado numérico. Ele garante em camada primária que a tentativa vem de um operador humano.',
        fromX: 420,
        fromY: 470,
        toX: 350,
        toY: 635,
        boxW: 390,
        boxH: 75,
      },
      {
        stepOrder: 3,
        title: '2º CAPTCHA Visual de Blocos',
        fieldLabel: 'CAPTCHA Visual',
        scriptText:
          'Leia o enunciado acima dos 6 cartões e clique em todos os ícones correspondentes (por exemplo, todos os blocos de BANCO / BOLETO). Se precisar trocar os desafios, clique em Atualizar.',
        fromX: 980,
        fromY: 500,
        toX: 720,
        toY: 825,
        boxW: 660,
        boxH: 105,
      },
    ],
  },
  {
    moduleKey: 'home',
    title: 'Home Corporativa (Tela Inicial Institucional)',
    menuGroup: 'Entrada & Atendimento',
    menuPath: 'Entrada & Atendimento > Home',
    sortOrder: 2,
    summary:
      'Tela limpa de boas-vindas ao acessar o sistema, exibindo exclusivamente o logotipo oficial da Invicta / FinancePro proporcional à área disponível, sem exposição desnecessária de dados em tela.',
    objective:
      'Respeitar a privacidade em ambiente compartilhado (LGPD), apresentando o portal institucional enquanto o operador escolhe o setor de trabalho ou é monitorado pelo controle de inatividade de 3 horas.',
    screenshotUrl: '/assets/module-docs/home.png',
    fieldsJson: [
      {
        fieldName: 'companyLogo',
        fieldLabel: 'Logotipo Institucional Proporcional',
        fieldType: 'Imagem',
        required: false,
        description: 'Logotipo salvo em Portal & Identidade, ajustado proporcionalmente ao espaço disponível sem expor informações sensíveis.',
        originModule: 'Governança > Portal & Identidade',
        destinationModule: 'Exibição institucional na Home',
      },
      {
        fieldName: 'unitSwitcher',
        fieldLabel: 'Seletor de Unidade Ativa (Cabeçalho)',
        fieldType: 'Seleção',
        required: true,
        description: 'Define qual das 7 filiais (Matriz, Salvador, Fortaleza, Maceió, João Pessoa, São Paulo, Natal) está selecionada no cabeçalho superior.',
        originModule: 'Governança > Unidades & Filiais',
        destinationModule: 'Filtro automático em todos os setores',
      },
      {
        fieldName: 'idleTimeoutMonitor',
        fieldLabel: 'Monitor de Inatividade (3 horas)',
        fieldType: 'Segurança',
        required: true,
        description: 'Desconecta o operador automaticamente após 3 horas sem interação de mouse, teclado, toque ou rolagem.',
        originModule: 'Tela de Acesso Corporativo (Sessão ativa)',
        destinationModule: 'Tela de Acesso Corporativo (Desconexão automática)',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'config', label: 'Portal & Identidade', description: 'Obtém logotipo, cores da barra superior e menu lateral.' },
      ],
      outputsTo: [
        { moduleKey: 'overview', label: 'Visão Executiva', description: 'Direciona para o painel consolidado de operações.' },
        { moduleKey: 'appointments', label: 'Agendamentos', description: 'Entrada rápida de atendimentos presenciais e remotos.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Identidade Limpa & LGPD na Home',
        fieldLabel: 'Logotipo Central Invicta',
        scriptText:
          'A Home exibe apenas o logotipo oficial da empresa, mantendo dados sigilosos ocultos até você acessar o módulo necessário. Lembre-se: após 3 horas sem interação, o sistema desconecta automaticamente por segurança.',
        fromX: 390,
        fromY: 160,
        toX: 820,
        toY: 450,
        boxW: 520,
        boxH: 390,
        relatedModule: 'config',
      },
      {
        stepOrder: 2,
        title: 'Menu Lateral & Barra Global',
        fieldLabel: 'Navegação, Busca Ctrl+K e Ivi',
        scriptText:
          'Pelo menu à esquerda você acessa todos os setores autorizados ao seu grupo. No topo direito ficam a Busca Global (Ctrl+K), o seletor de unidade, o botão Ajuda e o acesso rápido à Ivi.',
        fromX: 520,
        fromY: 180,
        toX: 130,
        toY: 320,
        boxW: 245,
        boxH: 520,
      },
    ],
  },
  {
    moduleKey: 'overview',
    title: 'Visão Executiva',
    menuGroup: 'Entrada & Atendimento',
    menuPath: 'Entrada & Atendimento > Visão Executiva',
    sortOrder: 3,
    summary:
      'Painel consolidado com os principais indicadores operacionais dos cards executivos (Leads em Atendimento, Fichas em Auditoria, Jurídico/Escavador, Negociações Bancárias) e gráfico financeiro histórico de 12 meses.',
    objective:
      'Dar leitura imediata do funil completo da empresa em um só olhar, permitindo navegar diretamente para os registros pendentes com um clique.',
    screenshotUrl: '/assets/module-docs/overview.png',
    fieldsJson: [
      {
        fieldName: 'unitScopeKpis',
        fieldLabel: 'Cartões Executivos (Comercial, Auditoria, Jurídico, Negociações)',
        fieldType: 'Painel de Indicadores',
        required: false,
        description: 'Contadores em tempo real de atendimentos ativos, fichas em conferência, processos sem leitura e negociações com bancos.',
        originModule: 'Prospecção, Admissão, Auditoria, Jurídico e Negociações Bancárias',
        destinationModule: 'Acesso direto às telas pendentes',
      },
      {
        fieldName: 'revenueChart12m',
        fieldLabel: 'Evolução Acumulativa 12 Meses',
        fieldType: 'Gráfico',
        required: false,
        description: 'Gráfico comparativo de entradas liquidadas e evolução da carteira ao longo dos últimos 12 meses.',
        originModule: 'Administração Financeira & Cobrança',
        destinationModule: 'Dashboard Gerencial & Relatórios Gerais',
      },
      {
        fieldName: 'quickModuleShortcuts',
        fieldLabel: 'Atalhos Operacionais & Alertas Recentes',
        fieldType: 'Lista',
        required: false,
        description: 'Lista os eventos prioritários (devoluções de auditoria, despachos recentes e tarefas em atraso).',
        originModule: 'Auditoria & Mensageria Interna',
        destinationModule: 'Telas de Auditoria, Jurídico e Negociações Bancárias',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'prospection', label: 'Prospecção', description: 'Fornece volume de leads em atendimento ou escalados.' },
        { moduleKey: 'audit', label: 'Auditoria', description: 'Fornece fichas pendentes, devolvidas e taxas de aprovação.' },
        { moduleKey: 'legal', label: 'Jurídico & Escavador', description: 'Exibe alertas de movimentação não lida e risco de apreensão.' },
        { moduleKey: 'negotiations', label: 'Negociações Bancárias', description: 'Consolida acordos em andamento e economia projetada.' },
      ],
      outputsTo: [
        { moduleKey: 'managerial_dashboard', label: 'Dashboard Gerencial', description: 'Aprofunda análises de carteira por UF, cobrador e Ivi IA.' },
        { moduleKey: 'audit', label: 'Auditoria & Boletos', description: 'Abre a fila de conferência diretamente pelo atalho.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Cards de Operação Executiva',
        fieldLabel: 'KPIs de Prospecção, Auditoria, Jurídico e Negociações',
        scriptText:
          'Na faixa superior estão os 4 pilares executivos operacionais. Note que cada cartão resume quantidades vivas da unidade selecionada sem expor saldos confidenciais desnecessariamente.',
        fromX: 520,
        fromY: 380,
        toX: 820,
        toY: 220,
        boxW: 1100,
        boxH: 150,
        relatedModule: 'audit',
      },
      {
        stepOrder: 2,
        title: 'Gráfico de Desempenho & Pendências',
        fieldLabel: 'Séries Históricas e Atalhos',
        scriptText:
          'Logo abaixo você acompanha a evolução mensal de performance e pode clicar diretamente sobre uma pendência para saltar ao setor responsável.',
        fromX: 480,
        fromY: 320,
        toX: 820,
        toY: 540,
        boxW: 1100,
        boxH: 310,
        relatedModule: 'managerial_dashboard',
      },
    ],
  },
  {
    moduleKey: 'managerial_dashboard',
    title: 'Dashboard Gerencial (Cobrança, Jurídico & Eficiência Ivi IA)',
    menuGroup: 'Entrada & Atendimento',
    menuPath: 'Entrada & Atendimento > Dashboard Gerencial',
    sortOrder: 4,
    summary:
      'Painel analítico estratégico com filtros de unidade e janela temporal, consolidando inadimplência, aging de títulos, ranking de recuperadores, timeline jurídica Escavador e métricas de economia de tokens/chamadas pela Ivi IA.',
    objective:
      'Dar aos gestores visão estatística profunda de receita recuperada, gargalos processuais e produtividade da automação inteligente.',
    screenshotUrl: '/assets/module-docs/managerial_dashboard.png',
    fieldsJson: [
      {
        fieldName: 'unitScope',
        fieldLabel: 'Escopo de Unidades (Unidade Ativa / Todas)',
        fieldType: 'Seleção',
        required: true,
        description: 'Alterna entre indicadores da unidade atual ou visão consolidada das 7 filiais.',
        originModule: 'Governança > Unidades',
        destinationModule: 'Gráficos e Cartões do Dashboard Gerencial',
      },
      {
        fieldName: 'periodDays',
        fieldLabel: 'Janela de Período (30d / 90d / 180d / 365d)',
        fieldType: 'Seleção',
        required: true,
        description: 'Define o intervalo de cálculo para gráficos de recuperação, movimentações e economia da Ivi.',
        originModule: 'Seleção do Gestor na Tela',
        destinationModule: 'Gráficos e Indicadores Gerenciais',
      },
      {
        fieldName: 'collectionAgingCharts',
        fieldLabel: 'Faixas de Atraso de Títulos & Ranking de Operadores',
        fieldType: 'Gráfico',
        required: false,
        description: 'Distribuição de títulos a receber por faixa de atraso e desempenho dos recuperadores.',
        originModule: 'Cobrança & Administração Financeira',
        destinationModule: 'Ações da Coordenação de Cobrança',
      },
      {
        fieldName: 'iviEfficiencyPanel',
        fieldLabel: 'Painel de Eficiência & Cache Ivi',
        fieldType: 'Gráfico',
        required: false,
        description: 'Mostra atendimentos e pareceres resolvidos com reaproveitamento inteligente para reduzir custos.',
        originModule: 'Histórico de Decisões e Áudios da Ivi',
        destinationModule: 'Gestão Base & Áudio (Governança)',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'collection', label: 'Cobrança & Ranking', description: 'Alimenta taxas de recuperação, aging e pontuação dos cobradores.' },
        { moduleKey: 'legal', label: 'Jurídico & Escavador', description: 'Informa contagem de buscas e apreensões e prazos críticos.' },
        { moduleKey: 'finance', label: 'Administração Financeira', description: 'Envia saldos em aberto, vencidos e baixados.' },
      ],
      outputsTo: [
        { moduleKey: 'reports', label: 'Relatórios Gerais', description: 'Permite extrair planilhas e PDFs detalhados dos mesmos indicadores.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Filtros Gerenciais de Unidade e Período',
        fieldLabel: 'Escopo e Janela Temporal',
        scriptText:
          'Antes de ler os números, escolha no topo se deseja analisar apenas a filial ativa ou todas as unidades e defina o período (30 a 365 dias).',
        fromX: 480,
        fromY: 270,
        toX: 880,
        toY: 165,
        boxW: 980,
        boxH: 85,
      },
      {
        stepOrder: 2,
        title: 'Carteiras de Cobrança, Jurídico e Ivi IA',
        fieldLabel: 'Blocos de Performance e Eficiência IA',
        scriptText:
          'Nas abas e cartões abaixo, acompanhe o aging da inadimplência, o termômetro de busca e apreensão do Escavador e quantas consultas a Ivi resolveu usando cache do banco de dados.',
        fromX: 460,
        fromY: 320,
        toX: 820,
        toY: 540,
        boxW: 1100,
        boxH: 380,
        relatedModule: 'collection',
      },
    ],
  },
  {
    moduleKey: 'appointments',
    title: 'Agendamentos & Fila de Consultores',
    menuGroup: 'Entrada & Atendimento',
    menuPath: 'Entrada & Atendimento > Agendamentos',
    sortOrder: 5,
    summary:
      'Grade completa de agendamentos comerciais (Presencial, Telefone e Vídeo Chamada) com distribuição automática em fila Round-Robin por unidade, bloqueios de horário, lista de espera e importação automática do resumo da Prospecção.',
    objective:
      'Organizar a agenda dos consultores com horários livres validados, garantindo que nenhum cliente fique sem atendimento e que o resumo da conversa prévia já chegue nas Observações.',
    screenshotUrl: '/assets/module-docs/appointments.png',
    fieldsJson: [
      {
        fieldName: 'clientName',
        fieldLabel: 'Nome do Cliente',
        fieldType: 'Texto',
        required: true,
        description: 'Nome completo do cliente agendado; pode vir preenchido da Prospecção ou da busca em Clientes.',
        originModule: 'Tela de Prospecção & Cadastros Comuns (Clientes)',
        destinationModule: 'Ficha de Admissão',
      },
      {
        fieldName: 'clientPhone',
        fieldLabel: 'Telefone / WhatsApp (+55)',
        fieldType: 'Telefone',
        required: true,
        description: 'Número de contato validado com código +55 para envio de confirmação automática pelo WhatsApp.',
        originModule: 'Prospecção ou Digitação na Agenda',
        destinationModule: 'Envio WhatsApp & Ficha de Admissão',
      },
      {
        fieldName: 'serviceId',
        fieldLabel: 'Serviço / Tipo de Atendimento',
        fieldType: 'Seleção',
        required: true,
        description: 'Serviço escolhido (como Análise Veicular ou Revisão Bancária) que determina a duração do horário na grade.',
        originModule: 'Agendamentos > Configurações da Agenda',
        destinationModule: 'Reserva Automática na Grade de Horários',
      },
      {
        fieldName: 'collaboratorId',
        fieldLabel: 'Consultor / Colaborador (Fila de Rodízio)',
        fieldType: 'Seleção',
        required: true,
        description: 'Consultor habilitado na fila da unidade; o sistema pula automaticamente quem estiver com bloqueio de horário ativo.',
        originModule: 'Cadastros Comuns (Colaboradores & Cargos)',
        destinationModule: 'Ficha de Admissão (Campo Consultor)',
      },
      {
        fieldName: 'modality',
        fieldLabel: 'Modalidade (Presencial / Telefone / Vídeo Chamada)',
        fieldType: 'Seleção',
        required: true,
        description: 'Formato de realização da reunião comercial.',
        originModule: 'Seleção do Atendente ou Ivi na Prospecção',
        destinationModule: 'Indicadores de Comparecimento',
      },
      {
        fieldName: 'scheduledFor',
        fieldLabel: 'Data & Horário do Agendamento',
        fieldType: 'Data e Hora',
        required: true,
        description: 'Data e hora exata dentro dos horários livres da agenda.',
        originModule: 'Grade Interativa de Agendamentos',
        destinationModule: 'Lembretes e Acompanhamento (Aguardando / Confirmado / Cumprido / Faltoso)',
      },
      {
        fieldName: 'notes',
        fieldLabel: 'Observações (Resumo da Conversa)',
        fieldType: 'Texto Longo',
        required: false,
        description: 'Campo alimentado automaticamente pelo Resumo da Conversa da Prospecção ou anotações do atendente.',
        originModule: 'Prospecção (Quadro Resumo da Conversa)',
        destinationModule: 'Consultor no Atendimento & Auditoria da Agenda',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'prospection', label: 'Prospecção', description: 'Envia lead, telefone, modalidade sugerida e resumo da conversa para Observações.' },
        { moduleKey: 'cadastros_comuns', label: 'Colaboradores & Clientes', description: 'Disponibiliza consultores participantes da fila de rodízio e clientes cadastrados.' },
      ],
      outputsTo: [
        { moduleKey: 'admission', label: 'Admissão & Dossiê', description: 'Converte o agendamento cumprido em Ficha de Admissão.' },
        { moduleKey: 'internal_messaging', label: 'Mensageria Interna (Ivi)', description: 'Dispara aviso automático com sino piscando ao atribuir/movimentar agenda.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Controles de Unidade, Grade e Bloqueios',
        fieldLabel: 'Barra Superior & Modos da Agenda',
        scriptText:
          'No cabeçalho de Agendamentos você alterna entre a Grade Diária/Semanal, Lista de Espera, Bloqueios de Horário e Configurações de Serviços. Também há a auditoria acumulativa deste setor.',
        fromX: 520,
        fromY: 280,
        toX: 820,
        toY: 165,
        boxW: 1100,
        boxH: 90,
      },
      {
        stepOrder: 2,
        title: 'Colunas da Grade e Rodízio de Consultores',
        fieldLabel: 'Grade por Consultor e Horário',
        scriptText:
          'Cada coluna representa um consultor ativo na unidade. Clique em qualquer horário livre para criar um agendamento — a fila Round-Robin indica o próximo consultor disponível.',
        fromX: 480,
        fromY: 320,
        toX: 820,
        toY: 480,
        boxW: 1100,
        boxH: 380,
        relatedModule: 'prospection',
      },
      {
        stepOrder: 3,
        title: 'Integração com Prospecção & Admissão',
        fieldLabel: 'Resumo nas Observações -> Ficha de Admissão',
        scriptText:
          'Quando o agendamento nasce na Prospecção, o resumo da Ivi já preenche o campo Observações automaticamente. Após marcar como Cumprido, o consultor abre a Admissão com os dados prontos.',
        fromX: 900,
        fromY: 580,
        toX: 1120,
        toY: 320,
        boxW: 360,
        boxH: 180,
        relatedModule: 'admission',
      },
    ],
  },
  {
    moduleKey: 'cadastros_comuns',
    title: 'Cadastros Comuns (Clientes, Bancos, Modalidades, Equipe & Séries)',
    menuGroup: 'Cadastros Comuns',
    menuPath: 'Entrada & Atendimento > Cadastros Comuns',
    sortOrder: 6,
    summary:
      'Repositório mestre de entidades compartilhadas: Clientes (Titular e Responsável pelo Bem), Cargos, Colaboradores, Departamentos, Bancos (catálogo FEBRABAN), Modalidades, Produtos e Séries/Numerações por unidade.',
    objective:
      'Centralizar os cadastros base que alimentam de forma padronizada a Admissão, Auditoria, Negociações Bancárias, Financeiro e Cobrança, evitando digitação duplicada.',
    screenshotUrl: '/assets/module-docs/cadastros_comuns.png',
    fieldsJson: [
      {
        fieldName: 'fullName',
        fieldLabel: 'Nome Completo / Razão Social',
        fieldType: 'Texto',
        required: true,
        description: 'Nome oficial do cliente titular, responsável pelo bem ou ambos.',
        originModule: 'Prospecção, Entrada Manual ou Importação Excel',
        destinationModule: 'Admissão, Jurídico, Negociações Bancárias, Financeiro e Cobrança',
      },
      {
        fieldName: 'cpfCnpj',
        fieldLabel: 'CPF / CNPJ',
        fieldType: 'Documento Fiscal',
        required: true,
        description: 'Documento fiscal único usado para emissão de boletos e consultas jurídicas.',
        originModule: 'Cadastros Comuns > Clientes',
        destinationModule: 'Auditoria (Boletos), Jurídico e Administração Financeira',
      },
      {
        fieldName: 'clientType',
        fieldLabel: 'Papel do Cliente (Titular / Responsável pelo Bem / Ambos)',
        fieldType: 'Seleção',
        required: true,
        description: 'Define se o cliente assina o contrato financeiro, conduz ou detém o veículo, ou cumpre ambos os papéis com vínculo automático.',
        originModule: 'Cadastros Comuns > Clientes',
        destinationModule: 'Admissão (Vínculo entre Titular e Responsável pelo Bem)',
      },
      {
        fieldName: 'whatsapp',
        fieldLabel: 'Telefone & WhatsApp (+55)',
        fieldType: 'Telefone',
        required: true,
        description: 'Canal principal utilizado pela Ivi na Régua de Cobrança, no WhatsApp fixo e no Jurídico.',
        originModule: 'Cadastros Comuns > Clientes & Prospecção',
        destinationModule: 'Régua de Cobrança, Jurídico, Cobrança & Barra WhatsApp',
      },
      {
        fieldName: 'banksCatalog',
        fieldLabel: 'Submenu Bancos (Lista Oficial, Serviços & Contatos)',
        fieldType: 'Catálogo',
        required: false,
        description: 'Armazena bancos credores, contatos da mesa negociadora e percentuais-alvo de negociação.',
        originModule: 'Cadastros Comuns > Bancos',
        destinationModule: 'Admissão & Negociações Bancárias',
      },
      {
        fieldName: 'modalitiesSeries',
        fieldLabel: 'Modalidades & Séries/Números',
        fieldType: 'Catálogo',
        required: false,
        description: 'Configura modalidades (como Veicular com bloco de veículo ativo) e séries de protocolo por unidade.',
        originModule: 'Cadastros Comuns > Modalidades & Séries/Números',
        destinationModule: 'Admissão (Geração de Protocolo & Bloco Veicular)',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'config', label: 'Importação Excel / Unidades', description: 'Permite carga em lote via modelos Excel e vínculo de filiais.' },
        { moduleKey: 'prospection', label: 'Prospecção', description: 'Envia contatos convertidos para formalização cadastral.' },
      ],
      outputsTo: [
        { moduleKey: 'admission', label: 'Admissão & Dossiê', description: 'Fornece cliente, responsável pelo bem, banco, modalidade, consultor e série.' },
        { moduleKey: 'negotiations', label: 'Negociações Bancárias', description: 'Fornece contatos dos bancos e serviços cadastrados.' },
        { moduleKey: 'appointments', label: 'Agendamentos', description: 'Fornece colaboradores habilitados na fila e clientes.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Menu de Submódulos de Cadastros Comuns',
        fieldLabel: 'Clientes, Cargos, Colaboradores, Bancos, Modalidades e Séries',
        scriptText:
          'Cadastros Comuns reúne 8 tabelas-mestre no menu lateral: Clientes, Cargos, Colaboradores, Departamentos, Bancos, Modalidades, Produtos e Séries/Números. Tudo o que você cadastra aqui alimenta o restante do sistema.',
        fromX: 350,
        fromY: 300,
        toX: 135,
        toY: 420,
        boxW: 240,
        boxH: 250,
        relatedModule: 'admission',
      },
      {
        stepOrder: 2,
        title: 'Listagem, Busca e Novo Cadastro de Clientes',
        fieldLabel: 'Tabela de Clientes + Vínculo Bidirecional + Auditoria',
        scriptText:
          'Na lista principal você busca por nome ou CPF/CNPJ, visualiza o status (Ativo/Suspenso/Cancelado) e abre o histórico de Auditoria acumulativa ou cria novos registros integrados.',
        fromX: 520,
        fromY: 260,
        toX: 820,
        toY: 380,
        boxW: 1100,
        boxH: 380,
      },
    ],
  },
  {
    moduleKey: 'prospection',
    title: 'Comercial -> Prospecção & Atendimento Omnichannel (Ivi IA + Voz)',
    menuGroup: 'Comercial',
    menuPath: 'Comercial > Prospecção & Agenda',
    sortOrder: 7,
    summary:
      'Central de captação omnichannel (WhatsApp UaZapi/GoTalk, Instagram, Facebook, E-mail e Telefone) com triagem inteligente da Ivi, transcrição e resposta por áudio Gemini TTS, chamadas diretas com gravação criptografada no BucketDaInvicta, resumo lateral e base de conhecimento própria.',
    objective:
      'Responder leads rapidamente com precisão comercial baseada na Base Ivi, transcrever áudios recebidos, gerar áudios de esclarecimento quando necessário e converter atendimentos qualificados em Agendamentos e Admissões.',
    screenshotUrl: '/assets/module-docs/prospection.png',
    fieldsJson: [
      {
        fieldName: 'leadQueue',
        fieldLabel: 'Fila de Atendimentos (Esquerda)',
        fieldType: 'Lista',
        required: true,
        description: 'Lista atendimentos filtrados por unidade, período, busca e estágio (Ivi, Escalado Humano, Agendado, Recuperado).',
        originModule: 'Canais Integrados (WhatsApp, Instagram, Facebook) ou Novo Atendimento',
        destinationModule: 'Conversa Central de Prospecção',
      },
      {
        fieldName: 'contactNameAndPhone',
        fieldLabel: 'Nome do Contato & WhatsApp (+55)',
        fieldType: 'Texto e Telefone',
        required: true,
        description: 'Se um contato entra pelo WhatsApp sem nome identificado, a Ivi alerta e abre a janela de Contato Básico para completar com código +55.',
        originModule: 'Recebimento WhatsApp & Janela Contato Básico',
        destinationModule: 'Tela de Agendamentos & Cadastros Comuns (Clientes)',
      },
      {
        fieldName: 'channelCalls',
        fieldLabel: 'Ligações (UaZapi / GoTalk) & Gravação Segura',
        fieldType: 'Ação',
        required: false,
        description: 'Inicia e encerra ligações diretas e permite gravar ou anexar o áudio para transcrição automática da Ivi.',
        originModule: 'Configurações de WhatsApp da Unidade',
        destinationModule: 'Cofre de Gravações da Empresa & Resumo da Conversa',
      },
      {
        fieldName: 'audioTranscriptionAndTts',
        fieldLabel: 'Áudio Ivi (Transcrição e Resposta Falada)',
        fieldType: 'Áudio',
        required: false,
        description: 'Transcreve áudios enviados pelo cliente e gera respostas faladas da Ivi guardadas no histórico para reutilização.',
        originModule: 'Microfone, Arquivo de Áudio & Base Ivi de Prospecção',
        destinationModule: 'Histórico do Atendimento, Cache de Áudios & Resumo',
      },
      {
        fieldName: 'summaryText',
        fieldLabel: 'Resumo da Conversa (Coluna Direita)',
        fieldType: 'Texto Longo',
        required: false,
        description: 'Síntese gerada pela Ivi (ou editada pelo operador após ligação telefônica) com autor e data/hora, transferida automaticamente para Observações em Agendamentos.',
        originModule: 'Histórico da Conversa, Transcrições & Operador',
        destinationModule: 'Agendamentos (Campo Observações)',
      },
      {
        fieldName: 'prospectionKnowledgeBase',
        fieldLabel: 'Aba Base Ivi (Gestão do Administrador)',
        fieldType: 'Base de Conhecimento',
        required: false,
        description: 'Regras e respostas que a Ivi utiliza com clientes; além do aprendizado automático, administradores podem incluir, editar, excluir e ouvir em áudio.',
        originModule: 'Administradores & Aprendizado dos Atendimentos',
        destinationModule: 'Respostas em Texto e Áudio da Ivi em Prospecção',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'config', label: 'Configurações WhatsApp & Ivi', description: 'Fornece instâncias UaZapi/GoTalk e cadeia de IA.' },
      ],
      outputsTo: [
        { moduleKey: 'appointments', label: 'Agendamentos', description: 'Cria agendamentos levando telefone +55 e o resumo automático para Observações.' },
        { moduleKey: 'admission', label: 'Admissão & Dossiê', description: 'Permite abrir ficha de admissão após qualificação do lead.' },
        { moduleKey: 'internal_messaging', label: 'Mensageria Interna (Ivi)', description: 'Sinaliza o setor quando um lead é escalado para atendimento humano.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Fila Omnichannel de Leads',
        fieldLabel: 'Fila Omnichannel (Coluna Esquerda)',
        scriptText:
          'À esquerda ficam todos os leads por canal e estágio. Leads marcados em âmbar como "escalado humano" já acionaram o alerta piscante do setor para intervenção do consultor.',
        fromX: 520,
        fromY: 360,
        toX: 410,
        toY: 470,
        boxW: 290,
        boxH: 430,
      },
      {
        stepOrder: 2,
        title: 'Chat, Ligações e Resposta em Áudio Gemini',
        fieldLabel: 'Timeline, Transcrição e Resposta Verbal Ivi',
        scriptText:
          'No centro estão as mensagens, ligações UaZapi/GoTalk e ferramentas de áudio. Quando o cliente envia áudio ou precisa de explicação clara, a Ivi transcreve e também pode responder em áudio Gemini salvo no cache de tokens.',
        fromX: 480,
        fromY: 300,
        toX: 815,
        toY: 500,
        boxW: 510,
        boxH: 470,
      },
      {
        stepOrder: 3,
        title: 'Resumo Lateral e Envio para Agendamentos',
        fieldLabel: 'Resumo da Conversa & Botão Agendar',
        scriptText:
          'Na coluna direita, a Ivi sintetiza a conversa com autor e data/hora. Ao clicar em Agendar no cabeçalho, esse resumo vai direto para o campo Observações na grade de Agendamentos.',
        fromX: 920,
        fromY: 420,
        toX: 1235,
        toY: 500,
        boxW: 290,
        boxH: 430,
        relatedModule: 'appointments',
      },
    ],
  },
  {
    moduleKey: 'admission',
    title: 'Comercial -> Admissão, Cenários & Dossiê Digital (BucketDaInvicta)',
    menuGroup: 'Comercial',
    menuPath: 'Comercial > Admissão & Dossiê',
    sortOrder: 8,
    summary:
      'Módulo central de formalização contratual do cliente: vincula Titular e Responsável pelo Bem, seleciona Banco/Modalidade/Série, calcula cenários comparativos de economia, anexa documentos criptografados no BucketDaInvicta (Cloudflare R2/Vault) e submete para Auditoria.',
    objective:
      'Estruturar dossiês completos, auditáveis e sem falhas documentais antes da geração dos boletos iniciais e início das tratativas jurídicas e bancárias.',
    screenshotUrl: '/assets/module-docs/admission.png',
    fieldsJson: [
      {
        fieldName: 'protocolCode',
        fieldLabel: 'Protocolo / Série',
        fieldType: 'Texto',
        required: true,
        description: 'Código sequencial automático gerado conforme a Série selecionada e a Unidade.',
        originModule: 'Cadastros Comuns (Séries/Números)',
        destinationModule: 'Auditoria, Jurídico, Negociações Bancárias e Financeiro',
      },
      {
        fieldName: 'clientId',
        fieldLabel: 'Cliente Titular & Responsável pelo Bem',
        fieldType: 'Seleção',
        required: true,
        description: 'Permite vincular o titular financeiro e o responsável pelo bem em relacionamento direto entre as fichas.',
        originModule: 'Cadastros Comuns (Clientes)',
        destinationModule: 'Auditoria & Jurídico (Acompanhamento de CPF)',
      },
      {
        fieldName: 'bankAndModality',
        fieldLabel: 'Banco Credor, Modalidade & Contrato',
        fieldType: 'Seleção e Texto',
        required: true,
        description: 'Identifica a instituição financeira, número do contrato e ativa os campos de Dados do Veículo quando a modalidade exige.',
        originModule: 'Cadastros Comuns (Bancos & Modalidades)',
        destinationModule: 'Negociações Bancárias & Auditoria',
      },
      {
        fieldName: 'vehicleSection',
        fieldLabel: 'Dados do Veículo (Marca, Modelo, Placa, Chassi, RENAVAM, Elétrico)',
        fieldType: 'Grupo de Campos',
        required: false,
        description: 'Bloco exibido em contratos veiculares para proteção contra busca e apreensão.',
        originModule: 'Ficha de Admissão ou Documento do Veículo',
        destinationModule: 'Jurídico (Monitoramento e Alertas Preventivos)',
      },
      {
        fieldName: 'serviceAndDebtValues',
        fieldLabel: 'Valores da Dívida, Taxa de Serviço, Descontos, Acréscimos & Parcelamento',
        fieldType: 'Valores Financeiros',
        required: true,
        description: 'Define valor financiado, parcelas pagas/atrasadas, saldo devedor e composição dos honorários de assessoria.',
        originModule: 'Cálculo Comercial & Cenários Comparativos',
        destinationModule: 'Auditoria (2 Boletos Iniciais) & Administração Financeira (Demais Títulos)',
      },
      {
        fieldName: 'dossierDocuments',
        fieldLabel: 'Dossiê Digital (Arquivos do Cliente)',
        fieldType: 'Anexo Digital',
        required: true,
        description: 'Armazena CNH, CRLV, Contrato, Procuração, Comprovante de Residência e Fichas assinadas no cofre da empresa sem arquivos duplicados.',
        originModule: 'Anexo Comercial ou Migração de Arquivos (64GB)',
        destinationModule: 'Auditoria (Conferência em Tela Dividida), Jurídico & Backup em Nuvem',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'cadastros_comuns', label: 'Cadastros Comuns', description: 'Consome Clientes, Bancos, Modalidades, Consultores e Séries.' },
        { moduleKey: 'appointments', label: 'Agendamentos', description: 'Origina atendimentos cumpridos convertidos em contratos.' },
        { moduleKey: 'config', label: 'Migração R2 (64GB)', description: 'Integra automaticamente documentos legados do bucketdinvicta ao dossiê do contrato.' },
      ],
      outputsTo: [
        { moduleKey: 'audit', label: 'Auditoria & Boletos', description: 'Recebe a ficha submetida para conferência documental e aprovação.' },
        { moduleKey: 'internal_messaging', label: 'Mensageria Interna (Ivi)', description: 'Alerta a Auditoria no envio e o Comercial caso haja devolução.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Contratos, Protocolos e Devoluções da Auditoria',
        fieldLabel: 'Listagem de Admissões e Status',
        scriptText:
          'Na visão inicial da Admissão você acompanha todas as fichas da unidade, seus protocolos e alertas caso alguma ficha tenha sido devolvida pela Auditoria para correção.',
        fromX: 520,
        fromY: 280,
        toX: 820,
        toY: 230,
        boxW: 1100,
        boxH: 140,
      },
      {
        stepOrder: 2,
        title: 'Cadastro Estruturado, Veículo e Honorários',
        fieldLabel: 'Dados Contratuais & Cenários Comparativos',
        scriptText:
          'Ao abrir ou criar uma admissão, preencha Titular, Banco, Modalidade e valores da dívida. Se for modalidade veicular, preencha placa, chassi e RENAVAM para monitoramento preventivo.',
        fromX: 480,
        fromY: 320,
        toX: 820,
        toY: 460,
        boxW: 1100,
        boxH: 260,
        relatedModule: 'cadastros_comuns',
      },
      {
        stepOrder: 3,
        title: 'Dossiê Digital no BucketDaInvicta & Submissão',
        fieldLabel: 'Anexos Dossiê & Enviar para Auditoria',
        scriptText:
          'Anexe toda a documentação obrigatória no dossiê criptografado (também alimentado pela Migração R2) e clique em Submeter à Auditoria. A Ivi notificará imediatamente o setor de Auditoria.',
        fromX: 850,
        fromY: 480,
        toX: 1100,
        toY: 690,
        boxW: 480,
        boxH: 130,
        relatedModule: 'audit',
      },
    ],
  },
  {
    moduleKey: 'audit',
    title: 'Auditoria & Boletos Iniciais',
    menuGroup: 'Operação & Tratativa',
    menuPath: 'Operação & Tratativa > Auditoria & Boletos',
    sortOrder: 9,
    summary:
      'Mesa de compliance e conferência documental em tela dividida: valida itens do checklist configurável, realiza leitura inteligente de documentos com a Ivi IA (usando cache de decisões para economizar tokens), aprova fichas, devolve inconsistências ao Comercial e libera os 2 boletos iniciais.',
    objective:
      'Assegurar conformidade jurídica e documental antes de liberar o contrato para Negociações Bancárias, Jurídico e faturamento financeiro.',
    screenshotUrl: '/assets/module-docs/audit.png',
    fieldsJson: [
      {
        fieldName: 'auditQueue',
        fieldLabel: 'Fila de Conferência & Trava de Revisor Ativo',
        fieldType: 'Lista',
        required: true,
        description: 'Lista fichas em Aguardando Auditoria, Retorno ao Auditor ou Devolvidas, evitando análise simultânea duplicada.',
        originModule: 'Comercial > Admissão & Dossiê',
        destinationModule: 'Mesa de Conferência da Auditoria',
      },
      {
        fieldName: 'checklistItems',
        fieldLabel: 'Checklist Dinâmico de Auditoria',
        fieldType: 'Lista de Checagem',
        required: true,
        description: 'Itens de verificação carregados conforme a modalidade do contrato.',
        originModule: 'Governança > Checklist de Auditoria',
        destinationModule: 'Parecer Final da Auditoria',
      },
      {
        fieldName: 'iviAuditAnalysis',
        fieldLabel: 'Varredura & Parecer Inteligente Ivi',
        fieldType: 'Assistente Ivi',
        required: false,
        description: 'A Ivi confere documentos anexados contra os dados da ficha e sugere aprovar ou devolver, reaproveitando análises já feitas quando nada muda.',
        originModule: 'Admissão (Dossiê & Campos) + Checklist de Auditoria',
        destinationModule: 'Histórico de Pareceres da Auditoria',
      },
      {
        fieldName: 'auditRejectionReason',
        fieldLabel: 'Parecer / Motivo de Devolução ao Comercial',
        fieldType: 'Texto Longo',
        required: false,
        description: 'Texto detalhado da pendência encontrada para correção pelo consultor comercial.',
        originModule: 'Auditor & Sugestão da Ivi',
        destinationModule: 'Admissão & Mensageria Interna (Aviso ao Comercial)',
      },
      {
        fieldName: 'initialBoletos',
        fieldLabel: 'Emissão dos 2 Boletos Iniciais',
        fieldType: 'Ação',
        required: false,
        description: 'Ao aprovar a ficha, gera os 2 primeiros títulos financeiros vinculados ao contrato.',
        originModule: 'Parcelas Iniciais da Ficha de Admissão',
        destinationModule: 'Administração Financeira (Contas a Receber)',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'admission', label: 'Admissão & Dossiê', description: 'Envia ficha contratual e arquivos criptografados do dossiê.' },
        { moduleKey: 'config', label: 'Checklist de Auditoria', description: 'Define regras de conferência por modalidade.' },
      ],
      outputsTo: [
        { moduleKey: 'finance', label: 'Administração Financeira', description: 'Gera os 2 boletos iniciais em Contas a Receber e abre a Folha de Rosto após quitação.' },
        { moduleKey: 'legal', label: 'Jurídico & Escavador', description: 'Sinaliza contratos veiculares aprovados para monitoramento processual.' },
        { moduleKey: 'negotiations', label: 'Negociações Bancárias', description: 'Disponibiliza contratos aprovados para tratativa com bancos.' },
        { moduleKey: 'internal_messaging', label: 'Mensageria Interna', description: 'Avisa Comercial em devoluções ou Jurídico/Financeiro na aprovação.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Fila de Conferência & SLA',
        fieldLabel: 'Filtros e Fila de Admissões para Auditoria',
        scriptText:
          'Selecione na fila à esquerda a ficha enviada pelo Comercial. Note os selos de SLA, alertas de retorno de correção e bloqueio de revisor ativo para evitar trabalho duplicado.',
        fromX: 520,
        fromY: 360,
        toX: 430,
        toY: 410,
        boxW: 360,
        boxH: 380,
        relatedModule: 'admission',
      },
      {
        stepOrder: 2,
        title: 'Leitor de Dossiê & Varredura Ivi IA',
        fieldLabel: 'Visualização Lado a Lado + Checklist Ivi',
        scriptText:
          'Ao abrir um dossiê, o menu lateral recolhe automaticamente para dar máximo espaço à leitura dos documentos. Acione a Ivi para verificar o checklist usando cache inteligente sem desperdício de tokens.',
        fromX: 480,
        fromY: 310,
        toX: 880,
        toY: 430,
        boxW: 620,
        boxH: 340,
      },
      {
        stepOrder: 3,
        title: 'Aprovação, Devolução ou Boletos Iniciais',
        fieldLabel: 'Botões de Decisão e Emissão Inicial',
        scriptText:
          'Se houver pendência, devolva registrando o motivo (que notifica o Comercial via Ivi). Estando tudo conforme, aprove e gere os 2 boletos iniciais integrados ao Financeiro.',
        fromX: 880,
        fromY: 500,
        toX: 1120,
        toY: 690,
        boxW: 440,
        boxH: 130,
        relatedModule: 'finance',
      },
    ],
  },
  {
    moduleKey: 'legal',
    title: 'Jurídico & Escavador (Processos dos Clientes & Busca/Apreensão)',
    menuGroup: 'Operação & Tratativa',
    menuPath: 'Operação & Tratativa > Jurídico & Escavador',
    sortOrder: 10,
    summary:
      'Monitoramento processual automatizado dos clientes via Escavador (e contingência Detran), com tradução automática do "juridiquês" para linguagem acessível ao cliente pela Ivi IA e registro obrigatório de contato preventivo.',
    objective:
      'Detectar qualquer risco de Busca e Apreensão ou nova intimação em tempo real e garantir que o cliente seja avisado e orientado com clareza.',
    screenshotUrl: '/assets/module-docs/legal.png',
    fieldsJson: [
      {
        fieldName: 'processNumber',
        fieldLabel: 'Número do Processo & Tribunal',
        fieldType: 'Texto',
        required: true,
        description: 'Identificador judicial monitorado automaticamente ou por consulta direta.',
        originModule: 'Consulta Processual & Cadastro Jurídico',
        destinationModule: 'Linha do Tempo de Movimentações & Alertas',
      },
      {
        fieldName: 'hasSearchSeizure',
        fieldLabel: 'Alertas Críticos: Busca e Apreensão / Veículo Apreendido',
        fieldType: 'Marcações de Risco',
        required: false,
        description: 'Sinalizadores de prioridade máxima exibidos também na Visão Executiva e no Dashboard Gerencial.',
        originModule: 'Auditoria & Monitoramento Processual',
        destinationModule: 'Visão Executiva, Dashboard Gerencial & Mensageria Interna',
      },
      {
        fieldName: 'iviTranslationPtBr',
        fieldLabel: 'Tradução Ivi do Despacho (Português Claro)',
        fieldType: 'Texto Longo',
        required: false,
        description: 'Resumo claro gerado pela Ivi explicando o que aconteceu, risco do bem e próximo passo em até 3 frases.',
        originModule: 'Texto Original do Despacho Judicial',
        destinationModule: 'Comunicação ao Cliente por WhatsApp ou E-mail',
      },
      {
        fieldName: 'clientContactLog',
        fieldLabel: 'Registro de Leitura e Contato com o Cliente',
        fieldType: 'Grupo de Campos',
        required: false,
        description: 'Registra data/hora de abertura, canal de aviso (WhatsApp, Telefone, E-mail) e confirmação de ciência.',
        originModule: 'Advogado / Equipe Jurídica',
        destinationModule: 'Auditoria Geral & Controle de Prazos de Atendimento',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'admission', label: 'Admissão & Clientes', description: 'Associa processos ao cliente titular e contrato veicular.' },
        { moduleKey: 'audit', label: 'Auditoria', description: 'Recebe flags de busca e apreensão detectadas na conferência.' },
      ],
      outputsTo: [
        { moduleKey: 'overview', label: 'Visão Executiva & Gerencial', description: 'Alimenta contadores de movimentações não lidas e risco de apreensão.' },
        { moduleKey: 'internal_messaging', label: 'Mensageria Interna (Ivi)', description: 'Dispara aviso piscante ao setor jurídico quando entra despacho novo.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Lista de Processos e Alertas de Apreensão',
        fieldLabel: 'Carteira Processual e Busca Escavador',
        scriptText:
          'Aqui ficam os processos judiciais dos clientes monitorados. Itens com marcador de Busca e Apreensão ou movimentação não lida aparecem destacados no topo para tratativa imediata.',
        fromX: 520,
        fromY: 320,
        toX: 480,
        toY: 390,
        boxW: 440,
        boxH: 380,
      },
      {
        stepOrder: 2,
        title: 'Tradução Ivi & Registro de Contato ao Cliente',
        fieldLabel: 'Despacho Original x Tradução Ivi + WhatsApp',
        scriptText:
          'Ao selecionar um processo, você lê o despacho oficial e a tradução em linguagem simples feita pela Ivi. Depois de orientar o cliente pelo WhatsApp/E-mail, marque a leitura e contato como concluídos.',
        fromX: 600,
        fromY: 360,
        toX: 980,
        toY: 460,
        boxW: 540,
        boxH: 360,
      },
    ],
  },
  {
    moduleKey: 'negotiations',
    title: 'Negociações Bancárias & Funil Comercial com Bancos',
    menuGroup: 'Operação & Tratativa',
    menuPath: 'Operação & Tratativa > Negociações Bancárias',
    sortOrder: 11,
    summary:
      'Gestão completa das tratativas junto às instituições financeiras: registra contatos com bancos e clientes, controla propostas e contrapropostas, acompanha metas mensais por negociador, calcula descontos e aciona a consultoria estratégica da Ivi.',
    objective:
      'Maximizar a taxa de acordos fechados e a economia obtida para os clientes, mantendo rastreabilidade total de cada proposta junto ao banco.',
    screenshotUrl: '/assets/module-docs/negotiations.png',
    fieldsJson: [
      {
        fieldName: 'bankAndClient',
        fieldLabel: 'Cliente, Admissão, Banco & Contato do Banco',
        fieldType: 'Seleção Integrada',
        required: true,
        description: 'Vincula o contrato aprovado e seleciona o contato específico da mesa negociadora do banco.',
        originModule: 'Admissão & Cadastros Comuns (Bancos e Contatos)',
        destinationModule: 'Envios de WhatsApp ou E-mail para o Banco',
      },
      {
        fieldName: 'originalDebtAndTarget',
        fieldLabel: 'Dívida Original, Meta de Desconto (%) & Economia Estimada',
        fieldType: 'Valores e Percentual',
        required: true,
        description: 'Define o valor de entrada da negociação, meta de redução configurada no banco e projeção de economia.',
        originModule: 'Admissão & Serviços Bancários (Cadastros Comuns)',
        destinationModule: 'Ranking de Metas & Visão Executiva',
      },
      {
        fieldName: 'proposalsHistory',
        fieldLabel: 'Propostas & Contrapropostas (Nossa vs. Banco)',
        fieldType: 'Lista',
        required: false,
        description: 'Registra valor proposto, % de desconto, entrada, parcelas e status (Aguardando, Aceita, Recusada, Contraproposta).',
        originModule: 'Negociador & Retorno do Banco',
        destinationModule: 'Fechamento do Acordo & Parecer da Ivi',
      },
      {
        fieldName: 'iviInsightsJson',
        fieldLabel: 'Consultor Estratégico Ivi (Rascunhos WhatsApp & Diagnóstico)',
        fieldType: 'Assistente Ivi',
        required: false,
        description: 'Gera análise estratégica do acordo e textos prontos para abordagem ao banco e ao cliente.',
        originModule: 'Histórico de Propostas e Contatos',
        destinationModule: 'Cópia para WhatsApp & Registro da Tratativa',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'admission', label: 'Admissão', description: 'Fornece saldo devedor, banco e número do contrato.' },
        { moduleKey: 'cadastros_comuns', label: 'Bancos & Contatos', description: 'Fornece telefones/e-mails dos negociadores bancários e % alvo.' },
      ],
      outputsTo: [
        { moduleKey: 'overview', label: 'Visão Executiva', description: 'Atualiza o total de negociações ativas e economia acumulada.' },
        { moduleKey: 'internal_messaging', label: 'Mensageria Interna (Ivi)', description: 'Dispara aviso ao setor quando uma nova negociação é iniciada ou fechada.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Metas, Status e Funil de Negociações',
        fieldLabel: 'Cards de Carteira e Funil Comercial',
        scriptText:
          'Na parte superior você acompanha metas do mês, saldo total em negociação e economia conquistada. Logo abaixo ficam as negociações abertas, em andamento e acordos fechados.',
        fromX: 520,
        fromY: 280,
        toX: 820,
        toY: 220,
        boxW: 1100,
        boxH: 150,
      },
      {
        stepOrder: 2,
        title: 'Propostas, Contatos e Parecer Estratégico Ivi',
        fieldLabel: 'Detalhe da Negociação & Ivi Advisor',
        scriptText:
          'Ao abrir uma ficha, registre contatos com o banco/cliente, lance propostas e peça à Ivi sugestões de abordagem com desconto-alvo e rascunhos prontos para WhatsApp.',
        fromX: 500,
        fromY: 360,
        toX: 820,
        toY: 540,
        boxW: 1100,
        boxH: 340,
        relatedModule: 'cadastros_comuns',
      },
    ],
  },
  {
    moduleKey: 'internal_messaging',
    title: 'Mensageria Interna & Alertas Automáticos da Ivi por Setor',
    menuGroup: 'Operação & Tratativa',
    menuPath: 'Operação & Tratativa > Mensageria Interna',
    sortOrder: 12,
    summary:
      'Central de comunicação interna entre setores e equipes: consolida avisos automáticos enviados pela Ivi a cada movimentação entre departamentos (Agendamentos, Prospecção, Admissão, Auditoria, Jurídico, Negociações, Financeiro, Cobrança) com indicador piscante e permite mensagens manuais controladas por grupo e unidade.',
    objective:
      'Garantir que nenhuma passagem de bastão entre setores passe despercebida, respeitando a regra de que colaboradores escrevem apenas para seus grupos e Administradores para todos os grupos e unidades.',
    screenshotUrl: '/assets/module-docs/internal_messaging.png',
    fieldsJson: [
      {
        fieldName: 'sectorFilter',
        fieldLabel: 'Setores Monitorados & Sinalizadores Piscantes',
        fieldType: 'Abas por Setor',
        required: false,
        description: 'Filtra mensagens automáticas da Ivi ou manuais por setor; cada pendência mantém ponto vermelho piscando no menu lateral.',
        originModule: 'Movimentações Automáticas em Todos os Módulos',
        destinationModule: 'Confirmação de Leitura do Setor Destino',
      },
      {
        fieldName: 'targetGroupId',
        fieldLabel: 'Grupo de Usuários Destino',
        fieldType: 'Seleção',
        required: true,
        description: 'Usuários comuns podem enviar exclusivamente para o seu próprio grupo; Administradores selecionam qualquer grupo.',
        originModule: 'Governança > Grupos de Usuários',
        destinationModule: 'Caixa de Mensagens do Grupo Destinatário',
      },
      {
        fieldName: 'targetUnitId',
        fieldLabel: 'Unidade Destino',
        fieldType: 'Seleção',
        required: false,
        description: 'Disponível aos administradores para envio direcionado a filiais específicas ou todas as unidades.',
        originModule: 'Governança > Unidades',
        destinationModule: 'Caixa de Entrada dos Usuários da Unidade',
      },
      {
        fieldName: 'subjectAndBody',
        fieldLabel: 'Assunto & Conteúdo da Mensagem',
        fieldType: 'Texto Longo',
        required: true,
        description: 'Corpo do comunicado manual ou resumo automático gerado pela Ivi na passagem de tarefas.',
        originModule: 'Remetente ou Aviso Automático da Ivi',
        destinationModule: 'Caixa de Mensageria Interna & Alerta no Topo da Tela',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'appointments', label: 'Todos os Setores', description: 'Qualquer passagem de tarefa (Agendamentos, Prospecção, Admissão, Auditoria, Jurídico, Negociações, Financeiro, Cobrança) envia comunicado automático via Ivi.' },
      ],
      outputsTo: [
        { moduleKey: 'overview', label: 'Menu Lateral & Barra de Alerta', description: 'Acende o sinalizador piscante e contador sobre o setor destinatário até confirmação de leitura.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Sinalizador Piscante & Caixa por Setor',
        fieldLabel: 'Abas de Setor & Badges Não Lidos',
        scriptText:
          'Sempre que uma tarefa muda de setor, a Ivi dispara automaticamente uma mensagem e acende um ponto piscante no menu lateral. Aqui você filtra por setor e confirma a leitura.',
        fromX: 520,
        fromY: 280,
        toX: 820,
        toY: 220,
        boxW: 1100,
        boxH: 140,
      },
      {
        stepOrder: 2,
        title: 'Regra de Envio por Grupo e Unidade',
        fieldLabel: 'Compositor de Mensagem Manual',
        scriptText:
          'Ao enviar manualmente, operadores comuns escrevem apenas para seu próprio grupo de usuários, enquanto Administradores podem direcionar comunicados para todos os grupos e todas as unidades.',
        fromX: 500,
        fromY: 360,
        toX: 520,
        toY: 560,
        boxW: 520,
        boxH: 340,
        relatedModule: 'config',
      },
    ],
  },
  {
    moduleKey: 'finance',
    title: 'Receita -> Administração Financeira (Receber, Régua Ivi, Pagar & Conta Corrente)',
    menuGroup: 'Receita',
    menuPath: 'Receita > Administração Financeira',
    sortOrder: 13,
    summary:
      'ERP financeiro completo: cadastros financeiros (Fornecedores, Tipos de Documento, Portadores, Plano de Contas), Conta Corrente, Movimento e Conciliação Bancária (07h), Contas a Receber com Folha de Rosto, Contas a Pagar e Régua de Cobrança automática conduzida pela Ivi (-15d, -5d, +7d).',
    objective:
      'Controlar todo o fluxo de caixa, liquidações em lote, compensações bancárias e disparos automáticos da régua de cobrança mantendo integridade contábil.',
    screenshotUrl: '/assets/module-docs/finance.png',
    fieldsJson: [
      {
        fieldName: 'titleCodeAndScope',
        fieldLabel: 'Código do Título & Escopo (RECEBER / PAGAR)',
        fieldType: 'Texto',
        required: true,
        description: 'Identificador único do lançamento financeiro e natureza (receita de assessoria ou despesa).',
        originModule: 'Auditoria (2 Boletos Iniciais), Folha de Rosto ou Lançamento Manual',
        destinationModule: 'Cobrança & Movimento de Conta Corrente',
      },
      {
        fieldName: 'clientOrSupplierAndChart',
        fieldLabel: 'Cliente / Fornecedor, Plano de Contas, Portador & Conta Corrente',
        fieldType: 'Seleção Integrada',
        required: true,
        description: 'Classifica contabilmente o título e define a carteira ou banco vinculado.',
        originModule: 'Cadastros Comuns & Financeiro (Cadastros Auxiliares)',
        destinationModule: 'Fluxo de Caixa & Painéis Gerenciais',
      },
      {
        fieldName: 'amountsAndDueDate',
        fieldLabel: 'Valor Original, Juros, Multa, Desconto & Vencimento',
        fieldType: 'Valores e Data',
        required: true,
        description: 'Calcula saldo devedor atualizado automaticamente conforme baixa parcial ou total.',
        originModule: 'Regra do Contrato ou Baixa Manual / em Lote',
        destinationModule: 'Histórico de Baixas & Movimento de Conta Corrente',
      },
      {
        fieldName: 'reguaIviStages',
        fieldLabel: 'Régua de Cobrança Ivi (-15d, -5d, +7d)',
        fieldType: 'Ação em Lote',
        required: false,
        description: 'Seleciona títulos elegíveis e redige lembretes e cobranças personalizadas via WhatsApp ou E-mail sem duplicidade.',
        originModule: 'Vencimentos de Contas a Receber',
        destinationModule: 'Envio WhatsApp / E-mail & Registro de Etapas da Régua',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'audit', label: 'Auditoria & Boletos', description: 'Injeta automaticamente os 2 boletos iniciais após aprovação.' },
        { moduleKey: 'cadastros_comuns', label: 'Clientes & Unidades', description: 'Fornece sacados, filiais e dados para emissão.' },
      ],
      outputsTo: [
        { moduleKey: 'collection', label: 'Cobrança & Ranking', description: 'Encaminha títulos vencidos para fila de recuperação e pontuação.' },
        { moduleKey: 'managerial_dashboard', label: 'Dashboard Gerencial', description: 'Fornece volumes recebidos, vencidos e a vencer.' },
        { moduleKey: 'internal_messaging', label: 'Mensageria Interna (Ivi)', description: 'Sinaliza o setor sobre compensações e títulos críticos.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Submenus da Administração Financeira',
        fieldLabel: 'Cadastros, Conta Corrente, Receber, Régua e Pagar',
        scriptText:
          'No menu lateral sob Administração Financeira ficam Cadastros Auxiliares, Conta Corrente (Movimento e Conciliação Bancária), Contas a Receber, Régua de Cobrança (Ivi) e Contas a Pagar.',
        fromX: 360,
        fromY: 320,
        toX: 135,
        toY: 500,
        boxW: 245,
        boxH: 260,
      },
      {
        stepOrder: 2,
        title: 'Títulos a Receber, Folha de Rosto e Baixas',
        fieldLabel: 'Tabela de Títulos e Liquidação Bancária',
        scriptText:
          'Na grade principal você filtra por vencimento/status, dá baixa em lote vinculando diretamente ao Movimento de Conta Corrente e libera a Folha de Rosto após pagamento das iniciais.',
        fromX: 520,
        fromY: 320,
        toX: 820,
        toY: 460,
        boxW: 1100,
        boxH: 380,
        relatedModule: 'collection',
      },
    ],
  },
  {
    moduleKey: 'collection',
    title: 'Receita -> Cobrança & Ranking (Coordenação & Operacional)',
    menuGroup: 'Receita',
    menuPath: 'Receita > Cobrança & Ranking',
    sortOrder: 14,
    summary:
      'Operação de recuperação de crédito dividida em Operacional (fila por UF, dossiê da dívida, notas de contato, anexos e solicitação de cancelamento) e Coordenação (gestão de tarefas Kanban com timer, subtarefas, compartilhamento, espelho do operador, relatórios Ivi e ranking de gamificação).',
    objective:
      'Recuperar títulos vencidos rapidamente com método, registrar todas as promessas/anexos e ranquear a produtividade dos cobradores por pontuação.',
    screenshotUrl: '/assets/module-docs/collection.png',
    fieldsJson: [
      {
        fieldName: 'stateAndAgingQueue',
        fieldLabel: 'Fila de Casos por Estado (UF), Atraso & Prioridade',
        fieldType: 'Tabela',
        required: true,
        description: 'Ordena clientes inadimplentes por estado, dias de atraso e valor em aberto.',
        originModule: 'Administração Financeira (Contas a Receber Vencidos)',
        destinationModule: 'Atendimento do Cobrador Designado',
      },
      {
        fieldName: 'collectionNotes',
        fieldLabel: 'Notas Operacionais, Promessa de Pagamento & Anexos',
        fieldType: 'Formulário',
        required: true,
        description: 'Registra data, hora, canal, status de negociação, cálculo atualizado da dívida e solicitações de cancelamento contratual.',
        originModule: 'Cobrança > Operacional',
        destinationModule: 'Histórico da Cobrança & Auditoria Geral',
      },
      {
        fieldName: 'coordinatorTasks',
        fieldLabel: 'Coordenação: Tarefas, Cronômetro, Subtarefas & Relatórios Ivi',
        fieldType: 'Quadro de Tarefas',
        required: false,
        description: 'Quadro compartilhável entre coordenadores com cronômetro de execução, espelho de produtividade e relatórios gerados pela Ivi.',
        originModule: 'Notas Rápidas ou Criação na Coordenação',
        destinationModule: 'Relatórios da Coordenação & Dashboard Gerencial',
      },
      {
        fieldName: 'gamificationPoints',
        fieldLabel: 'Ranking & Pontuação de Recuperadores',
        fieldType: 'Ranking',
        required: false,
        description: 'Pontuação atribuída automaticamente na quitação de títulos vinculados ao cobrador.',
        originModule: 'Baixa de Títulos em Contas a Receber',
        destinationModule: 'Cabeçalho do Usuário & Dashboard Gerencial',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'finance', label: 'Contas a Receber', description: 'Envia títulos vencidos/abertos e notifica baixas para pontuar o operador.' },
      ],
      outputsTo: [
        { moduleKey: 'managerial_dashboard', label: 'Dashboard Gerencial', description: 'Alimenta ranking de cobradores e taxa de recuperação por UF.' },
        { moduleKey: 'internal_messaging', label: 'Mensageria Interna (Ivi)', description: 'Alerta Coordenação e setores sobre acertos e pedidos de cancelamento.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Visão Operacional x Visão Coordenação',
        fieldLabel: 'Submenus Operacional e Coordenação',
        scriptText:
          'Cobrança possui dois modos no menu: Operacional (foco em ligar, registrar notas e promessas) e Coordenação (tarefas Kanban com timer, espelho de equipe e relatórios IA da Ivi).',
        fromX: 480,
        fromY: 280,
        toX: 820,
        toY: 210,
        boxW: 1100,
        boxH: 130,
      },
      {
        stepOrder: 2,
        title: 'Tratativa do Devedor, Notas & Ranking',
        fieldLabel: 'Fila de Títulos Vencidos & Histórico',
        scriptText:
          'Clique em um caso vencido para ver o snapshot atualizado de juros/multa, anexar comprovantes ou registrar promessa de pagamento. Quando o título é baixado no Financeiro, o operador ganha pontos no Ranking.',
        fromX: 500,
        fromY: 360,
        toX: 820,
        toY: 540,
        boxW: 1100,
        boxH: 340,
        relatedModule: 'finance',
      },
    ],
  },
  {
    moduleKey: 'forms',
    title: 'Formulários & Modelos de Documentos A4 (Ivi Arquiteta)',
    menuGroup: 'Formulários & Relatórios',
    menuPath: 'Formulários & Relatórios > Formulários',
    sortOrder: 15,
    summary:
      'Construtor inteligente de formulários dinâmicos (com pontuação automática e análise Ivi de cada resposta), além do editor visual de Modelos A4/DOCX com variáveis dinâmicas de Clientes e Admissões.',
    objective:
      'Padronizar pesquisas NPS, checklists extras, formulários externos e impressão de procurações/contratos/fichas A4 diretamente dos dados do sistema.',
    screenshotUrl: '/assets/module-docs/forms.png',
    fieldsJson: [
      {
        fieldName: 'titleAndCategory',
        fieldLabel: 'Título, Código, Categoria & Vínculo no Sistema',
        fieldType: 'Texto e Seleção',
        required: true,
        description: 'Identifica o formulário (Triagem, Auditoria, Pesquisa, Jurídico) e a tela onde aparece.',
        originModule: 'Construtor de Formulários ou Geração Assistida pela Ivi',
        destinationModule: 'Preenchimento Interno ou Link Público',
      },
      {
        fieldName: 'fieldsJson',
        fieldLabel: 'Campos Dinâmicos & Condicionais',
        fieldType: 'Construtor Visual',
        required: true,
        description: 'Permite organizar campos de texto, CPF/CNPJ, moeda, avaliação e regras de exibição.',
        originModule: 'Editor de Campos ou Leitura de Modelo pela Ivi',
        destinationModule: 'Aba Respostas & Análise Automática da Ivi',
      },
      {
        fieldName: 'a4Templates',
        fieldLabel: 'Modelos de Documentos A4 & Upload Word',
        fieldType: 'Editor A4',
        required: false,
        description: 'Editor com cabeçalho, rodapé, variáveis dinâmicas e vínculo direto com telas do menu.',
        originModule: 'Formulários > Aba Modelos A4',
        destinationModule: 'Impressão Instantânea nas Telas Vinculadas',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'cadastros_comuns', label: 'Clientes & Admissões', description: 'Fornece variáveis e registros vinculados ao preencher formulários ou gerar A4.' },
      ],
      outputsTo: [
        { moduleKey: 'admission', label: 'Admissão / Auditoria / Jurídico', description: 'Disponibiliza modelos A4 para impressão direta dentro das fichas.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Abas de Formulários, Respostas e Modelos A4',
        fieldLabel: 'Menu de Abas e Criação Assistida por Ivi',
        scriptText:
          'Você pode gerar um formulário inteiro escrevendo um comando ou subindo um PDF/imagem modelo para a Ivi estruturar automaticamente os campos, ou gerenciar Modelos A4 vinculados ao menu.',
        fromX: 520,
        fromY: 260,
        toX: 820,
        toY: 200,
        boxW: 1100,
        boxH: 130,
      },
      {
        stepOrder: 2,
        title: 'Editor de Campos, Link Público e Parecer Ivi',
        fieldLabel: 'Lista de Formulários e Submissões',
        scriptText:
          'Publique o formulário para preenchimento interno ou via link externo. Toda resposta recebida recebe protocolo próprio, score e resumo classificatório da Ivi.',
        fromX: 500,
        fromY: 360,
        toX: 820,
        toY: 520,
        boxW: 1100,
        boxH: 340,
      },
    ],
  },
  {
    moduleKey: 'reports',
    title: 'Relatórios Gerais & Builder Gerencial com Gráficos',
    menuGroup: 'Formulários & Relatórios',
    menuPath: 'Formulários & Relatórios > Relatórios Gerais',
    sortOrder: 16,
    summary:
      'Motor de relatórios personalizáveis com consultas SQL seguras (somente leitura), filtros dinâmicos, agrupamentos com subtotais, gráficos mistos (Barras/Linhas/Pizza), sub-relatórios, controle de permissão por grupo e exportação.',
    objective:
      'Permitir que gestores e analistas extraiam relatórios operacionais e gerenciais sob medida com total controle de acesso e formatação A4/Paisagem.',
    screenshotUrl: '/assets/module-docs/reports.png',
    fieldsJson: [
      {
        fieldName: 'sqlQuery',
        fieldLabel: 'Fonte de Dados do Relatório (Somente Leitura)',
        fieldType: 'Consulta',
        required: true,
        description: 'Define as informações extraídas da base da empresa com filtros seguros e dinâmicos.',
        originModule: 'Base de Dados do Sistema',
        destinationModule: 'Pré-visualização, Gráficos & Impressão',
      },
      {
        fieldName: 'layoutAndFilters',
        fieldLabel: 'Colunas, Agrupamentos, Totalizadores e Filtros',
        fieldType: 'Construtor Visual',
        required: true,
        description: 'Configura alinhamento, formato de moeda/data/CPF, somas por grupo e filtros interativos ao executar.',
        originModule: 'Relatórios Gerais > Editor de Relatório',
        destinationModule: 'Impressão A4 / Visualização em Tela',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'config', label: 'Governança & Permissões', description: 'Respeita grupos e usuários autorizados para cada relatório.' },
      ],
      outputsTo: [
        { moduleKey: 'managerial_dashboard', label: 'Diretoria & Gestão', description: 'Entrega relatórios formatados para tomada de decisão e auditoria.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Catálogo de Relatórios por Categoria',
        fieldLabel: 'Lista de Modelos Salvos e Execução',
        scriptText:
          'Escolha qualquer relatório salvo para executar na hora usando os filtros interativos de período, unidade ou status, ou clique em Editar/Novo para personalizar colunas e gráficos.',
        fromX: 520,
        fromY: 320,
        toX: 820,
        toY: 430,
        boxW: 1100,
        boxH: 430,
      },
    ],
  },
  {
    moduleKey: 'acomp_juridico',
    title: 'Governança -> Acompanhamento Jurídico (Processos da Empresa)',
    menuGroup: 'Governança',
    menuPath: 'Governança > Acompanhamento Jurídico',
    sortOrder: 17,
    summary:
      'Módulo corporativo exclusivo para acompanhar os processos judiciais em que a própria empresa figura como parte (Autora, Ré ou Terceira), com submenus de Dashboard de Risco, Processos, Prazos & Audiências e Anexos.',
    objective:
      'Controlar contingências, prazos processuais internos, audiências e provisões jurídicas da empresa separadamente dos contratos de clientes.',
    screenshotUrl: '/assets/module-docs/acomp_juridico.png',
    fieldsJson: [
      {
        fieldName: 'processNumberAndCourt',
        fieldLabel: 'Número do Processo, Tribunal, Comarca, Tipo & Polo',
        fieldType: 'Grupo de Campos',
        required: true,
        description: 'Qualifica a ação corporativa (Trabalhista, Cível, Tributário, Consumidor) e a parte contrária.',
        originModule: 'Departamento Jurídico Corporativo',
        destinationModule: 'Dashboard de Risco & Auditoria Geral',
      },
      {
        fieldName: 'riskLevelAndProvision',
        fieldLabel: 'Grau de Risco, Valor da Causa & Valor Provisionado',
        fieldType: 'Valor e Seleção',
        required: false,
        description: 'Mede impacto financeiro potencial (Baixo, Médio, Alto, Crítico) para governança executiva.',
        originModule: 'Avaliação Jurídica Interna',
        destinationModule: 'Painel de Governança Jurídica',
      },
      {
        fieldName: 'deadlinesAndHearings',
        fieldLabel: 'Prazos Processuais & Audiências',
        fieldType: 'Agenda Jurídica',
        required: false,
        description: 'Agenda contestações, recursos, instruções e conciliações vinculando advogado e colaborador responsável.',
        originModule: 'Acompanhamento Jurídico > Prazos e Audiências',
        destinationModule: 'Alertas de Vencimento de Prazo',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'cadastros_comuns', label: 'Unidades & Colaboradores', description: 'Vincula filial envolvida e responsável pelos prazos.' },
      ],
      outputsTo: [
        { moduleKey: 'config', label: 'Auditoria de Governança', description: 'Registra todas as alterações de processos, prazos e anexos na Auditoria Geral.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Dashboard, Processos e Prazos Corporativos',
        fieldLabel: 'Submenus Jurídicos da Empresa',
        scriptText:
          'Este módulo cuida dos processos da própria empresa (separado dos contratos dos clientes). Use o Dashboard para monitorar provisões e os submenus Processos e Prazos e Audiências para controlar entregas.',
        fromX: 480,
        fromY: 310,
        toX: 820,
        toY: 420,
        boxW: 1100,
        boxH: 430,
      },
    ],
  },
  {
    moduleKey: 'config',
    title: 'Governança -> Configurações & SQL (Portal, Excel, Migração de Arquivos, Usuários & Auditoria)',
    menuGroup: 'Governança',
    menuPath: 'Governança > Configurações & SQL',
    sortOrder: 18,
    summary:
      'Painel administrativo de governança técnica e segurança: gestão de Unidades, Usuários e Grupos por módulo/campo, Quadro de Horários, Checklist de Auditoria, Portal & Identidade (cores e logotipo em tempo real), Importação Excel em lote, Migração de Arquivos (64GB), Manutenção de Dados, Auditoria Geral e Central de Ajuda.',
    objective:
      'Prover autonomia total aos administradores para parametrizar regras de negócio, identidade visual, acessos LGPD e manutenção de dados com segurança.',
    screenshotUrl: '/assets/module-docs/config.png',
    fieldsJson: [
      {
        fieldName: 'unitsAndUsers',
        fieldLabel: 'Unidades, Usuários, Grupos & Horários de Trabalho',
        fieldType: 'Abas Administrativas',
        required: true,
        description: 'Define permissões por tela e por campo (Editar / Ler / Oculto), desbloqueio de contas suspensas e janelas permitidas de login.',
        originModule: 'Governança > Configurações & SQL',
        destinationModule: 'Tela de Acesso Corporativo & Mensageria Interna',
      },
      {
        fieldName: 'portalBranding',
        fieldLabel: 'Portal & Identidade (Cores & Logotipo)',
        fieldType: 'Editor Visual',
        required: false,
        description: 'Aplica instantaneamente as cores da barra lateral, cabeçalho, tela de fundo e o logotipo da empresa após salvar.',
        originModule: 'Configurações > Aba Portal & Identidade',
        destinationModule: 'Todo o Sistema (Barra Lateral, Topo e Home)',
      },
      {
        fieldName: 'excelImport',
        fieldLabel: 'Modelos & Importação Excel (Isolada ou em Conjunto)',
        fieldType: 'Planilhas Excel',
        required: false,
        description: 'Gera planilhas modelo e valida importações parciais ou integradas de Clientes, Admissões e Financeiro.',
        originModule: 'Planilha Excel do Administrador',
        destinationModule: 'Cadastros Comuns, Admissão & Administração Financeira',
      },
      {
        fieldName: 'r2Migration64gb',
        fieldLabel: 'Migração de Arquivos (64GB -> Cofre da Invicta)',
        fieldType: 'Migração em Nuvem',
        required: false,
        description: 'Envia acervos de até 64 GB sem arquivos repetidos e vincula automaticamente cada documento ao dossiê do Cliente e Admissão.',
        originModule: 'Pasta Local & Transferência Segura',
        destinationModule: 'Dossiês Digitais em Admissão & Cadastros Comuns',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'backup_restore', label: 'Backup & Nuvem', description: 'Conecta políticas de backup junto às configurações do sistema.' },
      ],
      outputsTo: [
        { moduleKey: 'home', label: 'Identidade Visual Global', description: 'Atualiza logotipo e paleta de cores para todos os usuários.' },
        { moduleKey: 'admission', label: 'Dossiês & Cadastros', description: 'Alimenta documentos migrados do R2 e registros importados via Excel.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Abas de Governança, Usuários e Horários',
        fieldLabel: 'Barra de Abas Administrativas',
        scriptText:
          'Todas as configurações estruturais vivem aqui: Unidades, Usuários, Grupos RBAC, Quadro de Horários, Checklist de Auditoria, Portal & Identidade, Importação Excel, Migração R2 e Console SQL.',
        fromX: 520,
        fromY: 260,
        toX: 820,
        toY: 195,
        boxW: 1100,
        boxH: 110,
      },
      {
        stepOrder: 2,
        title: 'Portal & Identidade, Importação Excel e Migração R2',
        fieldLabel: 'Área de Configuração Ativa',
        scriptText:
          'Ao alterar cores em Portal & Identidade, todo o sistema atualiza imediatamente ao salvar. Já em Migração R2 e Excel, os arquivos e tabelas sobem validados e já aparecem vinculados aos dossiês.',
        fromX: 500,
        fromY: 360,
        toX: 820,
        toY: 530,
        boxW: 1100,
        boxH: 340,
      },
    ],
  },
  {
    moduleKey: 'backup_restore',
    title: 'Governança -> Backup & Restore (Google Drive & Agendamento Automático)',
    menuGroup: 'Governança',
    menuPath: 'Governança > Backup & Restore (Nuvem)',
    sortOrder: 19,
    summary:
      'Rotina exclusiva de administradores para geração de backups completos (compactados em .gz com hash SHA-256), upload para pastas no Google Drive, agendamento automático por dias da semana e horário (BRT) com retenção programada e restauração segura de snapshots.',
    objective:
      'Garantir continuidade do negócio e recuperação contra desastres com cópias criptografadas e sincronizadas em nuvem.',
    screenshotUrl: '/assets/module-docs/backup_restore.png',
    fieldsJson: [
      {
        fieldName: 'targetFolder',
        fieldLabel: 'Pasta Destino no Google Drive (Backups do Portal)',
        fieldType: 'Pasta em Nuvem',
        required: true,
        description: 'Pasta criada ou selecionada na conta Google conectada onde as cópias compactadas de segurança serão gravadas.',
        originModule: 'Conexão com Google Drive',
        destinationModule: 'Cópias de Segurança na Nuvem',
      },
      {
        fieldName: 'scheduleDaysAndTime',
        fieldLabel: 'Tabela de Agendamento Automático (Dias da Semana & Horário)',
        fieldType: 'Agendamento',
        required: true,
        description: 'Configura execução automática pelos dias da semana e horário escolhido, mantendo histórico de versões.',
        originModule: 'Backup & Restore > Aba Agendamento Automático',
        destinationModule: 'Execução Automática Programada',
      },
      {
        fieldName: 'restoreAction',
        fieldLabel: 'Histórico de Execuções & Restauração Segura',
        fieldType: 'Tabela de Ações',
        required: false,
        description: 'Lista data, tamanho, status de envio e permite baixar ou restaurar cópias anteriores com segurança.',
        originModule: 'Histórico de Backups Executados',
        destinationModule: 'Restauração da Base de Dados do Portal',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'config', label: 'Dados Completos do Portal', description: 'Consolida todas as telas, usuários, grupos e auditorias em cópia única.' },
      ],
      outputsTo: [
        { moduleKey: 'config', label: 'Restauração Corporativa', description: 'Permite reverter ou baixar cópia íntegra dos dados em emergência.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Conexão Google Drive, Backup Manual & Agendamento',
        fieldLabel: 'Controles de Nuvem e Agendamentos',
        scriptText:
          'Conecte sua conta Google para enviar cópias de segurança diretamente para o Drive e configure na Tabela de Agendamento os dias da semana, horário e política de retenção automática.',
        fromX: 500,
        fromY: 320,
        toX: 820,
        toY: 450,
        boxW: 1100,
        boxH: 430,
      },
    ],
  },
  {
    moduleKey: 'training_docs',
    title: 'Treinamento Dinâmico & Documentação (Ivi Instrutora)',
    menuGroup: 'Governança',
    menuPath: 'Governança > Treinamento & Docs Ivi',
    sortOrder: 20,
    summary:
      'Central de documentação viva e treinamento interativo conduzido pela Ivi (Invicta Assessoria): combina respostas estáticas precisas com aprendizado coerente, setas animadas sobre capturas reais de cada tela, diagrama interativo de fluxo entre módulos, áudio em cache para reutilização e painel administrativo de gestão de conhecimento.',
    objective:
      'Capacitar novos colaboradores e esclarecer dúvidas operacionais com didática próxima e sem termos técnicos complexos, buscando todas as respostas na documentação validada.',
    screenshotUrl: '/assets/module-docs/training_docs.png',
    fieldsJson: [
      {
        fieldName: 'traineeName',
        fieldLabel: 'Nome do Treinando',
        fieldType: 'Texto',
        required: true,
        description: 'Solicitado pela Ivi no início para criar vínculo próximo, personalizar explicações e registrar exatamente onde cada colaborador parou.',
        originModule: 'Entrada do Colaborador no Treinamento',
        destinationModule: 'Progresso Salvo & Saudação Personalizada da Ivi (Texto e Áudio)',
      },
      {
        fieldName: 'staticDocQa',
        fieldLabel: 'Modo 1: Documentação Estática & Consulta Ivi',
        fieldType: 'Painel de Perguntas',
        required: false,
        description: 'Responde pontualmente sobre módulos, telas, campos, origens e destinos buscando na base oficial e aprendendo novos pontos de vista coerentes.',
        originModule: 'Documentação dos Módulos & Base de Conhecimento da Ivi',
        destinationModule: 'Respostas Validadas & Aprendizados Salvos',
      },
      {
        fieldName: 'dynamicTrainingStage',
        fieldLabel: 'Modo 2: Treinamento Dinâmico com Setas, Áudio & Chat de Dúvidas',
        fieldType: 'Aula Interativa',
        required: false,
        description: 'Apresenta cada campo com setas animadas sobre a tela cheia, Ivi caminhando e gesticulando no quadro ao lado, janela central de dúvidas ao final de cada explicação e retomada automática de onde o usuário parou.',
        originModule: 'Roteiro de Aulas do Módulo & Áudios em Cache',
        destinationModule: 'Progresso Individual Salvo por Usuário',
      },
      {
        fieldName: 'adminKnowledgeCrud',
        fieldLabel: 'Modo 3 (Apenas Administradores): Gestão da Base & Cache de Áudios',
        fieldType: 'Gestão Administrativa',
        required: false,
        description: 'Exclusivo para Administradores incluírem, alterarem, visualizarem e excluírem documentações, insights aprendidos, base da Ivi em Prospecção e áudios em cache.',
        originModule: 'Administradores do Sistema',
        destinationModule: 'Base Documental, Base de Prospecção & Áudios em Cache',
      },
    ],
    integrationsJson: {
      inputsFrom: [
        { moduleKey: 'config', label: 'Todos os Módulos Documentados', description: 'Documenta campos, telas e regras de cada setor do sistema.' },
        { moduleKey: 'prospection', label: 'Base Ivi de Prospecção', description: 'Compartilha gestão administrativa da base comercial e áudios salvos.' },
      ],
      outputsTo: [
        { moduleKey: 'prospection', label: 'Equipe Capacitada & Base Atualizada', description: 'Melhora a qualidade operacional de todos os setores e da Ivi.' },
      ],
    },
    trainingStepsJson: [
      {
        stepOrder: 1,
        title: 'Escolha de Módulo, Modo Estático ou Treinamento Dinâmico',
        fieldLabel: 'Lista de Módulos à Esquerda e Quadro da Ivi',
        scriptText:
          'Bem-vindo à Central da Ivi! No modo Estático você consulta rapidamente cada campo e sua origem/destino. No Treinamento Dinâmico, começamos por Acesso Corporativo & Dupla Verificação, mostramos cada campo na tela inteira, abrimos janela central de dúvidas e salvamos exatamente onde você parou.',
        fromX: 460,
        fromY: 220,
        toX: 820,
        toY: 240,
        boxW: 960,
        boxH: 140,
      },
      {
        stepOrder: 2,
        title: 'Gestão de Conhecimento e Áudios por Administradores',
        fieldLabel: 'Gestão Base & Áudio (Apenas Admin)',
        scriptText:
          'Administradores controlam todo o conteúdo útil da base documental, da Prospecção e dos áudios armazenados para manter a Ivi sempre afiada.',
        fromX: 560,
        fromY: 360,
        toX: 980,
        toY: 540,
        boxW: 620,
        boxH: 260,
      },
    ],
  },
];

const SYSTEM_DOCS_SEED_VERSION = 'v4_classroom_diagram_first';
let docsSeedDone = false;

export async function ensureSystemModuleDocsSeed(): Promise<void> {
  if (docsSeedDone) return;
  try {
    const versionRow = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'system_docs_catalog_version'))
      .limit(1);
    const currentVersion = (versionRow[0]?.value as { version?: string } | undefined)?.version || '';
    const needsCatalogRefresh = currentVersion !== SYSTEM_DOCS_SEED_VERSION;

    const existingDocs = await db
      .select({
        id: systemModuleDocs.id,
        moduleKey: systemModuleDocs.moduleKey,
        updatedByName: systemModuleDocs.updatedByName,
      })
      .from(systemModuleDocs);
    const existingByKey = new Map(existingDocs.map((d) => [d.moduleKey, d]));

    for (const item of SYSTEM_DOCS_CATALOG) {
      const existing = existingByKey.get(item.moduleKey);
      if (!existing) {
        await db.insert(systemModuleDocs).values({
          moduleKey: item.moduleKey,
          title: item.title,
          menuGroup: item.menuGroup,
          menuPath: item.menuPath,
          sortOrder: item.sortOrder,
          summary: item.summary,
          objective: item.objective,
          screenshotUrl: item.screenshotUrl,
          fieldsJson: item.fieldsJson,
          integrationsJson: item.integrationsJson,
          trainingStepsJson: item.trainingStepsJson,
          active: true,
          updatedByName: 'Instrutor Ivi (Documentação Oficial)',
        });
      } else if (needsCatalogRefresh) {
        await db
          .update(systemModuleDocs)
          .set({
            title: item.title,
            menuGroup: item.menuGroup,
            menuPath: item.menuPath,
            sortOrder: item.sortOrder,
            summary: item.summary,
            objective: item.objective,
            screenshotUrl: item.screenshotUrl,
            fieldsJson: item.fieldsJson,
            integrationsJson: item.integrationsJson,
            trainingStepsJson: item.trainingStepsJson,
            updatedAt: new Date(),
          })
          .where(eq(systemModuleDocs.id, existing.id));
      }
    }

    // Semear ou atualizar artigos base do sistema na tabela de conhecimento da Ivi
    const existingSysKb = await db
      .select({ id: iviKnowledgeArticles.id, sourceChannel: iviKnowledgeArticles.sourceChannel })
      .from(iviKnowledgeArticles)
      .where(eq(iviKnowledgeArticles.scope, 'system_doc'));

    if (existingSysKb.length === 0 || needsCatalogRefresh) {
      if (needsCatalogRefresh && existingSysKb.length > 0) {
        await db
          .delete(iviKnowledgeArticles)
          .where(eq(iviKnowledgeArticles.sourceChannel, 'system_doc'));
      }
      await db.insert(iviKnowledgeArticles).values([
        {
          scope: 'system_doc',
          moduleKey: 'admission',
          questionPattern: 'Qual é a origem dos dados da Admissão e para onde ela envia ao finalizar?',
          answerTemplate:
            'A Ficha de Admissão recebe Clientes (Titular e Responsável pelo Bem), Bancos, Modalidades e Séries de Cadastros Comuns, além de agendamentos vindos de Prospecção e Agendamentos (e documentos trazidos pela Migração de Arquivos). Ao ser enviada, segue para Auditoria & Boletos, onde após aprovação gera os 2 boletos iniciais em Administração Financeira (Contas a Receber), sinaliza Jurídico e disponibiliza o contrato para Negociações Bancárias.',
          category: 'integracao_modulos',
          sourceChannel: 'system_doc',
          hitCount: 12,
          updatedByName: 'Instrutor Ivi',
          active: true,
        },
        {
          scope: 'system_doc',
          moduleKey: 'prospection',
          questionPattern: 'Como funciona a ligação entre Prospecção, Resumo da Conversa e Agendamentos?',
          answerTemplate:
            'Na Prospecção, as conversas de atendimento, transcrições de áudio e ligações alimentam automaticamente (ou manualmente após ligação) o quadro lateral "Resumo da Conversa" com Usuário, Data e Hora. Ao clicar em Agendar no cabeçalho do atendimento, esse resumo é gravado diretamente no campo Observações da tela de Agendamentos.',
          category: 'fluxo_comercial',
          sourceChannel: 'system_doc',
          hitCount: 15,
          updatedByName: 'Instrutor Ivi',
          active: true,
        },
        {
          scope: 'system_doc',
          moduleKey: 'internal_messaging',
          questionPattern: 'Quem pode enviar mensagens para quem na Mensageria Interna e como funcionam os alertas da Ivi?',
          answerTemplate:
            'Sempre que uma tarefa ou ficha muda de setor (Agendamentos, Prospecção, Admissão, Auditoria, Jurídico, Negociações Bancárias, Administração Financeira ou Cobrança), a Ivi envia uma mensagem automática para o setor destinatário exibindo um sinalizador vermelho piscante no menu sobre o referido setor. Em envios manuais, colaboradores comuns escrevem apenas para seus grupos de usuários, enquanto Administradores podem enviar para todos os grupos e todas as unidades.',
          category: 'mensageria_regras',
          sourceChannel: 'system_doc',
          hitCount: 18,
          updatedByName: 'Instrutor Ivi',
          active: true,
        },
        {
          scope: 'system_doc',
          moduleKey: 'config',
          questionPattern: 'Como funcionam a importação Excel, a Migração de Arquivos (64GB) e o Backup Automático no Google Drive?',
          answerTemplate:
            'Em Governança > Configurações & SQL, Modelos & Importação Excel gera planilhas modelo e importa dados de forma isolada ou integrada para Clientes, Admissões e Financeiro. A aba Migração R2 (64GB) envia arquivos para o cofre da Invicta e os vincula automaticamente aos dossiês de Clientes e Admissões. Já Backup & Restore (Nuvem) compacta os dados e envia para a pasta escolhida no Google Drive conforme os dias da semana e horário configurados na Tabela de Agendamento Automático.',
          category: 'governanca_tecnica',
          sourceChannel: 'system_doc',
          hitCount: 9,
          updatedByName: 'Instrutor Ivi',
          active: true,
        },
      ]);
    }

    if (needsCatalogRefresh) {
      await db
        .insert(systemSettings)
        .values({
          key: 'system_docs_catalog_version',
          value: { version: SYSTEM_DOCS_SEED_VERSION },
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: { version: SYSTEM_DOCS_SEED_VERSION }, updatedAt: new Date() },
        });
    }

    docsSeedDone = true;
  } catch (err) {
    console.warn('ensureSystemModuleDocsSeed warning:', err);
  }
}
