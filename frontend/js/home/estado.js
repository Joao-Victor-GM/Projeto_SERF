/* ==========================================================
   S.E.R.F. — HOME / ESTADO.JS
   Dependências, cache de pedidos, estado da interface, elementos
   e busca de pedidos no Supabase (seções 01–06).

   A Home é dividida em scripts clássicos que compartilham o escopo
   global, carregados nesta ordem (todos com defer):
     estado.js → dashboard.js → eventos.js → chat.js →
     pedido-modal.js → tempo-real.js → inicializacao.js
   Só inicializacao.js executa algo ao carregar (iniciarHome()).
   ========================================================== */

"use strict";


/* ==========================================================
   01 — DEPENDÊNCIAS COMPARTILHADAS
   Dados: SERFDados (js/dados/); regras: SERFPainel (js/dominio/);
   formatação e escape de texto vêm de utils.js.
   ========================================================== */

const {
    escaparHTML,
    formatarMoeda,
    formatarData,
    dataLocalISO,
    tempoRelativo
} = window.SERFUtils;


/* ==========================================================
   02 — DADOS DOS PEDIDOS
   Pedidos reais carregados do banco e empresa autenticada.
   ========================================================== */

// Pedidos do Supabase já convertidos para o formato da interface.
let pedidosCache = [];

// Índice id → pedido (busca O(1) em Realtime, conversas, links e tabela).
// Sempre atualizado junto com pedidosCache (ver indexarPedidos).
let pedidosPorId = new Map();

function indexarPedidos() {
    pedidosPorId = new Map(pedidosCache.map(pedido => [pedido.id, pedido]));
}

function obterPedido(idPedido) {
    return pedidosPorId.get(idPedido);
}

// Cadastros da empresa logada nas tabelas usuarios e fornecedores.
// Uma empresa com perfil "Ambos" possui os dois identificadores.
const empresaLogada = {
    authUserId: null, // UUID do Supabase Auth (remetente das mensagens)
    idUsuario: null,
    idFornecedor: null,
    nome: null
};

// Status do banco → categoria de filtros/KPIs + rótulo (definido em utils.js)
const STATUS_BANCO = window.SERFUtils.STATUS_PEDIDO;

// Próximos status que o fornecedor pode aplicar (definido em utils.js,
// espelho do trigger do banco).
const TRANSICOES_STATUS = window.SERFUtils.TRANSICOES_STATUS;

// Conversas do chat agrupadas por pedido (tabela mensagens_pedidos).
// idPedido → { idPedido, ultimoTexto, ultimaData, ultimaMinha, naoLidas }
let conversasCache = new Map();


/* ==========================================================
   03 — ESTADO DA INTERFACE
   Armazena o modo ativo, filtros, pesquisa e carregamento.
   ========================================================== */

const estado = {
    modo: "comprar",
    periodo: 30,
    status: "todos",
    empresa: "todas",
    busca: "",
    indicador: null,
    limiteTabela: 100,          // linhas desenhadas na tabela (LIMITE_LINHAS_TABELA)
    carregamento: "carregando", // "carregando" | "ok" | "erro"
    mensagemErro: ""
};


/* ==========================================================
   04 — ELEMENTOS HTML
   Centraliza referências aos componentes da Home.
   ========================================================== */

