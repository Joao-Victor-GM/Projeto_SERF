// Cenário de teste: uma empresa "Ambos" (compra e vende), um fornecedor
// parceiro e um comprador parceiro, com pedidos em vários status.

const DIA = 86400000;
const atras = dias => new Date(Date.now() - dias * DIA).toISOString();

export const EMPRESA = {
    id: "00000000-0000-0000-0000-0000000000aa",
    email: "contato@ambos.com.br",
    metadados: { segmentacao_concluida: true, perfil: "Ambos" }
};

const UID_FORNECEDOR_PARCEIRO = "00000000-0000-0000-0000-0000000000bb";
const UID_COMPRADOR_PARCEIRO = "00000000-0000-0000-0000-0000000000cc";

const fornecedorPublico = (id, razao, fantasia) => ({
    id_fornecedor: id, razao_social: razao, nome_fantasia: fantasia, cidade: "Curitiba", estado: "PR", nicho: "Alimentos"
});

const FORN_MINHA = fornecedorPublico(1, "Atacadão Ambos LTDA", "Atacadão Ambos");
const FORN_PARCEIRO = fornecedorPublico(2, "Distribuidora Sul LTDA", "Distribuidora Sul");

function produto(id, fornecedor, nome, extras = {}) {
    return {
        id_produto: id,
        id_fornecedor: fornecedor.id_fornecedor,
        nome_produto: nome,
        descricao: `${nome} — embalagem atacado`,
        categoria: "Grãos",
        marca: "Marca Boa",
        preco_atacado: 25.5,
        quantidade_minima: 10,
        quantidade_estoque: 500,
        ativo: true,
        data_cadastro: atras(60),
        fornecedores: fornecedor,
        ...extras
    };
}

const PRODUTOS = [
    produto(10, FORN_MINHA, "Arroz Tipo 1 5kg"),
    produto(11, FORN_MINHA, "Feijão Carioca 1kg", { quantidade_estoque: 5 }),
    produto(20, FORN_PARCEIRO, "Açúcar Cristal 2kg"),
    produto(21, FORN_PARCEIRO, "Café Torrado 500g")
];

const COMPRADOR_MEU = { id_usuario: 1, nome_empresa: "Atacadão Ambos LTDA" };
const COMPRADOR_PARCEIRO = { id_usuario: 2, nome_empresa: "Mercado Bom Preço" };

function pedido(id, comprador, prod, status, diasAtras, extras = {}) {
    const quantidade = extras.quantidade ?? 20;
    const criado = atras(diasAtras);

    return {
        id_pedido: id,
        id_usuario: comprador.id_usuario,
        id_produto: prod.id_produto,
        quantidade,
        valor_unitario: prod.preco_atacado,
        valor_total: quantidade * prod.preco_atacado,
        status_pedido: status,
        observacao: null,
        data_pedido: criado,
        data_atualizacao: extras.data_atualizacao ?? criado,
        data_resposta: status === "PENDENTE" ? null : criado,
        data_envio: ["ENVIADO", "ENTREGUE"].includes(status) ? criado : null,
        data_entrega: status === "ENTREGUE" ? criado : null,
        data_cancelamento: status === "CANCELADO" ? criado : null,
        produtos: {
            id_produto: prod.id_produto,
            nome_produto: prod.nome_produto,
            categoria: prod.categoria,
            id_fornecedor: prod.id_fornecedor,
            fornecedores: prod.fornecedores
        },
        usuarios: comprador
    };
}

// Compras (eu compro do parceiro) e vendas (o parceiro compra de mim)
export const PEDIDOS = [
    pedido(101, COMPRADOR_MEU, PRODUTOS[2], "PENDENTE", 1),
    pedido(102, COMPRADOR_MEU, PRODUTOS[3], "CONFIRMADO", 5),
    pedido(103, COMPRADOR_MEU, PRODUTOS[2], "ENTREGUE", 20),
    pedido(104, COMPRADOR_MEU, PRODUTOS[3], "CANCELADO", 40),
    pedido(201, COMPRADOR_PARCEIRO, PRODUTOS[0], "PENDENTE", 2),
    pedido(202, COMPRADOR_PARCEIRO, PRODUTOS[1], "ENVIADO", 8),
    pedido(203, COMPRADOR_PARCEIRO, PRODUTOS[0], "ENTREGUE", 15),
    // Antigo e finalizado: fora de qualquer período do painel
    pedido(204, COMPRADOR_PARCEIRO, PRODUTOS[0], "ENTREGUE", 200)
];

