
/* ==========================================================
   S.E.R.F. — HOME.JS
   SCRUM-12: Dashboard e indicadores
   SCRUM-13: Navegação lateral

   Objetivo:
   Controlar a interface da Home com os dados reais do
   Supabase: pedidos (+ produtos, fornecedores, usuarios)
   e conversas do chat (mensagens_pedidos).
   ========================================================== */

"use strict";


/* ==========================================================
   01 — DEPENDÊNCIAS COMPARTILHADAS
   obterSupabase() vem de supabase-client.js;
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

    // Pagamento e nota fiscal do pedido
    pedidoPagamento: document.getElementById("pedidoPagamento"),
    pedidoNota: document.getElementById("pedidoNota")
};


/* ==========================================================
   05 — FUNÇÕES AUXILIARES
   Cálculos de datas e contexto da negociação.
   ========================================================== */

// Converte uma data ISO para o início do dia local.
function converterData(dataISO) {
    return new Date(`${dataISO}T00:00:00`);
}

// Calcula dias decorridos desde uma data.
function calcularDias(dataISO) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const data = converterData(dataISO);

    return Math.floor(
        (hoje.getTime() - data.getTime()) / 86400000
    );
}

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

    const produto = registro.produtos || {};
    const fornecedor = produto.fornecedores || {};
    const comprador = registro.usuarios || {};

    const data = dataLocalISO(registro.data_pedido);

    // Define em quais modos o pedido aparece para a empresa logada.
    const identificada =
        empresaLogada.idUsuario !== null ||
        empresaLogada.idFornecedor !== null;

    const modos = [];

    if (!identificada || registro.id_usuario === empresaLogada.idUsuario) {
        modos.push("comprar");
    }

    if (!identificada || produto.id_fornecedor === empresaLogada.idFornecedor) {
        modos.push("vender");
    }

    const pedido = {
        id: registro.id_pedido,
        modos,
        idFornecedor: produto.id_fornecedor ?? null,
        produto: produto.nome_produto || `Produto #${registro.id_produto}`,
        quantidade: registro.quantidade,
        valorUnitario: registro.valor_unitario,
        valorTotal: registro.valor_total,
        observacao: registro.observacao,

        // Datas por etapa preenchidas pelo banco (migration 008)
        criadoEm: data,
        atualizadoEm: data,

        parceiros: {
            comprar: {
                id: `f-${produto.id_fornecedor}`,
                nome: fornecedor.nome_fantasia || fornecedor.razao_social || "Fornecedor não encontrado"
            },
            vender: {
                id: `u-${registro.id_usuario}`,
                nome: comprador.nome_empresa || "Comprador não encontrado"
            }
        }
    };

    aplicarStatusPedido(pedido, registro);

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
}

// A empresa logada é a fornecedora do produto deste pedido?
function souFornecedorDoPedido(pedido) {
    return (
        empresaLogada.idFornecedor !== null &&
        pedido.idFornecedor === empresaLogada.idFornecedor
    );
}

// UPDATE do status na tabela pedidos (permitido ao fornecedor pelo RLS).
async function atualizarStatusPedido(idPedido, novoStatus) {

    const client = obterSupabase();

    if (!client) {
        throw new Error("Conexão com o banco de dados não estabelecida.");
    }

    const { data, error } = await client
        .from("pedidos")
        .update({ status_pedido: novoStatus })
        .eq("id_pedido", idPedido)
        .select("id_pedido, status_pedido, data_atualizacao, data_entrega")
        .maybeSingle();

    if (error) {
        throw error;
    }

    // Com RLS, um UPDATE sem permissão não gera erro: apenas não altera linhas.
    if (!data) {
        throw new Error("Você não tem permissão para alterar este pedido.");
    }

    return data;
}

async function buscarPedidosSupabase() {

    const client = obterSupabase();

    if (!client) {
        throw new Error("Conexão com o banco de dados não estabelecida.");
    }

    await identificarEmpresaLogada();

    const { data, error } = await client
        .from("pedidos")
        .select(`
            id_pedido,
            id_usuario,
            id_produto,
            quantidade,
            valor_unitario,
            valor_total,
            status_pedido,
            observacao,
            data_pedido,
            data_atualizacao,
            data_entrega,
            produtos (
                id_produto,
                nome_produto,
                id_fornecedor,
                fornecedores:fornecedores_publicos (
                    id_fornecedor,
                    razao_social,
                    nome_fantasia
                )
            ),
            usuarios (
                id_usuario,
                nome_empresa
            )
        `)
        .order("data_pedido", { ascending: false });

    if (error) {
        throw error;
    }

    pedidosCache = (data || []).map(normalizarPedido);

    console.info(`[SERF:Home] ${pedidosCache.length} pedido(s) carregado(s) do Supabase.`);

    return pedidosCache;
}


/* ==========================================================
   07 — ALTERNÂNCIA COMPRAR / VENDER
   Atualiza o contexto visual conforme o perfil.
   ========================================================== */

function alterarModo(novoModo) {

    // Impede a seleção de modos desconhecidos.
    if (!["comprar", "vender"].includes(novoModo)) {
        return;
    }

    estado.modo = novoModo;
    estado.indicador = null;

    // Atualiza os botões da barra superior.
    document.querySelectorAll(".modo-btn").forEach(botao => {
        const ativo = botao.dataset.mode === novoModo;

        botao.classList.toggle("active", ativo);
        botao.setAttribute("aria-pressed", String(ativo));
    });

    // Personaliza a navegação e a ação principal.
    if (novoModo === "comprar") {
        elementos.menuProdutosLabel.textContent = "Produtos";
        elementos.btnAcaoPrincipal.textContent = "+ Novo pedido";
    } else {
        elementos.menuProdutosLabel.textContent = "Meus produtos";
        elementos.btnAcaoPrincipal.textContent = "+ Cadastrar produto";
    }

    // Remove o destaque de indicadores anteriores.
    document.querySelectorAll(".metric-item").forEach(item => {
        item.classList.remove("active");
    });

    // As empresas parceiras mudam entre fornecedores e compradores.
    preencherFiltroEmpresas();
    atualizarDashboard();

    // Sincroniza o catálogo de produtos com o novo modo (Comprar vs Vender)
    if (window.CatalogoModule) {
        if (typeof window.CatalogoModule.atualizarVisibilidadeBotaoCadastro === "function") {
            window.CatalogoModule.atualizarVisibilidadeBotaoCadastro();
        }
        if (typeof window.CatalogoModule.buscarProdutos === "function") {
            window.CatalogoModule.buscarProdutos();
        }
    }
}


/* ==========================================================
   08 — FILTRAGEM DE PEDIDOS
   Aplica modo, período, status, empresa e pesquisa.
   ========================================================== */

// Pedidos do modo ativo, sem outros filtros.
function obterPedidosDoModo() {
    return pedidosCache.filter(pedido =>
        pedido.modos.includes(estado.modo)
    );
}

// Modo, período, empresa e busca.
// Base comum da tabela e dos indicadores.
function obterPedidosBase() {

    return obterPedidosDoModo().filter(pedido => {

        // Considera a criação do pedido no período escolhido.
        if (calcularDias(pedido.criadoEm) > estado.periodo) {
            return false;
        }

        const parceiro = parceiroDoPedido(pedido);

        // Filtra pela empresa parceira.
        if (
            estado.empresa !== "todas" &&
            parceiro.id !== estado.empresa
        ) {
            return false;
        }

        // Pesquisa por número, empresa ou produto.
        if (estado.busca) {
            const conteudo = [
                pedido.id,
                pedido.produto,
                parceiro.nome
            ].join(" ").toLowerCase();

            if (!conteudo.includes(estado.busca)) {
                return false;
            }
        }

        return true;
    });
}