const elementos = {
    sidebar: document.getElementById("sidebar"),
    menuToggle: document.getElementById("menuToggle"),
    empresaAtiva: document.getElementById("empresaAtiva"),
    modoSwitch: document.getElementById("modoSwitch"),
    menuProdutosLabel: document.getElementById("menuProdutosLabel"),
    btnAcaoPrincipal: document.getElementById("btnAcaoPrincipal"),
    filtroPeriodo: document.getElementById("filtroPeriodo"),
    filtroStatus: document.getElementById("filtroStatus"),
    filtroEmpresa: document.getElementById("filtroEmpresa"),
    btnLimparFiltros: document.getElementById("btnLimparFiltros"),
    buscaGlobal: document.getElementById("buscaGlobal"),
    pedidosTableBody: document.getElementById("pedidosTableBody"),
    btnMaisPedidos: document.getElementById("btnMaisPedidos"),
    totalPedidos: document.getElementById("totalPedidos"),
    kpiAbertos: document.getElementById("kpiAbertos"),
    kpiRespostas: document.getElementById("kpiRespostas"),
    kpiMensagens: document.getElementById("kpiMensagens"),
    kpiConcluidos: document.getElementById("kpiConcluidos"),
    mensagensCount: document.getElementById("mensagensCount"),
    conversasRecentes: document.getElementById("conversasRecentes"),
    radarLista: document.getElementById("radarLista"),
    graficoProducao: document.getElementById("graficoProducao"),
    graficoPeriodo: document.getElementById("graficoPeriodo"),
    btnTodasMensagens: document.getElementById("btnTodasMensagens"),
    btnPerfil: document.getElementById("btnPerfil"),

    // Modal de detalhes do pedido + chat
    modalPedido: document.getElementById("modalPedido"),
    modalPedidoTitulo: document.getElementById("modalPedidoTitulo"),
    modalPedidoSubtitulo: document.getElementById("modalPedidoSubtitulo"),
    btnFecharModalPedido: document.getElementById("btnFecharModalPedido"),
    pedidoResumo: document.getElementById("pedidoResumo"),
    chatParceiroNome: document.getElementById("chatParceiroNome"),
    chatStatus: document.getElementById("chatStatus"),
    chatMensagens: document.getElementById("chatMensagens"),
    formChat: document.getElementById("formChat"),
    chatInput: document.getElementById("chatInput"),
    btnEnviarMensagem: document.getElementById("btnEnviarMensagem"),

    // Gestão de status pelo fornecedor
    formStatusPedido: document.getElementById("formStatusPedido"),
    selectNovoStatus: document.getElementById("selectNovoStatus"),
    btnAtualizarStatus: document.getElementById("btnAtualizarStatus"),
    statusPedidoAjuda: document.getElementById("statusPedidoAjuda"),

    // Cancelamento pelo comprador
    pedidoCancelamento: document.getElementById("pedidoCancelamento"),
    cancelamentoAjuda: document.getElementById("cancelamentoAjuda"),
    btnCancelarPedido: document.getElementById("btnCancelarPedido"),

    // Pagamento e nota fiscal do pedido
    pedidoPagamento: document.getElementById("pedidoPagamento"),
    pedidoNota: document.getElementById("pedidoNota")
};


/* ==========================================================
   05 — FUNÇÕES AUXILIARES
   Cálculos de datas e contexto da negociação.
   ========================================================== */

// Empresa do outro lado da negociação, conforme o modo ativo:
// ao comprar, o fornecedor; ao vender, o comprador.
function parceiroDoPedido(pedido) {
    return pedido.parceiros[estado.modo];
}


/* ==========================================================
   06 — BUSCA DE PEDIDOS NO SUPABASE
   SELECT em pedidos com JOIN em produtos → fornecedores
   (quem vende) e usuarios (quem compra).
   ========================================================== */

// Localiza os cadastros da empresa autenticada (mesma lógica do catalogo.js).
async function identificarEmpresaLogada() {

    // Consulta compartilhada com catalogo.js (utils.js mantém em cache).
    // Erro aqui interrompe a carga: sem saber quem é a empresa, os pedidos
    // não podem ser separados entre os modos Comprar e Vender.
    const empresa = await window.SERFUtils.obterEmpresaLogada();

    if (!empresa) {
        console.info("[SERF:Home] Usuário sem ID de autenticação.");
        return;
    }

    empresaLogada.authUserId = empresa.authUserId;
    empresaLogada.idUsuario = empresa.idUsuario;
    empresaLogada.idFornecedor = empresa.idFornecedor;
    empresaLogada.nome = empresa.nome;
}