export const MENSAGENS = [
    { id: "m1", id_pedido: 101, id_remetente: UID_FORNECEDOR_PARCEIRO, texto: "Recebemos seu pedido!", lida: false, data_envio: atras(0.5) },
    { id: "m2", id_pedido: 101, id_remetente: EMPRESA.id, texto: "Obrigado, aguardo a confirmação.", lida: true, data_envio: atras(0.4) },
    { id: "m3", id_pedido: 201, id_remetente: UID_COMPRADOR_PARCEIRO, texto: "Conseguem entregar sexta?", lida: false, data_envio: atras(1) }
];

// Formato achatado da view pedidos_painel (migration 014)
function paraPainel(p) {
    return {
        id_pedido: p.id_pedido,
        id_usuario: p.id_usuario,
        id_produto: p.id_produto,
        quantidade: p.quantidade,
        valor_unitario: p.valor_unitario,
        valor_total: p.valor_total,
        status_pedido: p.status_pedido,
        observacao: p.observacao,
        data_pedido: p.data_pedido,
        data_atualizacao: p.data_atualizacao,
        data_resposta: p.data_resposta,
        data_envio: p.data_envio,
        data_entrega: p.data_entrega,
        data_cancelamento: p.data_cancelamento,
        nome_produto: p.produtos.nome_produto,
        categoria: p.produtos.categoria,
        id_fornecedor: p.produtos.id_fornecedor,
        fornecedor_razao_social: p.produtos.fornecedores.razao_social,
        fornecedor_nome_fantasia: p.produtos.fornecedores.nome_fantasia,
        fornecedor_cidade: p.produtos.fornecedores.cidade,
        fornecedor_estado: p.produtos.fornecedores.estado,
        comprador_nome: p.usuarios.nome_empresa,
        sou_comprador: p.id_usuario === COMPRADOR_MEU.id_usuario,
        sou_fornecedor: p.produtos.id_fornecedor === FORN_MINHA.id_fornecedor
    };
}

// Linhas da view "alertas" (migration 015) coerentes com o cenário acima:
// 2 urgentes + 1 atenção (contador do menu = 3) e 2 informativos.
export const ALERTAS = [
    { codigo: "RESPONDER_PEDIDO", severidade: "urgente", papel: "fornecedor", id_pedido: 201, id_produto: 10,
      parceiro_nome: "Mercado Bom Preço", produto_nome: "Arroz Tipo 1 5kg", valor: 510, quantidade: 20,
      referencia: atras(2), vencimento: null, detalhe: null },
    { codigo: "SEM_ESTOQUE", severidade: "urgente", papel: "fornecedor", id_pedido: null, id_produto: 11,
      parceiro_nome: null, produto_nome: "Feijão Carioca 1kg", valor: null, quantidade: 5,
      referencia: null, vencimento: null, detalhe: "10" },
    { codigo: "PAGAR_PEDIDO", severidade: "atencao", papel: "comprador", id_pedido: 102, id_produto: 21,
      parceiro_nome: "Distribuidora Sul", produto_nome: "Café Torrado 500g", valor: 510, quantidade: 20,
      referencia: atras(5), vencimento: null, detalhe: null },
    { codigo: "MENSAGENS", severidade: "info", papel: "comprador", id_pedido: 101, id_produto: 20,
      parceiro_nome: "Distribuidora Sul", produto_nome: "Açúcar Cristal 2kg", valor: null, quantidade: null,
      referencia: atras(0.5), vencimento: null, detalhe: "1" },
    { codigo: "MENSAGENS", severidade: "info", papel: "fornecedor", id_pedido: 201, id_produto: 10,
      parceiro_nome: "Mercado Bom Preço", produto_nome: "Arroz Tipo 1 5kg", valor: null, quantidade: null,
      referencia: atras(1), vencimento: null, detalhe: "1" }
];