function obterPedidosFiltrados() {

    return obterPedidosBase().filter(pedido => {

        // Filtra pelo status selecionado.
        if (
            estado.status !== "todos" &&
            pedido.status !== estado.status
        ) {
            return false;
        }

        // Filtro adicional ao clicar nos indicadores.
        if (estado.indicador === "abertos") {
            return pedido.status === "aberto";
        }

        if (estado.indicador === "respostas") {
            return pedido.aguardandoResposta;
        }

        if (estado.indicador === "concluidos") {
            return pedido.status === "concluido";
        }

        return true;
    });
}


/* ==========================================================
   09 — TABELA DE PEDIDOS
   Constrói as linhas a partir dos registros filtrados.
   ========================================================== */

// Linha única ocupando toda a tabela (carregando, erro, vazio).
function mensagemTabela(texto, cor = "") {
    elementos.pedidosTableBody.innerHTML = `
        <tr>
            <td colspan="6" class="empty-state"${cor ? ` style="color:${cor};"` : ""}>
                ${texto}
            </td>
        </tr>
    `;
}

function renderizarPedidos(pedidos) {

    if (estado.carregamento === "carregando") {
        elementos.totalPedidos.textContent = "Carregando...";
        mensagemTabela("Carregando pedidos do banco de dados...");
        return;
    }

    if (estado.carregamento === "erro") {
        elementos.totalPedidos.textContent = "0 pedidos";
        mensagemTabela(
            `<strong>Não foi possível carregar os pedidos.</strong><br>
             <small>${escaparHTML(estado.mensagemErro)}</small>`,
            "#DC2626"
        );
        return;
    }

    elementos.totalPedidos.textContent =
        `${pedidos.length} pedido${pedidos.length === 1 ? "" : "s"}`;

    // Exibe uma mensagem quando nenhum registro é encontrado.
    if (pedidos.length === 0) {
        mensagemTabela("Nenhum pedido encontrado para os filtros selecionados.");
        return;
    }

    // Ordena os pedidos pela última atualização.
    const ordenados = [...pedidos].sort((a, b) =>
        converterData(b.atualizadoEm) -
        converterData(a.atualizadoEm)
    );

    elementos.pedidosTableBody.innerHTML = ordenados.map(pedido => {

        const parceiro = parceiroDoPedido(pedido);

        return `
            <tr>
                <td>
                    <strong>#${pedido.id}</strong>
                </td>

                <td>
                    ${escaparHTML(parceiro.nome)}
                </td>

                <td>
                    ${escaparHTML(pedido.produto)}
                </td>

                <td>
                    <span class="order-status ${pedido.status}">
                        ${escaparHTML(pedido.statusRotulo)}
                    </span>
                </td>

                <td>
                    ${formatarData(pedido.atualizadoEm)}
                </td>

                <td>
                    <button
                        type="button"
                        class="table-action"
                        data-pedido="${pedido.id}"
                    >
                        Visualizar
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}


/* ==========================================================
   10 — INDICADORES KPI
   Calcula as métricas com os dados do modo selecionado.
   ========================================================== */

function atualizarIndicadores() {

    // Mantém período, empresa e busca nos indicadores.
    // O filtro de status é aplicado apenas à tabela.
    const pedidosBase = obterPedidosBase();

    const abertos = pedidosBase.filter(
        pedido => pedido.status === "aberto"
    ).length;

    const respostas = pedidosBase.filter(
        pedido => pedido.aguardandoResposta
    ).length;

    const concluidos = pedidosBase.filter(
        pedido => pedido.status === "concluido"
    ).length;

    // Total de mensagens não lidas nos pedidos do modo ativo.
    const mensagens = obterConversasDoModo()
        .reduce((total, conversa) => total + conversa.naoLidas, 0);

    const carregando = estado.carregamento === "carregando";

    elementos.kpiAbertos.textContent = carregando ? "…" : abertos;
    elementos.kpiRespostas.textContent = carregando ? "…" : respostas;
    elementos.kpiMensagens.textContent = carregando ? "…" : mensagens;
    elementos.kpiConcluidos.textContent = carregando ? "…" : concluidos;
    elementos.mensagensCount.textContent = mensagens;

    atualizarBadgesModo();
}


/* ==========================================================
   11 — FILTRO DE EMPRESAS
   Lista as empresas parceiras presentes nos pedidos do modo.
   ========================================================== */

function preencherFiltroEmpresas() {

    const empresas = new Map();

    obterPedidosDoModo().forEach(pedido => {
        const parceiro = parceiroDoPedido(pedido);
        empresas.set(parceiro.id, parceiro.nome);
    });

    // Descarta a seleção anterior se a empresa não existir no modo atual.
    if (!empresas.has(estado.empresa)) {
        estado.empresa = "todas";
    }

    elementos.filtroEmpresa.innerHTML = `
        <option value="todas">Todas as empresas</option>
    `;

    [...empresas.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
        .forEach(([id, nome]) => {
            const opcao = document.createElement("option");

            opcao.value = id;
            opcao.textContent = nome;

            elementos.filtroEmpresa.appendChild(opcao);
        });

    elementos.filtroEmpresa.value = estado.empresa;
}


/* ==========================================================
   12 — GRÁFICO DE PRODUÇÃO
   Representa pedidos criados e concluídos por semana.
   ========================================================== */

function renderizarGrafico() {

    const pedidos = obterPedidosDoModo();

    // Distribui o período selecionado em até seis faixas.
    const quantidadeFaixas = Math.min(
        6,
        Math.ceil(estado.periodo / 7)
    );

    const tamanhoFaixa = estado.periodo / quantidadeFaixas;

    const faixas = [];

    for (let indice = quantidadeFaixas - 1; indice >= 0; indice--) {

        const inicio = indice * tamanhoFaixa;
        const fim = (indice + 1) * tamanhoFaixa;

        const criados = pedidos.filter(pedido => {
            const dias = calcularDias(pedido.criadoEm);

            return dias >= inicio && dias < fim;
        }).length;

        const concluidos = pedidos.filter(pedido => {
            if (!pedido.concluidoEm) return false;

            const dias = calcularDias(pedido.concluidoEm);

            return dias >= inicio && dias < fim;
        }).length;

        faixas.push({
            rotulo: `${Math.ceil(inicio)}–${Math.ceil(fim)}d`,
            criados,
            concluidos
        });
    }

    const maiorValor = Math.max(
        1,
        ...faixas.flatMap(faixa => [
            faixa.criados,
            faixa.concluidos
        ])
    );

    // Gráfico simples em HTML, sem bibliotecas externas.
    elementos.graficoProducao.innerHTML = `
        <div style="width:100%;">

            <div style="
                display:flex;
                gap:18px;
                margin-bottom:20px;
                font-size:11px;
                color:#66788A;
            ">
                <span>🔵 Criados</span>
                <span>🟠 Concluídos</span>
            </div>

            <div style="
                display:grid;
                grid-template-columns:repeat(${quantidadeFaixas}, minmax(0,1fr));
                gap:12px;
                align-items:end;
                height:170px;
            ">
                ${faixas.map(faixa => `
                    <div style="
                        display:flex;
                        flex-direction:column;
                        align-items:center;
                        justify-content:flex-end;
                        height:100%;
                        gap:8px;
                    ">
                        <div style="
                            display:flex;
                            align-items:flex-end;
                            justify-content:center;
                            gap:5px;
                            width:100%;
                            height:135px;
                        ">
                            <div
                                title="${faixa.criados} pedidos criados"
                                style="
                                    width:22px;
                                    max-width:40%;
                                    height:${Math.max(
                                        3,
                                        faixa.criados / maiorValor * 100
                                    )}%;
                                    background:#1268B3;
                                    border-radius:3px 3px 0 0;
                                "
                            ></div>

                            <div
                                title="${faixa.concluidos} pedidos concluídos"
                                style="
                                    width:22px;
                                    max-width:40%;
                                    height:${Math.max(
                                        3,
                                        faixa.concluidos / maiorValor * 100
                                    )}%;
                                    background:#F47A20;
                                    border-radius:3px 3px 0 0;
                                "
                            ></div>
                        </div>

                        <small style="
                            font-size:10px;
                            color:#66788A;
                        ">
                            ${faixa.rotulo}
                        </small>
                    </div>
                `).join("")}
            </div>

        </div>
    `;

    elementos.graficoPeriodo.textContent =
        `Pedidos criados e concluídos — últimos ${estado.periodo} dias`;
}


/* ==========================================================
   13 — RADAR DE PEDIDOS
   Destaca registros sem resposta ou sem movimentação.
   ========================================================== */

function renderizarRadar() {

    if (estado.carregamento !== "ok") {
        elementos.radarLista.innerHTML = `
            <p class="empty-state">
                ${estado.carregamento === "carregando"
                    ? "Analisando pedidos..."
                    : "Radar indisponível: pedidos não carregados."}
            </p>
        `;

        return;
    }

    const pedidos = obterPedidosDoModo().filter(pedido =>
        pedido.status !== "concluido" &&
        pedido.status !== "cancelado"
    );

    const alertas = [];

    pedidos.forEach(pedido => {

        const parceiro = parceiroDoPedido(pedido);
        const diasParado = calcularDias(pedido.atualizadoEm);

        // Pedido pendente aguardando resposta do fornecedor.
        if (pedido.aguardandoResposta) {
            alertas.push({
                pedidoId: pedido.id,
                tipo: "atencao",
                titulo: `Pedido #${pedido.id} — Resposta pendente`,
                descricao: `${parceiro.nome} aguarda acompanhamento.`
            });

            return;
        }

        // Pedido sem movimentação há 3 dias ou mais.
        if (diasParado >= 3) {
            alertas.push({
                pedidoId: pedido.id,
                tipo: "urgente",
                titulo: `Pedido #${pedido.id} — Sem movimentação`,
                descricao: `Última atualização há ${diasParado} dias.`
            });
        }
    });

    if (alertas.length === 0) {
        elementos.radarLista.innerHTML = `
            <p class="empty-state">
                Nenhuma pendência identificada.
            </p>
        `;

        return;
    }

    elementos.radarLista.innerHTML = alertas.map(alerta => `
        <div class="radar-alert ${alerta.tipo}">
            <strong>${escaparHTML(alerta.titulo)}</strong>
            <p>${escaparHTML(alerta.descricao)}</p>
            <small>Pedido #${alerta.pedidoId}</small>
        </div>
    `).join("");
}