// Converte um registro do banco para o formato usado pela interface.
function normalizarPedido(registro) {

    // Leitura canônica (pedidos.js); aqui só o que é da Home.
    const pedido = window.SERFPedidos.normalizar(registro);

    // Modos em que o pedido aparece (empresa "Ambos" pode ter os dois).
    pedido.modos = [];
    if (pedido.souComprador) pedido.modos.push("comprar");
    if (pedido.souFornecedor) pedido.modos.push("vender");

    pedido.parceiros = {
        comprar: { id: `f-${pedido.idFornecedor}`, nome: pedido.fornecedorNome },
        vender: { id: `u-${pedido.idUsuario}`, nome: pedido.compradorNome }
    };

    return pedido;
}

// Atualiza status e datas a partir de uma linha de pedidos
// (carga inicial, resposta do UPDATE ou evento do Realtime).
function aplicarStatusPedido(pedido, registro) {

    const statusBanco = registro.status_pedido;
    const status = STATUS_BANCO[statusBanco] || {
        categoria: "aberto",
        rotulo: statusBanco
    };

    if (registro.data_atualizacao) {
        pedido.atualizadoEm = dataLocalISO(registro.data_atualizacao);
    }

    pedido.statusBanco = statusBanco;
    pedido.status = status.categoria;
    pedido.statusRotulo = status.rotulo;

    // Conclusão pela data real de entrega (sem a 008, cai na última atualização)
    pedido.concluidoEm = status.categoria === "concluido"
        ? dataLocalISO(registro.data_entrega || registro.data_atualizacao) || pedido.atualizadoEm
        : null;

    // Pedido pendente ainda não foi respondido pelo fornecedor.
    pedido.aguardandoResposta = statusBanco === "PENDENTE";

    // Motivo informado no cancelamento (migration 013)
    if (registro.motivo_cancelamento !== undefined) {
        pedido.motivoCancelamento = registro.motivo_cancelamento;
    }
}

// A empresa logada é a compradora deste pedido?
// (papéis calculados pelo banco na view pedidos_painel)
function souCompradorDoPedido(pedido) {
    return pedido.souComprador === true;
}

// A empresa logada é a fornecedora do produto deste pedido?
function souFornecedorDoPedido(pedido) {
    return pedido.souFornecedor === true;
}

// UPDATE do status na tabela pedidos (permitido ao fornecedor pelo RLS).
function atualizarStatusPedido(idPedido, novoStatus) {
    return SERFDados.pedidos.atualizarStatus(idPedido, novoStatus);
}

// Recorte feito NO SERVIDOR: pedidos movimentados dentro do maior período
// do filtro (90 dias) + todos os pedidos ainda em andamento (radar, KPIs).
// Os filtros de período/status/empresa/busca continuam no navegador.
const LIMITE_PEDIDOS_PAINEL = 1000;

function janelaDoPainelDias() {
    const opcoes = [...(elementos.filtroPeriodo?.options || [])].map(opcao => Number(opcao.value));
    return Math.max(90, ...opcoes.filter(Number.isFinite));
}

async function buscarPedidosSupabase() {

    await identificarEmpresaLogada();

    const desde = new Date(Date.now() - janelaDoPainelDias() * 86400000).toISOString();
    const linhas = await SERFDados.pedidos.consultarPainel({ desde, limite: LIMITE_PEDIDOS_PAINEL });

    if (linhas.length >= LIMITE_PEDIDOS_PAINEL) {
        console.warn(`[SERF:Home] Limite de ${LIMITE_PEDIDOS_PAINEL} pedidos atingido: os mais antigos não aparecem no painel.`);
    }

    pedidosCache = linhas.map(normalizarPedido);
    indexarPedidos();

    console.info(`[SERF:Home] ${pedidosCache.length} pedido(s) carregado(s) do Supabase.`);

    return pedidosCache;
}

// Pedido fora do recorte do painel (ex.: link antigo da página Empresas).
async function buscarPedidoPorId(idPedido) {

    let linha;
    try {
        linha = await SERFDados.pedidos.buscarPorId(idPedido);
    } catch (erro) {
        console.warn(`[SERF:Home] Falha ao buscar o pedido #${idPedido}:`, erro);
        return null;
    }

    if (!linha) return null;

    const pedido = normalizarPedido(linha);
    pedidosCache.push(pedido);
    pedidosPorId.set(pedido.id, pedido);

    return pedido;
}
