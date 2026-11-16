export interface FormContextRoutine {
  menuId: string;
  label: string;
  module: string;
  targetTypes: Array<"modal" | "grid">;
  entityType: string;
  availableVariablePrefixes: string[];
  description: string;
}

export interface FormVariableItem {
  key: string;
  label: string;
  token: string;
}

export interface FormVariableCategory {
  id: string;
  category: string;
  prefix: string;
  items: FormVariableItem[];
}

export const FORM_CONTEXT_REGISTRY: FormContextRoutine[] = [
  {
    "menuId": "com_admissao",
    "label": "Admissão",
    "module": "Comercial",
    "targetTypes": [
      "modal",
      "grid"
    ],
    "entityType": "admission",
    "availableVariablePrefixes": [
      "cliente",
      "admissao",
      "banco",
      "colaborador",
      "empresa",
      "modalidade",
      "recalculo",
      "serie",
      "geral"
    ],
    "description": "Formulários disponíveis na tela de Admissão (grid e modal de detalhes)"
  },
  {
    "menuId": "com_negociacao",
    "label": "Negociação Comercial",
    "module": "Comercial",
    "targetTypes": [
      "modal",
      "grid"
    ],
    "entityType": "negotiation",
    "availableVariablePrefixes": [
      "cliente",
      "colaborador",
      "empresa",
      "geral"
    ],
    "description": "Formulários disponíveis na tela de Negociação Comercial"
  },
  {
    "menuId": "cad_clientes",
    "label": "Clientes",
    "module": "Cadastros",
    "targetTypes": [
      "modal",
      "grid"
    ],
    "entityType": "client",
    "availableVariablePrefixes": [
      "cliente",
      "empresa",
      "geral"
    ],
    "description": "Formulários disponíveis no cadastro de Clientes"
  },
  {
    "menuId": "cad_colaboradores",
    "label": "Colaboradores",
    "module": "Cadastros",
    "targetTypes": [
      "modal"
    ],
    "entityType": "collaborator",
    "availableVariablePrefixes": [
      "colaborador",
      "empresa",
      "geral"
    ],
    "description": "Formulários disponíveis no cadastro de Colaboradores"
  },
  {
    "menuId": "juridico",
    "label": "Jurídico",
    "module": "Atendimento",
    "targetTypes": [
      "modal",
      "grid"
    ],
    "entityType": "legal",
    "availableVariablePrefixes": [
      "cliente",
      "colaborador",
      "empresa",
      "geral"
    ],
    "description": "Formulários disponíveis na tela Jurídica"
  },
  {
    "menuId": "fin_receber",
    "label": "Contas a Receber",
    "module": "Financeiro",
    "targetTypes": [
      "grid"
    ],
    "entityType": "financial_receivable",
    "availableVariablePrefixes": [
      "cliente",
      "empresa",
      "portador",
      "tipo_documento",
      "geral"
    ],
    "description": "Formulários disponíveis na tela de Contas a Receber"
  },
  {
    "menuId": "fin_pagar",
    "label": "Contas a Pagar",
    "module": "Financeiro",
    "targetTypes": [
      "grid"
    ],
    "entityType": "financial_payable",
    "availableVariablePrefixes": [
      "empresa",
      "portador",
      "tipo_documento",
      "geral"
    ],
    "description": "Formulários disponíveis na tela de Contas a Pagar"
  },
  {
    "menuId": "fin_negociacao",
    "label": "Negociação Financeira",
    "module": "Financeiro",
    "targetTypes": [
      "modal",
      "grid"
    ],
    "entityType": "financial_negotiation",
    "availableVariablePrefixes": [
      "cliente",
      "empresa",
      "geral"
    ],
    "description": "Formulários disponíveis na tela de Negociação Financeira"
  },
  {
    "menuId": "fin_cob_coordenador",
    "label": "Cobrança - Coordenadores",
    "module": "Financeiro",
    "targetTypes": [
      "grid"
    ],
    "entityType": "collection",
    "availableVariablePrefixes": [
      "cliente",
      "colaborador",
      "admissao",
      "empresa",
      "geral"
    ],
    "description": "Formulários disponíveis na visão de Coordenadores de Cobrança"
  },
  {
    "menuId": "fin_cob_operacional",
    "label": "Cobrança - Operacional",
    "module": "Financeiro",
    "targetTypes": [
      "grid"
    ],
    "entityType": "collection",
    "availableVariablePrefixes": [
      "cliente",
      "colaborador",
      "admissao",
      "empresa",
      "geral"
    ],
    "description": "Formulários disponíveis na visão Operacional de Cobrança"
  },
  {
    "menuId": "auditoria",
    "label": "Auditoria",
    "module": "Atendimento",
    "targetTypes": [
      "modal",
      "grid"
    ],
    "entityType": "audit",
    "availableVariablePrefixes": [
      "cliente",
      "admissao",
      "banco",
      "colaborador",
      "empresa",
      "geral"
    ],
    "description": "Formulários disponíveis no painel de Auditoria"
  },
  {
    "menuId": "jur_processos",
    "label": "Acomp. Jurídico - Processos",
    "module": "Acompanhamento Jurídico",
    "targetTypes": [
      "grid",
      "modal"
    ],
    "entityType": "company_legal_process",
    "availableVariablePrefixes": [
      "cliente",
      "empresa",
      "colaborador",
      "processo",
      "geral"
    ],
    "description": "Formulários disponíveis na gestão de Processos Judiciais da Empresa"
  }
];