/* ==========================================================
   14 — CONVERSAS RECENTES
   Últimos contatos do chat (mensagens_pedidos), agrupados
   por pedido e filtrados pelo modo ativo.
   ========================================================== */

const LIMITE_CONVERSAS = 6;

// Busca as mensagens dos pedidos carregados e agrupa por pedido.
async function buscarConversasSupabase() {

    const client = obterSupabase();

    conversasCache = new Map();

    if (!client || pedidosCache.length === 0) return;

    // Sem filtro por id_pedido: o RLS já entrega só as mensagens dos pedidos
    // da empresa. (Uma lista .in() com todos os ids crescia sem limite na URL.)
    const { data, error } = await client
        .from("mensagens_pedidos")
        .select("id, id_pedido, texto, id_remetente, lida, data_envio")
        .order("data_envio", { ascending: false })
        .limit(500);

    if (error) {
        throw error;
    }

    // Do mais recente para o mais antigo: a primeira de cada pedido é a última.
    [...(data || [])].reverse().forEach(registrarMensagemNaConversa);
}

// Atualiza o resumo da conversa de um pedido com uma mensagem.
function registrarMensagemNaConversa(mensagem) {

    const minha = mensagem.id_remetente === empresaLogada.authUserId;
    const atual = conversasCache.get(mensagem.id_pedido) || {
        idPedido: mensagem.id_pedido,
        naoLidas: 0
    };

    if (!atual.ultimaData || new Date(mensagem.data_envio) >= new Date(atual.ultimaData)) {
        atual.ultimoTexto = mensagem.texto;
        atual.ultimaData = mensagem.data_envio;
        atual.ultimaMinha = minha;
    }

    if (!minha && !mensagem.lida) {
        atual.naoLidas += 1;
    }

    conversasCache.set(mensagem.id_pedido, atual);
}

// Conversas cujo pedido pertence ao modo ativo, da mais recente à mais antiga.
function obterConversasDoModo(modo = estado.modo) {

    return [...conversasCache.values()]
        .map(conversa => ({
            ...conversa,
            pedido: pedidosCache.find(pedido => pedido.id === conversa.idPedido)
        }))
        .filter(conversa => conversa.pedido?.modos.includes(modo))
        .sort((a, b) => new Date(b.ultimaData) - new Date(a.ultimaData));
}

// Empresas "Ambos": mostra no botão do OUTRO modo quantas mensagens
// não lidas esperam lá (ex.: "Vender 2" enquanto está em Comprar).
function atualizarBadgesModo() {

    document.querySelectorAll(".modo-btn").forEach(botao => {
        const modo = botao.dataset.mode;
        const naoLidas = modo === estado.modo
            ? 0
            : obterConversasDoModo(modo).reduce((total, c) => total + c.naoLidas, 0);

        let badge = botao.querySelector(".modo-badge");

        if (naoLidas === 0) {
            badge?.remove();
            botao.removeAttribute("title");
            return;
        }

        if (!badge) {
            badge = document.createElement("span");
            badge.className = "modo-badge";
            botao.appendChild(badge);
        }

        badge.textContent = naoLidas > 99 ? "99+" : String(naoLidas);
        botao.title = `${naoLidas} mensagem(ns) não lida(s) no modo ${modo === "vender" ? "Vender" : "Comprar"}`;
    });
}

function renderizarConversas() {

    if (estado.carregamento === "carregando") {
        elementos.conversasRecentes.innerHTML = `
            <p class="empty-state">Carregando conversas...</p>
        `;
        return;
    }

    const conversas = obterConversasDoModo().slice(0, LIMITE_CONVERSAS);

    if (conversas.length === 0) {
        elementos.conversasRecentes.innerHTML = `
            <p class="empty-state">
                Nenhuma conversa ainda. Abra um pedido e use o chat para falar com a outra empresa.
            </p>
        `;

        return;
    }

    elementos.conversasRecentes.innerHTML = conversas.map(conversa => {

        const parceiro = parceiroDoPedido(conversa.pedido);
        const prefixo = conversa.ultimaMinha ? "Você: " : "";

        return `
            <div
                class="conversation-item"
                data-conversa="${conversa.idPedido}"
                role="button"
                tabindex="0"
                title="Abrir o chat do pedido #${conversa.idPedido}"
            >

                <div class="conversation-info">
                    <strong>
                        ${escaparHTML(parceiro.nome)}
                        <small class="conversation-pedido">· Pedido #${conversa.idPedido}</small>
                    </strong>

                    <span>
                        ${escaparHTML(prefixo + conversa.ultimoTexto)}
                    </span>
                </div>

                <div style="
                    display:flex;
                    align-items:center;
                    gap:12px;
                ">
                    ${conversa.naoLidas > 0 ? `
                        <span class="nav-count" title="Mensagens não lidas">
                            ${conversa.naoLidas}
                        </span>
                    ` : ""}

                    <span class="conversation-time">
                        ${tempoRelativo(conversa.ultimaData)}
                    </span>
                </div>

            </div>
        `;
    }).join("");
}