// Linhas da view "oportunidades" (migration 016). O produto 20 aparece como
// RECOMPRA e MENOR_PRECO: o radar deve mostrar só a mais relevante.
const oportunidadeProduto = (tipo, relevancia, prod, extras = {}) => ({
    tipo, relevancia, id_pedido: null, id_produto: prod.id_produto, id_fornecedor: prod.id_fornecedor,
    produto_nome: prod.nome_produto, categoria: prod.categoria, preco: prod.preco_atacado,
    quantidade_minima: prod.quantidade_minima, quantidade_estoque: prod.quantidade_estoque,
    fornecedor_nome: prod.fornecedores.nome_fantasia, cidade: "Curitiba", estado: "PR",
    parceiro_nome: null, valor: null, quantidade: null, referencia: atras(3), detalhe: null, ...extras
});

export const OPORTUNIDADES = [
    { tipo: "NOVA_DEMANDA", relevancia: 4, id_pedido: 201, id_produto: 10, id_fornecedor: 1,
      produto_nome: "Arroz Tipo 1 5kg", categoria: "Grãos", preco: 25.5, quantidade_minima: null,
      quantidade_estoque: null, fornecedor_nome: null, cidade: null, estado: null,
      parceiro_nome: "Mercado Bom Preço", valor: 510, quantidade: 20, referencia: atras(2), detalhe: null },
    oportunidadeProduto("NOVO_PRODUTO", 3, PRODUTOS[3], { detalhe: "seu nicho", referencia: atras(1) }),
    oportunidadeProduto("RECOMPRA", 3, PRODUTOS[2], { referencia: atras(20), detalhe: "2" }),
    oportunidadeProduto("MENOR_PRECO", 2, PRODUTOS[2], { detalhe: "3" }),
    { tipo: "FORNECEDOR_NICHO", relevancia: 1, id_pedido: null, id_produto: null, id_fornecedor: 3,
      produto_nome: null, categoria: null, preco: 8.9, quantidade_minima: null, quantidade_estoque: null,
      fornecedor_nome: "Laticínios Serra", cidade: "Ponta Grossa", estado: "PR",
      parceiro_nome: null, valor: null, quantidade: null, referencia: atras(30), detalhe: "4" }
];

// Tabelas novas a cada teste (o mock altera as linhas em POST/PATCH)
export function criarTabelas() {
    const copia = valor => structuredClone(valor);

    return {
        usuarios: [{
            id_usuario: 1, auth_user_id: EMPRESA.id, nome_empresa: "Atacadão Ambos LTDA",
            cnpj: "12345678000190", email: EMPRESA.email, telefone: "41999990000",
            nicho: "Alimentos", status_cadastro: "PENDENTE_VALIDACAO", data_cadastro: atras(90)
        }],
        fornecedores: [{
            id_fornecedor: 1, auth_user_id: EMPRESA.id, razao_social: "Atacadão Ambos LTDA",
            nome_fantasia: "Atacadão Ambos", cnpj: "12345678000190", email: EMPRESA.email,
            telefone: "41999990000", cidade: "Curitiba", estado: "PR", nicho: "Alimentos",
            status_cadastro: "PENDENTE", data_cadastro: atras(90)
        }],
        produtos: copia(PRODUTOS),
        pedidos: copia(PEDIDOS),
        pedidos_painel: PEDIDOS.map(paraPainel),
        mensagens_pedidos: copia(MENSAGENS),
        pagamentos: [],
        notas_fiscais: [],
        favoritos_fornecedores: [],
        alertas: copia(ALERTAS),
        oportunidades: copia(OPORTUNIDADES),
        fornecedores_publicos: [FORN_MINHA, FORN_PARCEIRO],
        fornecedores_vitrine: [FORN_MINHA, FORN_PARCEIRO].map(f => ({
            ...f, homologado: false, data_cadastro: atras(90), produtos_ativos: 2,
            categorias: ["Grãos"], menor_preco: 25.5, pedidos_entregues: 1, pedidos_cancelados: 0,
            clientes_atendidos: 1, taxa_entrega: 1, tempo_resposta_horas: 2, prazo_entrega_dias: 3
        }))
    };
}
