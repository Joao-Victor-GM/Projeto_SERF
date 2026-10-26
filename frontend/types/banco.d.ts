// GERADO por scripts/gerar-tipos.mjs a partir de supabase/migrations.
// Não edite à mão: rode `npm run tipos` depois de criar uma migration.

export type Json = string | number | boolean | null | { [chave: string]: Json | undefined } | Json[];

export interface Database {
    public: {
        Tables: {
            categorias: {
                Row: {
                    nome: string;
                    ordem: number;
                };
                Insert: {
                    nome: string;
                    ordem?: number;
                };
                Update: {
                    nome?: string;
                    ordem?: number;
                };
                Relationships: [];
            };
            configuracao_identidade: {
                Row: {
                    id: boolean;
                    modo: string;
                };
                Insert: {
                    id?: boolean;
                    modo?: string;
                };
                Update: {
                    id?: boolean;
                    modo?: string;
                };
                Relationships: [];
            };
            configuracao_nfe: {
                Row: {
                    id: boolean;
                    modo: string;
                    atualizado_em: string;
                };
                Insert: {
                    id?: boolean;
                    modo?: string;
                    atualizado_em?: string;
                };
                Update: {
                    id?: boolean;
                    modo?: string;
                    atualizado_em?: string;
                };
                Relationships: [];
            };
            configuracao_pagamentos: {
                Row: {
                    id: boolean;
                    modo: string;
                    atualizado_em: string;
                };
                Insert: {
                    id?: boolean;
                    modo?: string;
                    atualizado_em?: string;
                };
                Update: {
                    id?: boolean;
                    modo?: string;
                    atualizado_em?: string;
                };
                Relationships: [];
            };
            cotacoes: {
                Row: {
                    id_cotacao: number;
                    id_usuario: number;
                    comprador_nome: string;
                    titulo: string;
                    descricao: string | null;
                    categoria: string;
                    quantidade: number;
                    unidade: string;
                    preco_alvo: number | null;
                    valida_ate: string;
                    status: string;
                    id_proposta_aceita: number | null;
                    criada_em: string;
                    encerrada_em: string | null;
                };
                Insert: {
                    id_usuario: number;
                    comprador_nome: string;
                    titulo: string;
                    descricao?: string | null;
                    categoria: string;
                    quantidade: number;
                    unidade?: string;
                    preco_alvo?: number | null;
                    valida_ate: string;
                    status?: string;
                    id_proposta_aceita?: number | null;
                    criada_em?: string;
                    encerrada_em?: string | null;
                };
                Update: {
                    id_usuario?: number;
                    comprador_nome?: string;
                    titulo?: string;
                    descricao?: string | null;
                    categoria?: string;
                    quantidade?: number;
                    unidade?: string;
                    preco_alvo?: number | null;
                    valida_ate?: string;
                    status?: string;
                    id_proposta_aceita?: number | null;
                    criada_em?: string;
                    encerrada_em?: string | null;
                };
                Relationships: [];
            };
            erros_navegador: {
                Row: {
                    id: number;
                    auth_user_id: string;
                    criado_em: string;
                    ultimo_em: string;
                    quantidade: number;
                    pagina: string;
                    mensagem: string;
                    origem: string | null;
                    pilha: string | null;
                    navegador: string | null;
                    versao: string | null;
                };
                Insert: {
                    auth_user_id?: string;
                    criado_em?: string;
                    ultimo_em?: string;
                    quantidade?: number;
                    pagina: string;
                    mensagem: string;
                    origem?: string | null;
                    pilha?: string | null;
                    navegador?: string | null;
                    versao?: string | null;
                };
                Update: {
                    auth_user_id?: string;
                    criado_em?: string;
                    ultimo_em?: string;
                    quantidade?: number;
                    pagina?: string;
                    mensagem?: string;
                    origem?: string | null;
                    pilha?: string | null;
                    navegador?: string | null;
                    versao?: string | null;
                };
                Relationships: [];
            };
            favoritos_fornecedores: {
                Row: {
                    id_favorito: number;
                    auth_user_id: string;
                    id_fornecedor: number;
                    data_criacao: string;
                };
                Insert: {
                    auth_user_id?: string;
                    id_fornecedor: number;
                    data_criacao?: string;
                };
                Update: {
                    auth_user_id?: string;
                    id_fornecedor?: number;
                    data_criacao?: string;
                };
                Relationships: [];
            };
            fornecedores: {
                Row: {
                    id_fornecedor: number;
                    auth_user_id: string | null;
                    razao_social: string;
                    nome_fantasia: string | null;
                    cnpj: string;
                    email: string;
                    telefone: string | null;
                    cidade: string | null;
                    estado: string | null;
                    status_cadastro: string;
                    data_cadastro: string;
                    ativo: boolean;
                    nicho: string | null;
                    homologacao_motivo: string | null;
                    homologacao_em: string | null;
                    regime_tributario: string;
                    logo_url: string | null;
                };
                Insert: {
                    auth_user_id?: string | null;
                    razao_social: string;
                    nome_fantasia?: string | null;
                    cnpj: string;
                    email: string;
                    telefone?: string | null;
                    cidade?: string | null;
                    estado?: string | null;
                    status_cadastro?: string;
                    data_cadastro?: string;
                    ativo?: boolean;
                    nicho?: string | null;
                    homologacao_motivo?: string | null;
                    homologacao_em?: string | null;
                    regime_tributario?: string;
                    logo_url?: string | null;
                };
                Update: {
                    auth_user_id?: string | null;
                    razao_social?: string;
                    nome_fantasia?: string | null;
                    cnpj?: string;
                    email?: string;
                    telefone?: string | null;
                    cidade?: string | null;
                    estado?: string | null;
                    status_cadastro?: string;
                    data_cadastro?: string;
                    ativo?: boolean;
                    nicho?: string | null;
                    homologacao_motivo?: string | null;
                    homologacao_em?: string | null;
                    regime_tributario?: string;
                    logo_url?: string | null;
                };
                Relationships: [];
            };
            identidade_empresas: {
                Row: {
                    auth_user_id: string;
                    cnpj: string;
                    verificada_em: string | null;
                    metodo: string | null;
                    carencia_ate: string | null;
                    contestada_em: string | null;
                    codigo_hash: string | null;
                    codigo_expira_em: string | null;
                    tentativas: number;
                    email_destino: string | null;
                    envios: Json;
                };
                Insert: {
                    auth_user_id: string;
                    cnpj: string;
                    verificada_em?: string | null;
                    metodo?: string | null;
                    carencia_ate?: string | null;
                    contestada_em?: string | null;
                    codigo_hash?: string | null;
                    codigo_expira_em?: string | null;
                    tentativas?: number;
                    email_destino?: string | null;
                    envios?: Json;
                };
                Update: {
                    auth_user_id?: string;
                    cnpj?: string;
                    verificada_em?: string | null;
                    metodo?: string | null;
                    carencia_ate?: string | null;
                    contestada_em?: string | null;
                    codigo_hash?: string | null;
                    codigo_expira_em?: string | null;
                    tentativas?: number;
                    email_destino?: string | null;
                    envios?: Json;
                };
                Relationships: [];
            };
            mensagens_pedidos: {
                Row: {
                    id: string;
                    id_pedido: number;
                    id_remetente: string | null;
                    texto: string;
                    lida: boolean;
                    data_envio: string;
                };
                Insert: {
                    id?: string;
                    id_pedido: number;
                    id_remetente?: string | null;
                    texto: string;
                    lida?: boolean;
                    data_envio?: string;
                };
                Update: {
                    id?: string;
                    id_pedido?: number;
                    id_remetente?: string | null;
                    texto?: string;
                    lida?: boolean;
                    data_envio?: string;
                };
                Relationships: [];
            };
            notas_fiscais: {
                Row: {
                    id_nota: number;
                    id_pedido: number;
                    id_fornecedor: number;
                    numero: number | null;
                    serie: number;
                    chave_acesso: string | null;
                    protocolo: string | null;
                    status: string;
                    natureza_operacao: string;
                    cfop: string;
                    emitente_razao_social: string;
                    emitente_cnpj: string;
                    emitente_cidade: string | null;
                    emitente_uf: string | null;
                    destinatario_nome: string;
                    destinatario_cnpj: string;
                    produto_codigo: number;
                    produto_descricao: string;
                    quantidade: number;
                    valor_unitario: number;
                    valor_total: number;
                    aliquota_icms: number;
                    valor_icms: number;
                    forma_pagamento: string | null;
                    emitida_por: string | null;
                    data_emissao: string;
                    data_cancelamento: string | null;
                    motivo_cancelamento: string | null;
                    provedor: string;
                    provedor_ref: string | null;
                    url_danfe: string | null;
                    url_xml: string | null;
                    mensagem_sefaz: string | null;
                };
                Insert: {
                    id_pedido: number;
                    id_fornecedor: number;
                    numero?: number | null;
                    serie?: number;
                    chave_acesso?: string | null;
                    protocolo?: string | null;
                    status?: string;
                    natureza_operacao?: string;
                    cfop?: string;
                    emitente_razao_social: string;
                    emitente_cnpj: string;
                    emitente_cidade?: string | null;
                    emitente_uf?: string | null;
                    destinatario_nome: string;
                    destinatario_cnpj: string;
                    produto_codigo: number;
                    produto_descricao: string;
                    quantidade: number;
                    valor_unitario: number;
                    valor_total: number;
                    aliquota_icms?: number;
                    valor_icms: number;
                    forma_pagamento?: string | null;
                    emitida_por?: string | null;
                    data_emissao?: string;
                    data_cancelamento?: string | null;
                    motivo_cancelamento?: string | null;
                    provedor?: string;
                    provedor_ref?: string | null;
                    url_danfe?: string | null;
                    url_xml?: string | null;
                    mensagem_sefaz?: string | null;
                };
                Update: {
                    id_pedido?: number;
                    id_fornecedor?: number;
                    numero?: number | null;
                    serie?: number;
                    chave_acesso?: string | null;
                    protocolo?: string | null;
                    status?: string;
                    natureza_operacao?: string;
                    cfop?: string;
                    emitente_razao_social?: string;
                    emitente_cnpj?: string;
                    emitente_cidade?: string | null;
                    emitente_uf?: string | null;
                    destinatario_nome?: string;
                    destinatario_cnpj?: string;
                    produto_codigo?: number;
                    produto_descricao?: string;
                    quantidade?: number;
                    valor_unitario?: number;
                    valor_total?: number;
                    aliquota_icms?: number;
                    valor_icms?: number;
                    forma_pagamento?: string | null;
                    emitida_por?: string | null;
                    data_emissao?: string;
                    data_cancelamento?: string | null;
                    motivo_cancelamento?: string | null;
                    provedor?: string;
                    provedor_ref?: string | null;
                    url_danfe?: string | null;
                    url_xml?: string | null;
                    mensagem_sefaz?: string | null;
                };
                Relationships: [];
            };
            notificacoes: {
                Row: {
                    id: number;
                    auth_user_id: string;
                    tipo: string;
                    dados: Json;
                    chave: string;
                    quantidade: number;
                    criada_em: string;
                    atualizada_em: string;
                    lida_em: string | null;
                };
                Insert: {
                    auth_user_id: string;
                    tipo: string;
                    dados?: Json;
                    chave: string;
                    quantidade?: number;
                    criada_em?: string;
                    atualizada_em?: string;
                    lida_em?: string | null;
                };
                Update: {
                    auth_user_id?: string;
                    tipo?: string;
                    dados?: Json;
                    chave?: string;
                    quantidade?: number;
                    criada_em?: string;
                    atualizada_em?: string;
                    lida_em?: string | null;
                };
                Relationships: [];
            };
            notificacoes_email: {
                Row: {
                    id: number;
                    auth_user_id: string;
                    email: string;
                    tipo: string;
                    dados: Json;
                    chave: string;
                    criada_em: string;
                    reservada_em: string | null;
                    enviada_em: string | null;
                    tentativas: number;
                    ultimo_erro: string | null;
                };
                Insert: {
                    auth_user_id: string;
                    email: string;
                    tipo: string;
                    dados?: Json;
                    chave: string;
                    criada_em?: string;
                    reservada_em?: string | null;
                    enviada_em?: string | null;
                    tentativas?: number;
                    ultimo_erro?: string | null;
                };
                Update: {
                    auth_user_id?: string;
                    email?: string;
                    tipo?: string;
                    dados?: Json;
                    chave?: string;
                    criada_em?: string;
                    reservada_em?: string | null;
                    enviada_em?: string | null;
                    tentativas?: number;
                    ultimo_erro?: string | null;
                };
                Relationships: [];
            };
            pagamentos: {
                Row: {
                    id_pagamento: number;
                    id_pedido: number;
                    metodo: string;
                    status: string;
                    valor: number;
                    parcelas: number;
                    prazo_dias: number | null;
                    vencimento: string | null;
                    codigo_pix: string | null;
                    linha_digitavel: string | null;
                    cartao_bandeira: string | null;
                    cartao_final: string | null;
                    transacao_id: string | null;
                    motivo_recusa: string | null;
                    data_criacao: string;
                    data_atualizacao: string;
                    data_pagamento: string | null;
                    provedor: string;
                    provedor_pagamento_id: string | null;
                    qr_code_base64: string | null;
                    pix_expira_em: string | null;
                };
                Insert: {
                    id_pedido: number;
                    metodo: string;
                    status?: string;
                    valor: number;
                    parcelas?: number;
                    prazo_dias?: number | null;
                    vencimento?: string | null;
                    codigo_pix?: string | null;
                    linha_digitavel?: string | null;
                    cartao_bandeira?: string | null;
                    cartao_final?: string | null;
                    transacao_id?: string | null;
                    motivo_recusa?: string | null;
                    data_criacao?: string;
                    data_atualizacao?: string;
                    data_pagamento?: string | null;
                    provedor?: string;
                    provedor_pagamento_id?: string | null;
                    qr_code_base64?: string | null;
                    pix_expira_em?: string | null;
                };
                Update: {
                    id_pedido?: number;
                    metodo?: string;
                    status?: string;
                    valor?: number;
                    parcelas?: number;
                    prazo_dias?: number | null;
                    vencimento?: string | null;
                    codigo_pix?: string | null;
                    linha_digitavel?: string | null;
                    cartao_bandeira?: string | null;
                    cartao_final?: string | null;
                    transacao_id?: string | null;
                    motivo_recusa?: string | null;
                    data_criacao?: string;
                    data_atualizacao?: string;
                    data_pagamento?: string | null;
                    provedor?: string;
                    provedor_pagamento_id?: string | null;
                    qr_code_base64?: string | null;
                    pix_expira_em?: string | null;
                };
                Relationships: [];
            };
            pedidos: {
                Row: {
                    id_pedido: number;
                    id_usuario: number;
                    id_produto: number;
                    quantidade: number;
                    valor_unitario: number;
                    valor_total: number | null;
                    status_pedido: string;
                    observacao: string | null;
                    data_pedido: string;
                    data_atualizacao: string;
                    data_resposta: string | null;
                    data_envio: string | null;
                    data_entrega: string | null;
                    data_cancelamento: string | null;
                    motivo_cancelamento: string | null;
                    id_compra: string | null;
                    id_proposta: number | null;
                };
                Insert: {
                    id_usuario: number;
                    id_produto: number;
                    quantidade: number;
                    valor_unitario: number;
                    status_pedido?: string;
                    observacao?: string | null;
                    data_pedido?: string;
                    data_atualizacao?: string;
                    data_resposta?: string | null;
                    data_envio?: string | null;
                    data_entrega?: string | null;
                    data_cancelamento?: string | null;
                    motivo_cancelamento?: string | null;
                    id_compra?: string | null;
                    id_proposta?: number | null;
                };
                Update: {
                    id_usuario?: number;
                    id_produto?: number;
                    quantidade?: number;
                    valor_unitario?: number;
                    status_pedido?: string;
                    observacao?: string | null;
                    data_pedido?: string;
                    data_atualizacao?: string;
                    data_resposta?: string | null;
                    data_envio?: string | null;
                    data_entrega?: string | null;
                    data_cancelamento?: string | null;
                    motivo_cancelamento?: string | null;
                    id_compra?: string | null;
                    id_proposta?: number | null;
                };
                Relationships: [];
            };
            pedidos_historico_status: {
                Row: {
                    id_historico: number;
                    id_pedido: number;
                    status_anterior: string | null;
                    status_novo: string;
                    alterado_por: string | null;
                    data_alteracao: string;
                };
                Insert: {
                    id_pedido: number;
                    status_anterior?: string | null;
                    status_novo: string;
                    alterado_por?: string | null;
                    data_alteracao?: string;
                };
                Update: {
                    id_pedido?: number;
                    status_anterior?: string | null;
                    status_novo?: string;
                    alterado_por?: string | null;
                    data_alteracao?: string;
                };
                Relationships: [];
            };
            preferencias_notificacao: {
                Row: {
                    auth_user_id: string;
                    receber_email: boolean;
                    atualizado_em: string;
                };
                Insert: {
                    auth_user_id?: string;
                    receber_email?: boolean;
                    atualizado_em?: string;
                };
                Update: {
                    auth_user_id?: string;
                    receber_email?: boolean;
                    atualizado_em?: string;
                };
                Relationships: [];
            };
            produtos: {
                Row: {
                    id_produto: number;
                    id_fornecedor: number;
                    nome_produto: string;
                    descricao: string | null;
                    categoria: string | null;
                    marca: string | null;
                    preco_atacado: number;
                    quantidade_minima: number;
                    quantidade_estoque: number;
                    data_cadastro: string;
                    ativo: boolean;
                    ncm: string | null;
                    unidade_fiscal: string;
                };
                Insert: {
                    id_fornecedor: number;
                    nome_produto: string;
                    descricao?: string | null;
                    categoria?: string | null;
                    marca?: string | null;
                    preco_atacado: number;
                    quantidade_minima: number;
                    quantidade_estoque?: number;
                    data_cadastro?: string;
                    ativo?: boolean;
                    ncm?: string | null;
                    unidade_fiscal?: string;
                };
                Update: {
                    id_fornecedor?: number;
                    nome_produto?: string;
                    descricao?: string | null;
                    categoria?: string | null;
                    marca?: string | null;
                    preco_atacado?: number;
                    quantidade_minima?: number;
                    quantidade_estoque?: number;
                    data_cadastro?: string;
                    ativo?: boolean;
                    ncm?: string | null;
                    unidade_fiscal?: string;
                };
                Relationships: [];
            };
            propostas: {
                Row: {
                    id_proposta: number;
                    id_cotacao: number;
                    id_fornecedor: number;
                    id_produto: number;
                    fornecedor_nome: string;
                    produto_nome: string;
                    preco_unitario: number;
                    prazo_entrega_dias: number;
                    observacao: string | null;
                    status: string;
                    criada_em: string;
                    atualizada_em: string;
                };
                Insert: {
                    id_cotacao: number;
                    id_fornecedor: number;
                    id_produto: number;
                    fornecedor_nome: string;
                    produto_nome: string;
                    preco_unitario: number;
                    prazo_entrega_dias: number;
                    observacao?: string | null;
                    status?: string;
                    criada_em?: string;
                    atualizada_em?: string;
                };
                Update: {
                    id_cotacao?: number;
                    id_fornecedor?: number;
                    id_produto?: number;
                    fornecedor_nome?: string;
                    produto_nome?: string;
                    preco_unitario?: number;
                    prazo_entrega_dias?: number;
                    observacao?: string | null;
                    status?: string;
                    criada_em?: string;
                    atualizada_em?: string;
                };
                Relationships: [];
            };
            segmentos_interesse: {
                Row: {
                    auth_user_id: string;
                    categoria: string;
                    criado_em: string;
                };
                Insert: {
                    auth_user_id?: string;
                    categoria: string;
                    criado_em?: string;
                };
                Update: {
                    auth_user_id?: string;
                    categoria?: string;
                    criado_em?: string;
                };
                Relationships: [];
            };
            usuarios: {
                Row: {
                    id_usuario: number;
                    auth_user_id: string | null;
                    nome_empresa: string;
                    cnpj: string;
                    nome_responsavel: string;
                    email: string;
                    telefone: string | null;
                    status_cadastro: string;
                    data_cadastro: string;
                    ativo: boolean;
                    nicho: string | null;
                    auth_id: string | null;
                    cep: string | null;
                    logradouro: string | null;
                    numero_endereco: string | null;
                    complemento: string | null;
                    bairro: string | null;
                    municipio: string | null;
                    uf: string | null;
                    inscricao_estadual: string | null;
                    logo_url: string | null;
                };
                Insert: {
                    auth_user_id?: string | null;
                    nome_empresa: string;
                    cnpj: string;
                    nome_responsavel: string;
                    email: string;
                    telefone?: string | null;
                    status_cadastro?: string;
                    data_cadastro?: string;
                    ativo?: boolean;
                    nicho?: string | null;
                    auth_id?: string | null;
                    cep?: string | null;
                    logradouro?: string | null;
                    numero_endereco?: string | null;
                    complemento?: string | null;
                    bairro?: string | null;
                    municipio?: string | null;
                    uf?: string | null;
                    inscricao_estadual?: string | null;
                    logo_url?: string | null;
                };
                Update: {
                    auth_user_id?: string | null;
                    nome_empresa?: string;
                    cnpj?: string;
                    nome_responsavel?: string;
                    email?: string;
                    telefone?: string | null;
                    status_cadastro?: string;
                    data_cadastro?: string;
                    ativo?: boolean;
                    nicho?: string | null;
                    auth_id?: string | null;
                    cep?: string | null;
                    logradouro?: string | null;
                    numero_endereco?: string | null;
                    complemento?: string | null;
                    bairro?: string | null;
                    municipio?: string | null;
                    uf?: string | null;
                    inscricao_estadual?: string | null;
                    logo_url?: string | null;
                };
                Relationships: [];
            };
        };
        Views: {
            alertas: {
                Row: {
                    codigo: string | null;
                    severidade: string | null;
                    papel: string | null;
                    id_pedido: number | null;
                    id_produto: number | null;
                    parceiro_nome: string | null;
                    produto_nome: string | null;
                    valor: number | null;
                    quantidade: number | null;
                    referencia: string | null;
                    vencimento: string | null;
                    detalhe: string | null;
                };
                Relationships: [];
            };
            erros_resumo: {
                Row: {
                    mensagem: string | null;
                    pagina: string | null;
                    ocorrencias: number | null;
                    usuarios: number | null;
                    primeira_vez: string | null;
                    ultima_vez: string | null;
                    origem: string | null;
                    navegador: string | null;
                };
                Relationships: [];
            };
            fornecedores_publicos: {
                Row: {
                    id_fornecedor: number | null;
                    razao_social: string | null;
                    nome_fantasia: string | null;
                    cidade: string | null;
                    estado: string | null;
                    nicho: string | null;
                    logo_url: string | null;
                };
                Relationships: [];
            };
            fornecedores_vitrine: {
                Row: {
                    id_fornecedor: number | null;
                    razao_social: string | null;
                    nome_fantasia: string | null;
                    cidade: string | null;
                    estado: string | null;
                    nicho: string | null;
                    homologado: boolean | null;
                    data_cadastro: string | null;
                    produtos_ativos: number | null;
                    categorias: string[] | null;
                    menor_preco: number | null;
                    pedidos_entregues: number | null;
                    pedidos_cancelados: number | null;
                    clientes_atendidos: number | null;
                    taxa_entrega: number | null;
                    tempo_resposta_horas: number | null;
                    prazo_entrega_dias: number | null;
                    logo_url: string | null;
                };
                Relationships: [];
            };
            oportunidades: {
                Row: {
                    tipo: string | null;
                    relevancia: number | null;
                    id_pedido: number | null;
                    id_produto: number | null;
                    id_fornecedor: number | null;
                    produto_nome: string | null;
                    categoria: string | null;
                    preco: number | null;
                    quantidade_minima: number | null;
                    quantidade_estoque: number | null;
                    fornecedor_nome: string | null;
                    cidade: string | null;
                    estado: string | null;
                    parceiro_nome: string | null;
                    valor: number | null;
                    quantidade: number | null;
                    referencia: string | null;
                    detalhe: string | null;
                };
                Relationships: [];
            };
            pedidos_painel: {
                Row: {
                    id_pedido: number | null;
                    id_usuario: number | null;
                    id_produto: number | null;
                    quantidade: number | null;
                    valor_unitario: number | null;
                    valor_total: number | null;
                    status_pedido: string | null;
                    observacao: string | null;
                    motivo_cancelamento: string | null;
                    data_pedido: string | null;
                    data_atualizacao: string | null;
                    data_resposta: string | null;
                    data_envio: string | null;
                    data_entrega: string | null;
                    data_cancelamento: string | null;
                    nome_produto: string | null;
                    categoria: string | null;
                    id_fornecedor: number | null;
                    fornecedor_razao_social: string | null;
                    fornecedor_nome_fantasia: string | null;
                    fornecedor_cidade: string | null;
                    fornecedor_estado: string | null;
                    comprador_nome: string | null;
                    sou_comprador: boolean | null;
                    sou_fornecedor: boolean | null;
                    id_compra: string | null;
                };
                Relationships: [];
            };
        };
        Functions: {
            aceitar_proposta: {
                Args: { p_id_proposta: number };
                Returns: number;
            };
            atualizar_segmentacao_usuario: {
                Args: { p_perfil: string; p_nicho: string };
                Returns: string;
            };
            cancelar_cotacao: {
                Args: { p_id_cotacao: number };
                Returns: Json;
            };
            cancelar_nota_fiscal: {
                Args: { p_id_pedido: number; p_motivo: string };
                Returns: Database["public"]["Tables"]["notas_fiscais"]["Row"];
            };
            cancelar_pedido_comprador: {
                Args: { p_id_pedido: number; p_motivo?: string };
                Returns: Database["public"]["Tables"]["pedidos"]["Row"];
            };
            categoria_oficial: {
                Args: { p_texto: string };
                Returns: string;
            };
            chave_categoria: {
                Args: { p_texto: string };
                Returns: string;
            };
            confirmar_identidade: {
                Args: { p_codigo: string };
                Returns: string;
            };
            confirmar_pagamento_simulado: {
                Args: { p_id_pedido: number; p_cartao_final?: string; p_cartao_bandeira?: string };
                Returns: Database["public"]["Tables"]["pagamentos"]["Row"];
            };
            cotacao_e_minha: {
                Args: { p_id_cotacao: number };
                Returns: boolean;
            };
            criar_compra: {
                Args: { p_itens: Json; p_observacao?: string };
                Returns: Json[];
            };
            definir_segmentos: {
                Args: { p_categorias: string[] };
                Returns: string[];
            };
            emitir_nota_fiscal: {
                Args: { p_id_pedido: number };
                Returns: Database["public"]["Tables"]["notas_fiscais"]["Row"];
            };
            enviar_proposta: {
                Args: { p_id_cotacao: number; p_id_produto: number; p_preco_unitario: number; p_prazo_entrega_dias: number; p_observacao?: string };
                Returns: Database["public"]["Tables"]["propostas"]["Row"];
            };
            exportar_meus_dados: {
                Args: Record<PropertyKey, never>;
                Returns: Json;
            };
            fornecedor_do_produto: {
                Args: { p_id_produto: number };
                Returns: number;
            };
            fornecedores_do_nicho: {
                Args: { p_nicho: string };
                Returns: Json[];
            };
            gerar_chave_nfe_simulada: {
                Args: { p_uf: string; p_cnpj: string; p_serie: number; p_numero: number };
                Returns: string;
            };
            gerar_linha_boleto_simulada: {
                Args: { p_valor: number; p_vencimento: string };
                Returns: string;
            };
            gerar_pix_simulado: {
                Args: { p_valor: number; p_id_pedido: number };
                Returns: string;
            };
            hash_codigo_identidade: {
                Args: { p_codigo: string; p_uid: string };
                Returns: string;
            };
            ids_meus_compradores: {
                Args: Record<PropertyKey, never>;
                Returns: number[];
            };
            ids_meus_pedidos: {
                Args: Record<PropertyKey, never>;
                Returns: number[];
            };
            ids_meus_produtos: {
                Args: Record<PropertyKey, never>;
                Returns: number[];
            };
            ids_produtos_comprados: {
                Args: Record<PropertyKey, never>;
                Returns: number[];
            };
            iniciar_pagamento: {
                Args: { p_id_pedido: number; p_metodo: string; p_parcelas?: number; p_prazo_dias?: number };
                Returns: Database["public"]["Tables"]["pagamentos"]["Row"];
            };
            marcar_notificacoes_lidas: {
                Args: Record<PropertyKey, never>;
                Returns: number;
            };
            meu_id_fornecedor: {
                Args: Record<PropertyKey, never>;
                Returns: number;
            };
            meu_id_usuario: {
                Args: Record<PropertyKey, never>;
                Returns: number;
            };
            meus_pedidos_em_andamento: {
                Args: Record<PropertyKey, never>;
                Returns: Json[];
            };
            nfe_modo: {
                Args: Record<PropertyKey, never>;
                Returns: string;
            };
            nfe_ref_do_pedido: {
                Args: { p_id_pedido: number };
                Returns: string;
            };
            pagamentos_modo: {
                Args: Record<PropertyKey, never>;
                Returns: string;
            };
            participa_do_pedido: {
                Args: { p_id_pedido: number };
                Returns: boolean;
            };
            preparar_cancelamento_nfe: {
                Args: { p_id_pedido: number; p_motivo: string };
                Returns: string;
            };
            preparar_nfe: {
                Args: { p_id_pedido: number };
                Returns: Json;
            };
            preparar_pix: {
                Args: { p_id_pedido: number };
                Returns: Json;
            };
            primeiros_passos: {
                Args: Record<PropertyKey, never>;
                Returns: Json;
            };
            propus_na_cotacao: {
                Args: { p_id_cotacao: number };
                Returns: boolean;
            };
            publicar_cotacao: {
                Args: { p_titulo: string; p_categoria: string; p_quantidade: number; p_unidade?: string; p_descricao?: string; p_preco_alvo?: number; p_dias_validade?: number };
                Returns: Database["public"]["Tables"]["cotacoes"]["Row"];
            };
            responder_pagamento_prazo: {
                Args: { p_id_pedido: number; p_aprovar: boolean; p_motivo?: string };
                Returns: Database["public"]["Tables"]["pagamentos"]["Row"];
            };
            retirar_proposta: {
                Args: { p_id_cotacao: number };
                Returns: Json;
            };
        };
        Enums: Record<string, never>;
        CompositeTypes: Record<string, never>;
    };
}