// Abre o modal/chat do pedido a partir de uma conversa.
function abrirConversa(idPedido) {
    const pedido = pedidosCache.find(item => item.id === idPedido);

    if (pedido) {
        abrirDetalhesPedido(pedido);
    }
}

// Marca como lidas as mensagens RECEBIDAS do pedido (UPDATE só em "lida").
async function marcarMensagensComoLidas(idPedido) {

    const client = obterSupabase();
    const conversa = conversasCache.get(idPedido);

    if (!client || !empresaLogada.authUserId || !conversa || conversa.naoLidas === 0) {
        return;
    }

    const { error } = await client
        .from("mensagens_pedidos")
        .update({ lida: true })
        .eq("id_pedido", idPedido)
        .eq("lida", false)
        .neq("id_remetente", empresaLogada.authUserId);

    if (error) {
        console.warn("[SERF:Chat] Não foi possível marcar mensagens como lidas:", error);
        return;
    }

    conversa.naoLidas = 0;
    renderizarConversas();
    atualizarIndicadores();
}

// Novas mensagens de qualquer pedido atualizam a lista de conversas.
// O RLS garante que só chegam mensagens dos pedidos da empresa.
let canalMensagens = null;

function assinarMensagensTempoReal() {

    const client = obterSupabase();

    if (!client || canalMensagens) return;

    canalMensagens = client
        .channel("mensagens-painel")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "mensagens_pedidos" },
            payload => {
                const mensagem = payload.new;

                registrarMensagemNaConversa(mensagem);

                // Chat deste pedido aberto: a mensagem já está sendo lida.
                const recebida = mensagem.id_remetente !== empresaLogada.authUserId;
                if (recebida && chat.pedido?.id === mensagem.id_pedido) {
                    marcarMensagensComoLidas(mensagem.id_pedido);
                }

                renderizarConversas();
                atualizarIndicadores();
            }
        )
        .subscribe();
}


/* ==========================================================
   15 — ATUALIZAÇÃO DO DASHBOARD
   Reúne as funções de renderização da Home.
   ========================================================== */

function atualizarDashboard() {

    const pedidos = obterPedidosFiltrados();

    renderizarPedidos(pedidos);
    atualizarIndicadores();
    renderizarGrafico();
    renderizarRadar();
    renderizarConversas();
}


/* ==========================================================
   16 — NAVEGAÇÃO LATERAL
   Controla o menu responsivo e os links existentes.
   ========================================================== */

function configurarNavegacao() {

    // Abre ou recolhe o menu em telas menores.
    elementos.menuToggle.addEventListener("click", () => {

        const aberto = elementos.sidebar.classList.toggle("open");

        elementos.menuToggle.setAttribute(
            "aria-expanded",
            String(aberto)
        );
    });

    // Mantém os links internos sem gerar navegação inválida.
    document.querySelectorAll(".nav-item").forEach(link => {

        link.addEventListener("click", evento => {

            const destino = link.getAttribute("href");

            // Links para páginas externas (.html) devem navegar normalmente.
            if (destino && destino.includes(".html")) {
                return;
            }

            const secao = destino
                ? document.querySelector(destino)
                : null;

            // Os módulos ainda não criados serão integrados depois.
            if (!secao) {
                evento.preventDefault();

                alert(
                    "Este módulo será disponibilizado em uma próxima etapa."
                );

                return;
            }

            // Destaca o link selecionado.
            document.querySelectorAll(".nav-item").forEach(item => {
                item.classList.remove("active");
            });

            link.classList.add("active");

            // Fecha o menu no celular após selecionar a seção.
            elementos.sidebar.classList.remove("open");
            elementos.menuToggle.setAttribute(
                "aria-expanded",
                "false"
            );
        });
    });
}


/* ==========================================================
   17 — EVENTOS DOS FILTROS
   Atualiza os registros quando o usuário muda critérios.
   ========================================================== */

function configurarFiltros() {

    elementos.filtroPeriodo.addEventListener("change", evento => {
        estado.periodo = Number(evento.target.value);
        atualizarDashboard();
    });

    elementos.filtroStatus.addEventListener("change", evento => {
        estado.status = evento.target.value;
        atualizarDashboard();
    });

    elementos.filtroEmpresa.addEventListener("change", evento => {
        estado.empresa = evento.target.value;
        atualizarDashboard();
    });

    elementos.buscaGlobal.addEventListener("input", evento => {
        estado.busca = evento.target.value.trim().toLowerCase();
        atualizarDashboard();
    });

    // Restaura os filtros para os valores iniciais.
    elementos.btnLimparFiltros.addEventListener("click", () => {

        estado.periodo = 30;
        estado.status = "todos";
        estado.empresa = "todas";
        estado.busca = "";
        estado.indicador = null;

        elementos.filtroPeriodo.value = "30";
        elementos.filtroStatus.value = "todos";
        elementos.filtroEmpresa.value = "todas";
        elementos.buscaGlobal.value = "";

        document.querySelectorAll(".metric-item").forEach(item => {
            item.classList.remove("active");
        });

        atualizarDashboard();
    });
}


/* ==========================================================
   18 — INTERAÇÃO DOS INDICADORES
   Permite filtrar pedidos ao clicar em uma métrica.
   ========================================================== */

function configurarIndicadores() {

    document.querySelectorAll(".metric-item").forEach(botao => {

        botao.addEventListener("click", () => {

            const indicador = botao.dataset.metric;

            // Mensagens direciona o usuário à área de conversas.
            if (indicador === "mensagens") {
                document.getElementById("mensagens")
                    .scrollIntoView({ behavior: "smooth" });

                return;
            }

            // Segundo clique remove o filtro selecionado.
            estado.indicador =
                estado.indicador === indicador ? null : indicador;

            document.querySelectorAll(".metric-item").forEach(item => {
                item.classList.toggle(
                    "active",
                    item.dataset.metric === estado.indicador
                );
            });

            renderizarPedidos(obterPedidosFiltrados());
        });
    });
}


/* ==========================================================
   19 — AÇÕES DA HOME
   Botões da tabela, atalhos e funcionalidades futuras.
   ========================================================== */