export const FORM_VARIABLE_CATEGORIES: FormVariableCategory[] = [
  {
    "id": "cliente",
    "category": "Cliente (Responsável)",
    "prefix": "cliente",
    "items": [
      {
        "key": "cliente.id",
        "label": "Código (ID)",
        "token": "{{cliente.id}}"
      },
      {
        "key": "cliente.nome",
        "label": "Nome / Razão Social",
        "token": "{{cliente.nome}}"
      },
      {
        "key": "cliente.tipo",
        "label": "Tipo (Física/Jurídica)",
        "token": "{{cliente.tipo}}"
      },
      {
        "key": "cliente.documento",
        "label": "CPF / CNPJ",
        "token": "{{cliente.documento}}"
      },
      {
        "key": "cliente.rg",
        "label": "RG",
        "token": "{{cliente.rg}}"
      },
      {
        "key": "cliente.email",
        "label": "E-mail",
        "token": "{{cliente.email}}"
      },
      {
        "key": "cliente.telefone",
        "label": "Telefone Principal",
        "token": "{{cliente.telefone}}"
      },
      {
        "key": "cliente.telefone2",
        "label": "Telefone Secundário",
        "token": "{{cliente.telefone2}}"
      },
      {
        "key": "cliente.profissao",
        "label": "Profissão",
        "token": "{{cliente.profissao}}"
      },
      {
        "key": "cliente.estado_civil",
        "label": "Estado Civil",
        "token": "{{cliente.estado_civil}}"
      },
      {
        "key": "cliente.data_nascimento",
        "label": "Data de Nascimento",
        "token": "{{cliente.data_nascimento}}"
      },
      {
        "key": "cliente.cep",
        "label": "CEP",
        "token": "{{cliente.cep}}"
      },
      {
        "key": "cliente.endereco",
        "label": "Endereço (Rua)",
        "token": "{{cliente.endereco}}"
      },
      {
        "key": "cliente.numero",
        "label": "Número",
        "token": "{{cliente.numero}}"
      },
      {
        "key": "cliente.complemento",
        "label": "Complemento",
        "token": "{{cliente.complemento}}"
      },
      {
        "key": "cliente.bairro",
        "label": "Bairro",
        "token": "{{cliente.bairro}}"
      },
      {
        "key": "cliente.cidade",
        "label": "Cidade",
        "token": "{{cliente.cidade}}"
      },
      {
        "key": "cliente.uf",
        "label": "Estado (UF)",
        "token": "{{cliente.uf}}"
      },
      {
        "key": "cliente.anotacoes",
        "label": "Anotações",
        "token": "{{cliente.anotacoes}}"
      }
    ]
  },
  {
    "id": "titular",
    "category": "Titular (quando aplicável)",
    "prefix": "titular",
    "items": [
      {
        "key": "titular.id",
        "label": "Código (ID)",
        "token": "{{titular.id}}"
      },
      {
        "key": "titular.nome",
        "label": "Nome / Razão Social",
        "token": "{{titular.nome}}"
      },
      {
        "key": "titular.tipo",
        "label": "Tipo (Física/Jurídica)",
        "token": "{{titular.tipo}}"
      },
      {
        "key": "titular.documento",
        "label": "CPF / CNPJ",
        "token": "{{titular.documento}}"
      },
      {
        "key": "titular.rg",
        "label": "RG",
        "token": "{{titular.rg}}"
      },
      {
        "key": "titular.email",
        "label": "E-mail",
        "token": "{{titular.email}}"
      },
      {
        "key": "titular.telefone",
        "label": "Telefone Principal",
        "token": "{{titular.telefone}}"
      },
      {
        "key": "titular.telefone2",
        "label": "Telefone Secundário",
        "token": "{{titular.telefone2}}"
      },
      {
        "key": "titular.profissao",
        "label": "Profissão",
        "token": "{{titular.profissao}}"
      },
      {
        "key": "titular.estado_civil",
        "label": "Estado Civil",
        "token": "{{titular.estado_civil}}"
      },
      {
        "key": "titular.data_nascimento",
        "label": "Data de Nascimento",
        "token": "{{titular.data_nascimento}}"
      },
      {
        "key": "titular.cep",
        "label": "CEP",
        "token": "{{titular.cep}}"
      },
      {
        "key": "titular.endereco",
        "label": "Endereço (Rua)",
        "token": "{{titular.endereco}}"
      },
      {
        "key": "titular.numero",
        "label": "Número",
        "token": "{{titular.numero}}"
      },
      {
        "key": "titular.complemento",
        "label": "Complemento",
        "token": "{{titular.complemento}}"
      },
      {
        "key": "titular.bairro",
        "label": "Bairro",
        "token": "{{titular.bairro}}"
      },
      {
        "key": "titular.cidade",
        "label": "Cidade",
        "token": "{{titular.cidade}}"
      },
      {
        "key": "titular.uf",
        "label": "Estado (UF)",
        "token": "{{titular.uf}}"
      },
      {
        "key": "titular.anotacoes",
        "label": "Anotações",
        "token": "{{titular.anotacoes}}"
      }
    ]
  },
  {
    "id": "colaborador",
    "category": "Colaborador",
    "prefix": "colaborador",
    "items": [
      {
        "key": "colaborador.id",
        "label": "Código (ID)",
        "token": "{{colaborador.id}}"
      },
      {
        "key": "colaborador.nome",
        "label": "Nome Completo",
        "token": "{{colaborador.nome}}"
      },
      {
        "key": "colaborador.cargo",
        "label": "Cargo / Função",
        "token": "{{colaborador.cargo}}"
      },
      {
        "key": "colaborador.email",
        "label": "E-mail",
        "token": "{{colaborador.email}}"
      },
      {
        "key": "colaborador.telefone",
        "label": "Telefone",
        "token": "{{colaborador.telefone}}"
      },
      {
        "key": "colaborador.whatsapp",
        "label": "É Whatsapp?",
        "token": "{{colaborador.whatsapp}}"
      },
      {
        "key": "colaborador.estado_civil",
        "label": "Estado Civil",
        "token": "{{colaborador.estado_civil}}"
      },
      {
        "key": "colaborador.data_nascimento",
        "label": "Data de Nascimento",
        "token": "{{colaborador.data_nascimento}}"
      },
      {
        "key": "colaborador.cep",
        "label": "CEP",
        "token": "{{colaborador.cep}}"
      },
      {
        "key": "colaborador.endereco",
        "label": "Endereço",
        "token": "{{colaborador.endereco}}"
      },
      {
        "key": "colaborador.numero",
        "label": "Número",
        "token": "{{colaborador.numero}}"
      },
      {
        "key": "colaborador.complemento",
        "label": "Complemento",
        "token": "{{colaborador.complemento}}"
      },
      {
        "key": "colaborador.bairro",
        "label": "Bairro",
        "token": "{{colaborador.bairro}}"
      },
      {
        "key": "colaborador.cidade",
        "label": "Cidade",
        "token": "{{colaborador.cidade}}"
      },
      {
        "key": "colaborador.uf",
        "label": "Estado (UF)",
        "token": "{{colaborador.uf}}"
      },
      {
        "key": "colaborador.anotacoes",
        "label": "Anotações",
        "token": "{{colaborador.anotacoes}}"
      }
    ]
  },
  {
    "id": "banco",
    "category": "Banco",
    "prefix": "banco",
    "items": [
      {
        "key": "banco.id",
        "label": "Código (ID)",
        "token": "{{banco.id}}"
      },
      {
        "key": "banco.nome",
        "label": "Nome do Banco",
        "token": "{{banco.nome}}"
      },
      {
        "key": "banco.febraban",
        "label": "Cód. Febraban",
        "token": "{{banco.febraban}}"
      },
      {
        "key": "banco.status",
        "label": "Status",
        "token": "{{banco.status}}"
      },
      {
        "key": "banco.anotacoes",
        "label": "Anotações",
        "token": "{{banco.anotacoes}}"
      }
    ]
  },
  {
    "id": "empresa",
    "category": "Empresa / Unidade",
    "prefix": "empresa",
    "items": [
      {
        "key": "empresa.razao_social",
        "label": "Razão Social",
        "token": "{{empresa.razao_social}}"
      },
      {
        "key": "empresa.cnpj",
        "label": "CNPJ",
        "token": "{{empresa.cnpj}}"
      },
      {
        "key": "empresa.telefone",
        "label": "Telefone Geral",
        "token": "{{empresa.telefone}}"
      },
      {
        "key": "empresa.email",
        "label": "E-mail Geral",
        "token": "{{empresa.email}}"
      },
      {
        "key": "empresa.cep",
        "label": "CEP",
        "token": "{{empresa.cep}}"
      },
      {
        "key": "empresa.endereco",
        "label": "Endereço",
        "token": "{{empresa.endereco}}"
      },
      {
        "key": "empresa.numero",
        "label": "Número",
        "token": "{{empresa.numero}}"
      },
      {
        "key": "empresa.complemento",
        "label": "Complemento",
        "token": "{{empresa.complemento}}"
      },
      {
        "key": "empresa.bairro",
        "label": "Bairro",
        "token": "{{empresa.bairro}}"
      },
      {
        "key": "empresa.cidade",
        "label": "Cidade",
        "token": "{{empresa.cidade}}"
      },
      {
        "key": "empresa.uf",
        "label": "Estado (UF)",
        "token": "{{empresa.uf}}"
      },
      {
        "key": "empresa.taxa_minima",
        "label": "Taxa Mínima",
        "token": "{{empresa.taxa_minima}}"
      }
    ]
  },
  {
    "id": "admissao",
    "category": "Admissão",
    "prefix": "admissao",
    "items": [
      {
        "key": "admissao.id",
        "label": "Código (ID)",
        "token": "{{admissao.id}}"
      },
      {
        "key": "admissao.data",
        "label": "Data",
        "token": "{{admissao.data}}"
      },
      {
        "key": "admissao.cliente",
        "label": "Nome do Cliente",
        "token": "{{admissao.cliente}}"
      },
      {
        "key": "admissao.contrato",
        "label": "Nº do Contrato",
        "token": "{{admissao.contrato}}"
      },
      {
        "key": "admissao.total_parcelas",
        "label": "Total de Parcelas",
        "token": "{{admissao.total_parcelas}}"
      },
      {
        "key": "admissao.parcelas_pagas",
        "label": "Parcelas Pagas",
        "token": "{{admissao.parcelas_pagas}}"
      },
      {
        "key": "admissao.parcelas_atraso",
        "label": "Parcelas em Atraso",
        "token": "{{admissao.parcelas_atraso}}"
      },
      {
        "key": "admissao.parcelas_a_pagar",
        "label": "Parcelas a Pagar",
        "token": "{{admissao.parcelas_a_pagar}}"
      },
      {
        "key": "admissao.valor_financiado",
        "label": "Valor Financiado",
        "token": "{{admissao.valor_financiado}}"
      },
      {
        "key": "admissao.valor_parcela",
        "label": "Valor da Parcela",
        "token": "{{admissao.valor_parcela}}"
      },
      {
        "key": "admissao.dia_vencimento",
        "label": "Dia de Vencimento",
        "token": "{{admissao.dia_vencimento}}"
      },
      {
        "key": "admissao.forma_pagamento",
        "label": "Forma de Pagamento",
        "token": "{{admissao.forma_pagamento}}"
      },
      {
        "key": "admissao.tipo_indicacao",
        "label": "Tipo de Indicação",
        "token": "{{admissao.tipo_indicacao}}"
      },
      {
        "key": "admissao.tipo_origem",
        "label": "Tipo de Origem",
        "token": "{{admissao.tipo_origem}}"
      },
      {
        "key": "admissao.status",
        "label": "Status",
        "token": "{{admissao.status}}"
      },
      {
        "key": "admissao.taxa_administrativa",
        "label": "Taxa Administrativa",
        "token": "{{admissao.taxa_administrativa}}"
      },
      {
        "key": "admissao.parcela1",
        "label": "1ª Parcela",
        "token": "{{admissao.parcela1}}"
      },
      {
        "key": "admissao.parcela2",
        "label": "Valor Boletos",
        "token": "{{admissao.parcela2}}"
      },
      {
        "key": "admissao.info1",
        "label": "Info Adicional 1",
        "token": "{{admissao.info1}}"
      },
      {
        "key": "admissao.info2",
        "label": "Info Adicional 2",
        "token": "{{admissao.info2}}"
      },
      {
        "key": "admissao.marca_veiculo",
        "label": "Marca do Veículo",
        "token": "{{admissao.marca_veiculo}}"
      },
      {
        "key": "admissao.modelo_veiculo",
        "label": "Modelo do Veículo",
        "token": "{{admissao.modelo_veiculo}}"
      },
      {
        "key": "admissao.cor_veiculo",
        "label": "Cor do Veículo",
        "token": "{{admissao.cor_veiculo}}"
      },
      {
        "key": "admissao.ano_veiculo",
        "label": "Ano do Veículo",
        "token": "{{admissao.ano_veiculo}}"
      },
      {
        "key": "admissao.placa",
        "label": "Placa do Veículo",
        "token": "{{admissao.placa}}"
      },
      {
        "key": "admissao.chassi",
        "label": "Chassi do Veículo",
        "token": "{{admissao.chassi}}"
      },
      {
        "key": "admissao.renavam",
        "label": "Renavam do Veículo",
        "token": "{{admissao.renavam}}"
      },
      {
        "key": "admissao.primeiro_vencimento",
        "label": "1ª Parcela Vencimento",
        "token": "{{admissao.primeiro_vencimento}}"
      }
    ]
  },
  {
    "id": "recalculo",
    "category": "Recálculo (Cenário)",
    "prefix": "recalculo",
    "items": [
      {
        "key": "recalculo.parcelas_a_pagar",
        "label": "Parcelas a Pagar",
        "token": "{{recalculo.parcelas_a_pagar}}"
      },
      {
        "key": "recalculo.divida_original",
        "label": "Dívida Original",
        "token": "{{recalculo.divida_original}}"
      },
      {
        "key": "recalculo.parcela",
        "label": "Parcela Recálculo",
        "token": "{{recalculo.parcela}}"
      },
      {
        "key": "recalculo.divida",
        "label": "Dívida Recálculo",
        "token": "{{recalculo.divida}}"
      },
      {
        "key": "recalculo.economia",
        "label": "Economia",
        "token": "{{recalculo.economia}}"
      },
      {
        "key": "recalculo.dia_vencimento",
        "label": "Dia de Vencimento",
        "token": "{{recalculo.dia_vencimento}}"
      }
    ]
  },
  {
    "id": "modalidade",
    "category": "Modalidade",
    "prefix": "modalidade",
    "items": [
      {
        "key": "modalidade.id",
        "label": "Código (ID)",
        "token": "{{modalidade.id}}"
      },
      {
        "key": "modalidade.tipo",
        "label": "Tipo",
        "token": "{{modalidade.tipo}}"
      },
      {
        "key": "modalidade.descricao",
        "label": "Descrição",
        "token": "{{modalidade.descricao}}"
      }
    ]
  },
  {
    "id": "produto",
    "category": "Produto",
    "prefix": "produto",
    "items": [
      {
        "key": "produto.id",
        "label": "Código (ID)",
        "token": "{{produto.id}}"
      },
      {
        "key": "produto.tipo",
        "label": "Tipo",
        "token": "{{produto.tipo}}"
      },
      {
        "key": "produto.descricao",
        "label": "Descrição",
        "token": "{{produto.descricao}}"
      },
      {
        "key": "produto.unidade",
        "label": "Unidade",
        "token": "{{produto.unidade}}"
      }
    ]
  },
  {
    "id": "servico",
    "category": "Serviço",
    "prefix": "servico",
    "items": [
      {
        "key": "servico.id",
        "label": "Código (ID)",
        "token": "{{servico.id}}"
      },
      {
        "key": "servico.nome",
        "label": "Nome",
        "token": "{{servico.nome}}"
      },
      {
        "key": "servico.duracao",
        "label": "Duração (min)",
        "token": "{{servico.duracao}}"
      },
      {
        "key": "servico.preco",
        "label": "Preço",
        "token": "{{servico.preco}}"
      }
    ]
  },
  {
    "id": "conta_bancaria",
    "category": "Conta Bancária",
    "prefix": "conta_bancaria",
    "items": [
      {
        "key": "conta_bancaria.id",
        "label": "Código (ID)",
        "token": "{{conta_bancaria.id}}"
      },
      {
        "key": "conta_bancaria.descricao",
        "label": "Descrição",
        "token": "{{conta_bancaria.descricao}}"
      },
      {
        "key": "conta_bancaria.tipo",
        "label": "Tipo de Conta",
        "token": "{{conta_bancaria.tipo}}"
      },
      {
        "key": "conta_bancaria.banco",
        "label": "Nome do Banco",
        "token": "{{conta_bancaria.banco}}"
      },
      {
        "key": "conta_bancaria.agencia",
        "label": "Agência",
        "token": "{{conta_bancaria.agencia}}"
      },
      {
        "key": "conta_bancaria.numero_conta",
        "label": "Nº da Conta",
        "token": "{{conta_bancaria.numero_conta}}"
      },
      {
        "key": "conta_bancaria.saldo_inicial",
        "label": "Saldo Inicial",
        "token": "{{conta_bancaria.saldo_inicial}}"
      },
      {
        "key": "conta_bancaria.saldo_atual",
        "label": "Saldo Atual",
        "token": "{{conta_bancaria.saldo_atual}}"
      },
      {
        "key": "conta_bancaria.status",
        "label": "Status",
        "token": "{{conta_bancaria.status}}"
      }
    ]
  },
  {
    "id": "tipo_documento",
    "category": "Tipo de Documento",
    "prefix": "tipo_documento",
    "items": [
      {
        "key": "tipo_documento.id",
        "label": "Código (ID)",
        "token": "{{tipo_documento.id}}"
      },
      {
        "key": "tipo_documento.descricao",
        "label": "Descrição",
        "token": "{{tipo_documento.descricao}}"
      },
      {
        "key": "tipo_documento.categoria",
        "label": "Categoria",
        "token": "{{tipo_documento.categoria}}"
      },
      {
        "key": "tipo_documento.fiscal",
        "label": "É Fiscal?",
        "token": "{{tipo_documento.fiscal}}"
      },
      {
        "key": "tipo_documento.status",
        "label": "Status",
        "token": "{{tipo_documento.status}}"
      }
    ]
  },
  {
    "id": "portador",
    "category": "Portador",
    "prefix": "portador",
    "items": [
      {
        "key": "portador.id",
        "label": "Código (ID)",
        "token": "{{portador.id}}"
      },
      {
        "key": "portador.codigo",
        "label": "Código",
        "token": "{{portador.codigo}}"
      },
      {
        "key": "portador.nome",
        "label": "Nome",
        "token": "{{portador.nome}}"
      },
      {
        "key": "portador.tipo",
        "label": "Tipo",
        "token": "{{portador.tipo}}"
      },
      {
        "key": "portador.status",
        "label": "Status",
        "token": "{{portador.status}}"
      }
    ]
  },
  {
    "id": "plano_contas",
    "category": "Plano de Contas",
    "prefix": "plano_contas",
    "items": [
      {
        "key": "plano_contas.id",
        "label": "Código (ID)",
        "token": "{{plano_contas.id}}"
      },
      {
        "key": "plano_contas.codigo",
        "label": "Código",
        "token": "{{plano_contas.codigo}}"
      },
      {
        "key": "plano_contas.nome",
        "label": "Nome",
        "token": "{{plano_contas.nome}}"
      },
      {
        "key": "plano_contas.tipo",
        "label": "Tipo",
        "token": "{{plano_contas.tipo}}"
      },
      {
        "key": "plano_contas.analitica",
        "label": "É Analítica?",
        "token": "{{plano_contas.analitica}}"
      }
    ]
  },
  {
    "id": "departamento",
    "category": "Departamento",
    "prefix": "departamento",
    "items": [
      {
        "key": "departamento.id",
        "label": "Código (ID)",
        "token": "{{departamento.id}}"
      },
      {
        "key": "departamento.codigo",
        "label": "Código",
        "token": "{{departamento.codigo}}"
      },
      {
        "key": "departamento.nome",
        "label": "Nome",
        "token": "{{departamento.nome}}"
      },
      {
        "key": "departamento.gerente",
        "label": "Gerente",
        "token": "{{departamento.gerente}}"
      },
      {
        "key": "departamento.status",
        "label": "Status",
        "token": "{{departamento.status}}"
      }
    ]
  },
  {
    "id": "serie",
    "category": "Série",
    "prefix": "serie",
    "items": [
      {
        "key": "serie.id",
        "label": "Código (ID)",
        "token": "{{serie.id}}"
      },
      {
        "key": "serie.sigla",
        "label": "Sigla",
        "token": "{{serie.sigla}}"
      },
      {
        "key": "serie.descricao",
        "label": "Descrição",
        "token": "{{serie.descricao}}"
      }
    ]
  },
  {
    "id": "processo",
    "category": "Processo Jurídico",
    "prefix": "processo",
    "items": [
      {
        "key": "processo.numero",
        "label": "Número do Processo",
        "token": "{{processo.numero}}"
      },
      {
        "key": "processo.vara",
        "label": "Vara",
        "token": "{{processo.vara}}"
      },
      {
        "key": "processo.comarca",
        "label": "Comarca / Jurisdição",
        "token": "{{processo.comarca}}"
      },
      {
        "key": "processo.tipo",
        "label": "Tipo",
        "token": "{{processo.tipo}}"
      },
      {
        "key": "processo.papel",
        "label": "Papel (Autor/Réu)",
        "token": "{{processo.papel}}"
      },
      {
        "key": "processo.status",
        "label": "Status",
        "token": "{{processo.status}}"
      },
      {
        "key": "processo.assunto",
        "label": "Assunto",
        "token": "{{processo.assunto}}"
      },
      {
        "key": "processo.valor_causa",
        "label": "Valor da Causa",
        "token": "{{processo.valor_causa}}"
      },
      {
        "key": "processo.valor_provisionado",
        "label": "Valor Provisionado",
        "token": "{{processo.valor_provisionado}}"
      },
      {
        "key": "processo.risco",
        "label": "Nível de Risco",
        "token": "{{processo.risco}}"
      },
      {
        "key": "processo.data_distribuicao",
        "label": "Data de Distribuição",
        "token": "{{processo.data_distribuicao}}"
      },
      {
        "key": "processo.parte_adversa",
        "label": "Parte Adversa",
        "token": "{{processo.parte_adversa}}"
      },
      {
        "key": "processo.documento_adversa",
        "label": "Documento da Parte Adversa",
        "token": "{{processo.documento_adversa}}"
      },
      {
        "key": "processo.advogado_adverso",
        "label": "Advogado Adverso",
        "token": "{{processo.advogado_adverso}}"
      },
      {
        "key": "processo.oab_adverso",
        "label": "OAB do Adverso",
        "token": "{{processo.oab_adverso}}"
      },
      {
        "key": "processo.advogado_responsavel",
        "label": "Advogado Responsável",
        "token": "{{processo.advogado_responsavel}}"
      }
    ]
  },
  {
    "id": "geral",
    "category": "Geral (Sistema)",
    "prefix": "geral",
    "items": [
      {
        "key": "data.hoje",
        "label": "Data Atual (DD/MM/AAAA)",
        "token": "{{data.hoje}}"
      },
      {
        "key": "data.extenso",
        "label": "Data por Extenso",
        "token": "{{data.extenso}}"
      },
      {
        "key": "data.dia_semana",
        "label": "Dia da Semana",
        "token": "{{data.dia_semana}}"
      },
      {
        "key": "data.mes",
        "label": "Mês Atual",
        "token": "{{data.mes}}"
      },
      {
        "key": "data.ano",
        "label": "Ano Atual",
        "token": "{{data.ano}}"
      },
      {
        "key": "hora.atual",
        "label": "Hora Atual",
        "token": "{{hora.atual}}"
      },
      {
        "key": "usuario.nome",
        "label": "Usuário Logado",
        "token": "{{usuario.nome}}"
      }
    ]
  }
];

export const TOTAL_FORM_VARIABLES = FORM_VARIABLE_CATEGORIES.reduce(
  (sum, c) => sum + c.items.length,
  0
);