function configurarAcoes() {

    // Alternância de contexto Comprar/Vender.
    document.querySelectorAll(".modo-btn").forEach(botao => {
        botao.addEventListener("click", () => {
            alterarModo(botao.dataset.mode);
        });
    });

    // Ação contextual de comprador ou fornecedor.
    elementos.btnAcaoPrincipal.addEventListener("click", () => {

        const mensagem = estado.modo === "comprar"
            ? "O cadastro de pedidos será integrado ao módulo de compras."
            : "O cadastro de produtos será integrado ao módulo de vendas.";

        alert(mensagem);
    });

    // Ações da tabela por delegação de eventos.
    elementos.pedidosTableBody.addEventListener("click", evento => {

        const botao = evento.target.closest("[data-pedido]");

        if (!botao) return;

        const pedido = pedidosCache.find(
            item => item.id === Number(botao.dataset.pedido)
        );

        if (pedido) {
            abrirDetalhesPedido(pedido);
        }
    });

    // Acesso ao futuro módulo de mensagens.
    // "Ver todas": abre a conversa mais recente com mensagens não lidas
    // (ou simplesmente a mais recente).
    elementos.btnTodasMensagens.addEventListener("click", () => {
        const conversas = obterConversasDoModo();
        const alvo = conversas.find(conversa => conversa.naoLidas > 0) || conversas[0];

        if (alvo) {
            abrirConversa(alvo.idPedido);
        } else {
            alert("Nenhuma conversa ainda. Abra um pedido na tabela e use o chat para falar com a outra empresa.");
        }
    });

    // Clique (ou Enter) numa conversa abre o chat do pedido.
    elementos.conversasRecentes.addEventListener("click", evento => {
        const item = evento.target.closest("[data-conversa]");
        if (item) abrirConversa(Number(item.dataset.conversa));
    });

    elementos.conversasRecentes.addEventListener("keydown", evento => {
        const item = evento.target.closest("[data-conversa]");
        if (item && (evento.key === "Enter" || evento.key === " ")) {
            evento.preventDefault();
            abrirConversa(Number(item.dataset.conversa));
        }
    });

    // Acesso ao perfil corporativo
    if (elementos.btnPerfil) {
        elementos.btnPerfil.addEventListener("click", () => {
            window.location.href = "perfil.html";
        });
    }
}


/* ==========================================================
   20 — CHAT B2B DO PEDIDO (tabela mensagens_pedidos)
   Histórico via select(), envio via insert() e novas
   mensagens em tempo real via Supabase Realtime.
   Só fica ativo enquanto o modal do pedido está aberto.
   ========================================================== */

const chat = {
    pedido: null,           // Pedido com o modal aberto
    canal: null,            // Canal Realtime do pedido
    sincronizacao: null,    // Intervalo de conferência (plano B do Realtime)
    realtimeAtivo: false,   // Canal do pedido em SUBSCRIBED
    ciclos: 0,              // Contador de execuções do plano B
    mensagens: new Map()    // id → mensagem (evita duplicar insert + realtime)
};

// Com o chat aberto, confere mensagens novas periodicamente. Garante a
// entrega mesmo se o Realtime cair ou for bloqueado (rede, RLS, token).
const INTERVALO_SINCRONIZACAO_CHAT = 4000;

// Com o Realtime ativo, o plano B só confere a cada N ciclos (4 s × 5 = 20 s).
const CICLOS_SINCRONIZACAO_COM_REALTIME = 5;

// Data da mensagem mais recente já exibida (base da busca incremental).
function ultimaDataDoChat() {
    let ultima = null;

    chat.mensagens.forEach(mensagem => {
        const data = new Date(mensagem.data_envio);
        if (!Number.isNaN(data.getTime()) && (!ultima || data > ultima)) ultima = data;
    });

    return ultima ? ultima.toISOString() : null;
}

async function sincronizarMensagensChat(idPedido) {

    if (chat.pedido?.id !== idPedido || document.hidden) return;

    chat.ciclos += 1;
    if (chat.realtimeAtivo && chat.ciclos % CICLOS_SINCRONIZACAO_COM_REALTIME !== 0) return;

    try {
        // Busca só o que chegou depois da última mensagem exibida.
        const historico = await buscarMensagensPedido(idPedido, ultimaDataDoChat());

        if (chat.pedido?.id !== idPedido) return;

        const novas = historico.filter(mensagem => !chat.mensagens.has(mensagem.id));

        if (novas.length === 0) return;

        adicionarMensagens(novas);

        // Mensagens recebidas pelo plano B também atualizam conversas e leitura.
        novas.forEach(registrarMensagemNaConversa);

        if (novas.some(mensagem => mensagem.id_remetente !== empresaLogada.authUserId)) {
            marcarMensagensComoLidas(idPedido);
        }

        renderizarConversas();
        atualizarIndicadores();
    } catch (erro) {
        console.warn("[SERF:Chat] Falha na sincronização das mensagens:", erro);
    }
}

// 1) Histórico de mensagens do pedido
// desde: só mensagens a partir dessa data (inclusive; o Map descarta repetidas).
async function buscarMensagensPedido(idPedido, desde = null) {

    const client = obterSupabase();

    if (!client) {
        throw new Error("Conexão com o banco de dados não estabelecida.");
    }

    let consulta = client
        .from("mensagens_pedidos")
        .select("id, id_pedido, texto, id_remetente, lida, data_envio")
        .eq("id_pedido", idPedido);

    if (desde) {
        consulta = consulta.gte("data_envio", desde);
    }

    const { data, error } = await consulta.order("data_envio", { ascending: true });

    if (error) {
        throw error;
    }

    return data || [];
}

// 2) Envio de uma nova mensagem
async function enviarMensagemPedido(idPedido, texto) {

    const client = obterSupabase();

    if (!client) {
        throw new Error("Conexão com o banco de dados não estabelecida.");
    }

    if (!empresaLogada.authUserId) {
        throw new Error("Faça login para enviar mensagens.");
    }

    const { data, error } = await client
        .from("mensagens_pedidos")
        .insert({
            id_pedido: idPedido,
            texto,
            id_remetente: empresaLogada.authUserId
        })
        .select("id, id_pedido, texto, id_remetente, lida, data_envio")
        .single();

    if (error) {
        throw error;
    }

    return data;
}

// 3) Tempo real: novas mensagens do pedido aparecem sem recarregar
function assinarChatTempoReal(idPedido) {

    const client = obterSupabase();

    if (!client) return null;

    atualizarStatusChat("Conectando...", "");

    return client
        .channel(`chat-pedido-${idPedido}`)
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "mensagens_pedidos",
                filter: `id_pedido=eq.${idPedido}`
            },
            payload => {
                // Ignora eventos que chegarem após trocar ou fechar o pedido.
                if (chat.pedido?.id !== idPedido) return;

                adicionarMensagens([payload.new]);
            }
        )
        .subscribe(status => {
            if (chat.pedido?.id !== idPedido) return;

            if (status === "SUBSCRIBED") {
                chat.realtimeAtivo = true;
                atualizarStatusChat("Tempo real ativo", "online");
            } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
                chat.realtimeAtivo = false;
                atualizarStatusChat("Tempo real indisponível", "offline");
            }
        });
}

function atualizarStatusChat(texto, classe) {
    elementos.chatStatus.textContent = texto;
    elementos.chatStatus.className = `chat-status ${classe}`.trim();
}

// Formata "AAAA-MM-DDTHH:MM..." como "16/10 14:32".
function formatarHorarioMensagem(timestamp) {
    const data = new Date(timestamp);

    if (Number.isNaN(data.getTime())) return "";

    return data.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

// Guarda as mensagens (sem repetir) e redesenha a conversa.
function adicionarMensagens(lista) {
    lista.forEach(mensagem => {
        chat.mensagens.set(mensagem.id, mensagem);
    });

    renderizarMensagens();
}

function renderizarMensagens() {

    const mensagens = [...chat.mensagens.values()].sort(
        (a, b) => new Date(a.data_envio) - new Date(b.data_envio)
    );

    if (mensagens.length === 0) {
        elementos.chatMensagens.innerHTML = `
            <p class="chat-vazio">
                Nenhuma mensagem ainda. Envie a primeira para iniciar a negociação.
            </p>
        `;

        return;
    }

    const parceiro = parceiroDoPedido(chat.pedido);

    elementos.chatMensagens.innerHTML = mensagens.map(mensagem => {

        const minha =
            empresaLogada.authUserId !== null &&
            mensagem.id_remetente === empresaLogada.authUserId;

        return `
            <div class="chat-balao ${minha ? "enviada" : "recebida"}">
                <span class="chat-autor">
                    ${minha ? "Você" : escaparHTML(parceiro.nome)}
                </span>
                <p>${escaparHTML(mensagem.texto)}</p>
                <small>${formatarHorarioMensagem(mensagem.data_envio)}</small>
            </div>
        `;
    }).join("");

    // Mantém a conversa rolada até a mensagem mais recente.
    elementos.chatMensagens.scrollTop = elementos.chatMensagens.scrollHeight;
}

// Preenche o resumo do pedido no topo do modal.
function renderizarResumoPedido(pedido) {

    const parceiro = parceiroDoPedido(pedido);
    const papel = estado.modo === "comprar" ? "Fornecedor" : "Comprador";

    const campos = [
        [papel, parceiro.nome],
        ["Produto", pedido.produto],
        ["Status", pedido.statusRotulo],
        ["Quantidade", `${pedido.quantidade} un.`],
        ["Valor unitário", formatarMoeda(pedido.valorUnitario)],
        ["Valor total", formatarMoeda(pedido.valorTotal)]
    ];

    elementos.pedidoResumo.innerHTML = campos.map(([rotulo, valor]) => `
        <div>
            <dt>${rotulo}</dt>
            <dd title="${escaparHTML(valor)}">${escaparHTML(valor)}</dd>
        </div>
    `).join("") + (pedido.observacao ? `
        <div class="pedido-resumo-obs">
            <dt>Observação</dt>
            <dd>${escaparHTML(pedido.observacao)}</dd>
        </div>
    ` : "");
}

// Mostra o seletor de status apenas ao fornecedor do produto,
// com os próximos status permitidos a partir do atual.
function renderizarGestaoStatus(pedido) {

    const form = elementos.formStatusPedido;

    if (!souFornecedorDoPedido(pedido)) {
        form.hidden = true;
        return;
    }

    form.hidden = false;

    const proximos = TRANSICOES_STATUS[pedido.statusBanco] || [];

    if (proximos.length === 0) {
        elementos.selectNovoStatus.innerHTML =
            `<option value="">${escaparHTML(pedido.statusRotulo)}</option>`;
        elementos.selectNovoStatus.disabled = true;
        elementos.btnAtualizarStatus.disabled = true;
        elementos.statusPedidoAjuda.textContent =
            "Pedido finalizado: o status não pode mais ser alterado.";
        return;
    }

    // "Enviado" exige pagamento (ou prazo aprovado) E NF-e autorizada — o banco
    // também exige. undefined = ainda não carregado / tabela indisponível → não trava.
    let motivoBloqueio = null;

    if (pedido.pagamento !== undefined && window.SERFPagamentos &&
        !window.SERFPagamentos.liberaEnvio(pedido.pagamento)) {
        motivoBloqueio = "aguardando pagamento";
    } else if (pedido.nota !== undefined && window.SERFNotas &&
        !window.SERFNotas.autorizada(pedido.nota)) {
        motivoBloqueio = "emita a NF-e";
    }

    const envioBloqueado = motivoBloqueio !== null;

    elementos.selectNovoStatus.innerHTML = proximos.map(codigo => {
        const bloqueado = codigo === "ENVIADO" && envioBloqueado;
        const rotulo = STATUS_BANCO[codigo]?.rotulo || codigo;

        return `
            <option value="${codigo}" ${bloqueado ? "disabled" : ""}>
                ${escaparHTML(bloqueado ? `${rotulo} (${motivoBloqueio})` : rotulo)}
            </option>
        `;
    }).join("");

    // Seleciona a primeira opção disponível
    const primeiraLivre = [...elementos.selectNovoStatus.options].find(opcao => !opcao.disabled);

    elementos.selectNovoStatus.value = primeiraLivre ? primeiraLivre.value : "";
    elementos.selectNovoStatus.disabled = !primeiraLivre;
    elementos.btnAtualizarStatus.disabled = !primeiraLivre;
    elementos.statusPedidoAjuda.textContent = envioBloqueado && proximos.includes("ENVIADO")
        ? `Status atual: ${pedido.statusRotulo}. ${motivoBloqueio === "aguardando pagamento"
            ? "O envio é liberado após o pagamento do comprador."
            : "Emita a nota fiscal para liberar o envio."}`
        : `Status atual: ${pedido.statusRotulo}. O comprador é avisado pelo chat.`;
}

/* ---------- Nota fiscal do pedido (notas.js) ---------- */

async function carregarNota(pedido) {
    if (!window.SERFNotas) return;

    try {
        pedido.nota = await window.SERFNotas.buscar(pedido.id);
    } catch (erro) {
        // Sem a migration 010 a tabela não existe: o modal segue sem a seção.
        console.warn("[SERF:NF-e] Nota fiscal indisponível:", erro.message);
        pedido.nota = undefined;
        elementos.pedidoNota.hidden = true;
        return;
    }

    if (chat.pedido?.id !== pedido.id) return;

    renderizarNota(pedido);
    renderizarGestaoStatus(pedido);
}

function renderizarNota(pedido) {
    if (!window.SERFNotas || pedido.nota === undefined) return;

    window.SERFNotas.renderizar(elementos.pedidoNota, {
        pedidoId: pedido.id,
        statusPedido: pedido.statusBanco,
        papel: souFornecedorDoPedido(pedido) && estado.modo === "vender" ? "fornecedor" : "comprador",
        nota: pedido.nota,
        pagamentoLiberado: Boolean(window.SERFPagamentos?.liberaEnvio(pedido.pagamento)),

        aoAtualizar: (nota, mensagemChat) => {
            pedido.nota = nota;

            if (chat.pedido?.id === pedido.id) {
                renderizarNota(pedido);
                renderizarGestaoStatus(pedido);
            }

            if (mensagemChat) {
                enviarMensagemPedido(pedido.id, mensagemChat)
                    .then(mensagem => {
                        if (chat.pedido?.id === pedido.id) adicionarMensagens([mensagem]);
                    })
                    .catch(erro => console.warn("[SERF:Chat] Aviso de NF-e não enviado:", erro));
            }
        }
    });
}

/* ---------- Pagamento do pedido (pagamentos.js) ---------- */

async function carregarPagamento(pedido) {
    if (!window.SERFPagamentos) return;

    try {
        pedido.pagamento = await window.SERFPagamentos.buscar(pedido.id);
    } catch (erro) {
        // Sem a migration 009 a tabela não existe: o modal segue funcionando sem a seção.
        console.warn("[SERF:Pagamentos] Pagamento indisponível:", erro.message);
        pedido.pagamento = undefined;
        elementos.pedidoPagamento.hidden = true;
        return;
    }

    if (chat.pedido?.id !== pedido.id) return;

    renderizarPagamento(pedido);
    renderizarGestaoStatus(pedido);
    renderizarNota(pedido);
}

function renderizarPagamento(pedido) {
    if (!window.SERFPagamentos || pedido.pagamento === undefined) return;

    window.SERFPagamentos.renderizar(elementos.pedidoPagamento, {
        pedidoId: pedido.id,
        statusPedido: pedido.statusBanco,
        valorTotal: pedido.valorTotal,
        produto: pedido.produto,
        parceiroNome: parceiroDoPedido(pedido).nome,
        papel: souFornecedorDoPedido(pedido) && estado.modo === "vender" ? "fornecedor" : "comprador",
        pagamento: pedido.pagamento,

        // Chamado após gerar/pagar/aprovar: atualiza a tela e avisa no chat
        aoAtualizar: (pagamento, mensagemChat) => {
            pedido.pagamento = pagamento;

            if (chat.pedido?.id === pedido.id) {
                renderizarPagamento(pedido);
                renderizarGestaoStatus(pedido);
                renderizarNota(pedido);
            }

            if (mensagemChat) {
                enviarMensagemPedido(pedido.id, mensagemChat)
                    .then(mensagem => {
                        if (chat.pedido?.id === pedido.id) adicionarMensagens([mensagem]);
                    })
                    .catch(erro => console.warn("[SERF:Chat] Aviso de pagamento não enviado:", erro));
            }
        }
    });
}

async function enviarAtualizacaoStatus(evento) {

    evento.preventDefault();

    const pedido = chat.pedido;
    const novoStatus = elementos.selectNovoStatus.value;

    if (!pedido || !novoStatus) return;

    const rotulo = STATUS_BANCO[novoStatus]?.rotulo || novoStatus;

    if (
        novoStatus === "CANCELADO" &&
        !confirm(`Cancelar o pedido #${pedido.id}? Esta ação não pode ser desfeita.`)
    ) {
        return;
    }

    elementos.btnAtualizarStatus.disabled = true;
    elementos.btnAtualizarStatus.textContent = "Salvando...";

    try {
        const atualizado = await atualizarStatusPedido(pedido.id, novoStatus);

        aplicarStatusPedido(pedido, atualizado);

        renderizarResumoPedido(pedido);
        renderizarGestaoStatus(pedido);
        carregarPagamento(pedido);
        carregarNota(pedido);
        atualizarDashboard();

        // Registra a mudança no chat: o comprador recebe em tempo real.
        enviarMensagemPedido(pedido.id, `📦 Status do pedido atualizado para: ${rotulo}.`)
            .then(mensagem => {
                if (chat.pedido?.id === pedido.id) {
                    adicionarMensagens([mensagem]);
                }
            })
            .catch(erro => console.warn("[SERF:Chat] Aviso de status não enviado:", erro));
    } catch (erro) {
        console.error("[SERF:Home] Falha ao atualizar status:", erro);
        alert(`Não foi possível atualizar o status.\n\n${erro.message || erro}`);
        renderizarGestaoStatus(pedido);
    } finally {
        elementos.btnAtualizarStatus.textContent = "Atualizar";
    }
}

async function abrirDetalhesPedido(pedido) {

    // Encerra o canal de um pedido aberto anteriormente.
    fecharCanalChat();

    chat.pedido = pedido;
    chat.mensagens = new Map();

    const parceiro = parceiroDoPedido(pedido);

    elementos.modalPedidoTitulo.textContent = `Pedido #${pedido.id}`;
    elementos.modalPedidoSubtitulo.textContent = `Realizado em ${formatarData(pedido.criadoEm)}`;
    elementos.chatParceiroNome.textContent = parceiro.nome;
    elementos.chatMensagens.innerHTML = `<p class="chat-vazio">Carregando mensagens...</p>`;
    elementos.chatInput.value = "";

    renderizarResumoPedido(pedido);
    renderizarGestaoStatus(pedido);

    // Pagamento: carrega em paralelo (a seção aparece quando chegar)
    elementos.pedidoPagamento.hidden = true;
    carregarPagamento(pedido);
    elementos.pedidoNota.hidden = true;
    carregarNota(pedido);

    elementos.modalPedido.style.display = "flex";
    elementos.chatInput.focus();

    // Assina antes de buscar o histórico para não perder mensagens
    // enviadas nesse intervalo; o Map descarta repetidas.
    chat.canal = assinarChatTempoReal(pedido.id);

    try {
        const historico = await buscarMensagensPedido(pedido.id);

        if (chat.pedido?.id !== pedido.id) return;

        adicionarMensagens(historico);

        // Abrir o chat confirma a leitura das mensagens recebidas.
        marcarMensagensComoLidas(pedido.id);

        chat.sincronizacao = setInterval(
            () => sincronizarMensagensChat(pedido.id),
            INTERVALO_SINCRONIZACAO_CHAT
        );
    } catch (erro) {
        console.error("[SERF:Chat] Falha ao buscar mensagens:", erro);

        if (chat.pedido?.id !== pedido.id) return;

        elementos.chatMensagens.innerHTML = `
            <p class="chat-vazio" style="color:#DC2626;">
                Não foi possível carregar as mensagens.<br>
                <small>${escaparHTML(erro.message || "Erro de comunicação com o Supabase")}</small>
            </p>
        `;
    }
}

function fecharCanalChat() {
    if (chat.canal) {
        obterSupabase()?.removeChannel(chat.canal);
        chat.canal = null;
    }

    clearInterval(chat.sincronizacao);
    chat.sincronizacao = null;
    chat.realtimeAtivo = false;
    chat.ciclos = 0;
}

function fecharDetalhesPedido() {
    fecharCanalChat();

    chat.pedido = null;
    chat.mensagens = new Map();

    elementos.modalPedido.style.display = "none";
}

function configurarChat() {

    elementos.btnFecharModalPedido.addEventListener("click", fecharDetalhesPedido);
    elementos.formStatusPedido.addEventListener("submit", enviarAtualizacaoStatus);

    // Fecha ao clicar fora da janela ou pressionar Esc.
    elementos.modalPedido.addEventListener("click", evento => {
        if (evento.target === elementos.modalPedido) {
            fecharDetalhesPedido();
        }
    });

    document.addEventListener("keydown", evento => {
        if (evento.key === "Escape" && chat.pedido) {
            fecharDetalhesPedido();
        }
    });

    elementos.formChat.addEventListener("submit", async evento => {

        evento.preventDefault();

        const texto = elementos.chatInput.value.trim();
        const pedido = chat.pedido;

        if (!texto || !pedido) return;

        elementos.btnEnviarMensagem.disabled = true;

        try {
            const mensagem = await enviarMensagemPedido(pedido.id, texto);

            elementos.chatInput.value = "";

            if (chat.pedido?.id === pedido.id) {
                adicionarMensagens([mensagem]);
            }
        } catch (erro) {
            console.error("[SERF:Chat] Falha ao enviar mensagem:", erro);
            alert(`Não foi possível enviar a mensagem.\n\n${erro.message || erro}`);
        } finally {
            elementos.btnEnviarMensagem.disabled = false;
            elementos.chatInput.focus();
        }
    });
}


/* ==========================================================
   21 — INICIALIZAÇÃO DA HOME
   Configura a interface e carrega os pedidos do Supabase.
   ========================================================== */

// Exibe o nome e a inicial da empresa no cabeçalho.
function exibirEmpresaAtiva(nome) {
    elementos.empresaAtiva.textContent = nome;

    const avatar = document.querySelector(".profile-avatar");
    if (avatar) {
        avatar.textContent = nome.trim().charAt(0).toUpperCase();
    }
}

// Mostra a chave Comprar/Vender apenas para empresas com perfil "Ambos";
// as demais ficam fixas no único modo que possuem.
function ajustarModosDisponiveis() {

    const comprador = empresaLogada.idUsuario !== null;
    const fornecedor = empresaLogada.idFornecedor !== null;

    // Sem cadastro identificado, mantém a interface como está.
    if (!comprador && !fornecedor) return;

    const ambos = comprador && fornecedor;

    if (elementos.modoSwitch) {
        elementos.modoSwitch.hidden = !ambos;
    }

    if (!ambos) {
        const modoUnico = fornecedor ? "vender" : "comprar";
        if (estado.modo !== modoUnico) {
            alterarModo(modoUnico);
        }
    }
}

// Pedidos em tempo real (tabela pedidos na publicação supabase_realtime).
// O RLS garante que cada empresa só recebe os próprios pedidos.
let canalPedidos = null;
let recargaPedidosAgendada = null;

// Pagamentos em tempo real: o fornecedor vê o "Pago" sem recarregar
// (e o comprador vê a aprovação do prazo). RLS: só os pedidos da empresa.
let canalPagamentos = null;

function assinarPagamentosTempoReal() {

    const client = obterSupabase();

    if (!client || canalPagamentos || !window.SERFPagamentos) return;

    canalPagamentos = client
        .channel("pagamentos-painel")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "pagamentos" },
            payload => {
                const registro = payload.new;
                if (!registro?.id_pedido) return;

                const pedido = pedidosCache.find(item => item.id === registro.id_pedido);
                if (!pedido) return;

                pedido.pagamento = registro;

                if (chat.pedido?.id === pedido.id) {
                    renderizarPagamento(pedido);
                    renderizarGestaoStatus(pedido);
                    renderizarNota(pedido);
                }
            }
        )
        .subscribe();
}

// NF-e em tempo real: o comprador vê a nota assim que é emitida.
let canalNotas = null;

function assinarNotasTempoReal() {

    const client = obterSupabase();

    if (!client || canalNotas || !window.SERFNotas) return;

    canalNotas = client
        .channel("notas-painel")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "notas_fiscais" },
            payload => {
                const registro = payload.new;
                if (!registro?.id_pedido) return;

                const pedido = pedidosCache.find(item => item.id === registro.id_pedido);
                if (!pedido) return;

                // Mantém a nota mais recente do pedido
                if (!pedido.nota || new Date(registro.data_emissao) >= new Date(pedido.nota.data_emissao)) {
                    pedido.nota = registro;
                }

                if (chat.pedido?.id === pedido.id) {
                    renderizarNota(pedido);
                    renderizarGestaoStatus(pedido);
                }
            }
        )
        .subscribe();
}

function assinarPedidosTempoReal() {

    const client = obterSupabase();

    if (!client || canalPedidos) return;

    canalPedidos = client
        .channel("pedidos-painel")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "pedidos" },
            payload => {
                const pedido = pedidosCache.find(
                    item => item.id === payload.new?.id_pedido
                );

                // Mudança de status de um pedido já carregado: atualiza no lugar.
                if (payload.eventType === "UPDATE" && pedido) {
                    aplicarStatusPedido(pedido, payload.new);
                    atualizarDashboard();

                    if (chat.pedido?.id === pedido.id) {
                        renderizarResumoPedido(pedido);
                        renderizarGestaoStatus(pedido);
                        renderizarPagamento(pedido);
                        renderizarNota(pedido);
                    }
                    return;
                }

                // Pedido novo (ou desconhecido): recarrega com os JOINs.
                // Agrupa eventos em sequência numa única consulta.
                clearTimeout(recargaPedidosAgendada);
                recargaPedidosAgendada = setTimeout(recarregarPedidos, 400);
            }
        )
        .subscribe();
}

// home.html?pedido=ID (ex.: "Último pedido" da página Empresas)
function abrirPedidoDaUrl() {
    const parametros = new URLSearchParams(window.location.search);
    const idPedido = Number(parametros.get("pedido"));

    if (!idPedido) return;

    // Limpa o parâmetro para um F5 não reabrir o modal
    history.replaceState(null, "", window.location.pathname + window.location.hash);

    const pedido = pedidosCache.find(item => item.id === idPedido);

    if (!pedido) {
        console.warn(`[SERF:Home] Pedido #${idPedido} não encontrado para esta empresa.`);
        return;
    }

    // Empresa "Ambos": muda para o modo em que ela participa do pedido
    if (!pedido.modos.includes(estado.modo)) {
        alterarModo(pedido.modos[0]);
    }

    abrirDetalhesPedido(pedido);
}

async function recarregarPedidos() {
    try {
        await buscarPedidosSupabase();
        estado.carregamento = "ok";
    } catch (erro) {
        console.error("[SERF:Home] Falha ao buscar pedidos:", erro);
        estado.carregamento = "erro";
        estado.mensagemErro = erro.message || "Erro de comunicação com o Supabase";
    }

    // Conversas dependem dos pedidos carregados; falha aqui não derruba o painel.
    try {
        await buscarConversasSupabase();
    } catch (erro) {
        console.error("[SERF:Home] Falha ao buscar conversas:", erro);
    }

    preencherFiltroEmpresas();
    atualizarDashboard();
}

async function iniciarHome() {

    // Identifica a empresa no cabeçalho pelo cache do login.
    let modoInicial = "comprar";
    let nomeLocal = null;

    try {
        const dados = JSON.parse(localStorage.getItem("usuario_logado") || "null");

        if (dados) {
            nomeLocal = dados.razaoSocial || null;

            if (dados.perfil === "Fornecedor") {
                modoInicial = "vender";
            }
        }
    } catch (erro) {
        console.warn("[SERF:Home] Falha ao ler localStorage usuario_logado:", erro);
    }

    exibirEmpresaAtiva(nomeLocal || "Carregando...");

    // Ativa as interações e mostra o estado de carregamento.
    configurarNavegacao();
    configurarFiltros();
    configurarIndicadores();
    configurarAcoes();
    configurarChat();

    alterarModo(modoInicial);

    // Carrega os pedidos reais e redesenha o painel.
    await recarregarPedidos();

    if (!nomeLocal) {
        exibirEmpresaAtiva(empresaLogada.nome || "Empresa não identificada");
    }

    ajustarModosDisponiveis();

    // Links de outras páginas: home.html?pedido=ID abre o pedido (com o chat)
    abrirPedidoDaUrl();

    // Pedido criado pelo catálogo (catalogo.js) entra na lista na hora.
    window.addEventListener("serf:pedido-criado", recarregarPedidos);

    // O Realtime precisa do token da sessão (auth-check.js) antes de assinar.
    await window.serfSessao;

    // Status alterado pela outra empresa aparece sem recarregar a página.
    assinarPedidosTempoReal();

    // Novas mensagens atualizam "Conversas recentes" e o contador.
    assinarMensagensTempoReal();

    // Pagamentos (migration 009) atualizam a seção de pagamento ao vivo.
    assinarPagamentosTempoReal();

    // NF-e (migration 010) aparece ao vivo para o comprador.
    assinarNotasTempoReal();

    // Plano B das conversas: recarrega ao voltar para a aba e a cada 30 s.
    const atualizarConversas = async () => {
        if (document.hidden || estado.carregamento !== "ok") return;

        try {
            await buscarConversasSupabase();
            renderizarConversas();
            atualizarIndicadores();
        } catch (erro) {
            console.warn("[SERF:Home] Falha ao atualizar conversas:", erro);
        }
    };

    setInterval(atualizarConversas, 30000);
    document.addEventListener("visibilitychange", atualizarConversas);

    console.info("[SERF] Home inicializada com pedidos do Supabase.");
}

// O script utiliza defer no HTML.
// Portanto, os elementos já estarão disponíveis.
iniciarHome();


/* ==========================================================
   FIM — HOME.JS

   Próximas integrações:
   - Histórico de status (data de atualização/conclusão).
   - Módulos Empresas e Relatórios.
   ========================================================== */
