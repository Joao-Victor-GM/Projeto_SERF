/* ==========================================================
   S.E.R.F. — HOME / DASHBOARD.JS
   Modo Comprar/Vender, filtros, tabela, KPIs, gráfico, radar e
   conversas recentes (seções 07–15).

   A Home é dividida em scripts clássicos que compartilham o escopo
   global, carregados nesta ordem (todos com defer):
     estado.js → dashboard.js → eventos.js → chat.js →
     pedido-modal.js → tempo-real.js → inicializacao.js
   Só inicializacao.js executa algo ao carregar (iniciarHome()).
   ========================================================== */

"use strict";


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

    // Personaliza a ação principal (o menu mostra sempre "Catálogo").
    elementos.btnAcaoPrincipal.textContent = novoModo === "comprar"
        ? "+ Novo pedido"
        : "+ Cadastrar produto";

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
   As regras ficam em js/dominio/painel.js (funções puras);
   aqui só a ligação com o estado da Home.
   ========================================================== */

// Linhas desenhadas por vez na tabela ("Mostrar mais" acrescenta outras)
const LIMITE_LINHAS_TABELA = 100;

// Pendências exibidas no radar de pedidos (o resto fica em alertas.html)
const LIMITE_RADAR = 8;

const hojeDoPainel = () => SERFPainel.inicioDoDia();

// Pedidos do modo ativo, sem outros filtros.
function obterPedidosDoModo() {
    return SERFPainel.doModo(pedidosCache, estado.modo);
}

// Modo, período, empresa e busca: base comum da tabela e dos indicadores.
function obterPedidosBase() {
    return SERFPainel.base(pedidosCache, estado, hojeDoPainel());
}

function obterPedidosFiltrados() {
    return SERFPainel.filtrados(obterPedidosBase(), estado);
}


/* ==========================================================
   09 — TABELA DE PEDIDOS
   Desenha no máximo estado.limiteTabela linhas: com milhares de
   pedidos, recriar todas as linhas a cada tecla da busca era o
   maior custo da Home.
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

function atualizarBotaoMaisPedidos(total, exibidos) {
    const botao = elementos.btnMaisPedidos;
    if (!botao) return;

    const restantes = total - exibidos;
    botao.hidden = restantes <= 0;
    botao.textContent = `Mostrar mais ${Math.min(restantes, LIMITE_LINHAS_TABELA)} de ${restantes} restantes`;
}

function renderizarPedidos(pedidos) {

    if (estado.carregamento === "carregando") {
        elementos.totalPedidos.textContent = "Carregando...";
        mensagemTabela("Carregando pedidos do banco de dados...");
        atualizarBotaoMaisPedidos(0, 0);
        return;
    }

    if (estado.carregamento === "erro") {
        elementos.totalPedidos.textContent = "0 pedidos";
        mensagemTabela(
            `<strong>Não foi possível carregar os pedidos.</strong><br>
             <small>${escaparHTML(estado.mensagemErro)}</small>`,
            "#DC2626"
        );
        atualizarBotaoMaisPedidos(0, 0);
        return;
    }

    elementos.totalPedidos.textContent =
        `${pedidos.length} pedido${pedidos.length === 1 ? "" : "s"}`;

    // Exibe uma mensagem quando nenhum registro é encontrado.
    if (pedidos.length === 0) {
        mensagemTabela("Nenhum pedido encontrado para os filtros selecionados.");
        atualizarBotaoMaisPedidos(0, 0);
        return;
    }

    // Pela última atualização; só a primeira "página" vira HTML.
    const visiveis = SERFPainel.ordenarPorAtualizacao(pedidos).slice(0, estado.limiteTabela);

    elementos.pedidosTableBody.innerHTML = visiveis.map(pedido => {

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

    atualizarBotaoMaisPedidos(pedidos.length, visiveis.length);
}

function mostrarMaisPedidos() {
    estado.limiteTabela += LIMITE_LINHAS_TABELA;
    renderizarPedidos(obterPedidosFiltrados());
}


/* ==========================================================
   10 — INDICADORES KPI
   Calcula as métricas com os dados do modo selecionado.
   ========================================================== */

// pedidosBase: quem já calculou a base passa adiante (evita refiltrar).
function atualizarIndicadores(pedidosBase = obterPedidosBase()) {

    // Mantém período, empresa e busca nos indicadores.
    // O filtro de status é aplicado apenas à tabela.
    const { abertos, respostas, concluidos } = SERFPainel.indicadores(pedidosBase);

    // Total de mensagens não lidas nos pedidos do modo ativo.
    const mensagens = SERFPainel.totalNaoLidas(obterConversasDoModo());

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

    const empresas = SERFPainel.parceiros(obterPedidosDoModo(), estado.modo);

    // Descarta a seleção anterior se a empresa não existir no modo atual.
    if (!empresas.some(([id]) => id === estado.empresa)) {
        estado.empresa = "todas";
    }

    elementos.filtroEmpresa.innerHTML = `
        <option value="todas">Todas as empresas</option>
    `;

    empresas.forEach(([id, nome]) => {
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

    const { quantidade: quantidadeFaixas, faixas, maiorValor } =
        SERFPainel.faixasDoGrafico(obterPedidosDoModo(), estado.periodo, hojeDoPainel());

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
   Mostra as primeiras pendências; a lista completa e priorizada
   fica na central de alertas.
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

    const alertas = SERFPainel.alertasDoRadar(obterPedidosDoModo(), estado.modo, hojeDoPainel());

    if (alertas.length === 0) {
        elementos.radarLista.innerHTML = `
            <p class="empty-state">
                Nenhuma pendência identificada.
            </p>
        `;

        return;
    }

    const restantes = alertas.length - LIMITE_RADAR;

    elementos.radarLista.innerHTML = alertas.slice(0, LIMITE_RADAR).map(alerta => `
        <div class="radar-alert ${alerta.tipo}">
            <strong>${escaparHTML(alerta.titulo)}</strong>
            <p>${escaparHTML(alerta.descricao)}</p>
            <small>Pedido #${alerta.pedidoId}</small>
        </div>
    `).join("") + (restantes > 0 ? `
        <p class="empty-state radar-mais">
            + ${restantes} pedido${restantes === 1 ? "" : "s"} com pendência.
            <a href="alertas.html">Ver todos os alertas</a>
        </p>
    ` : "");
}


/* ==========================================================
   14 — CONVERSAS RECENTES
   Últimos contatos do chat (mensagens_pedidos), agrupados
   por pedido e filtrados pelo modo ativo.
   ========================================================== */

const LIMITE_CONVERSAS = 6;

// Busca as mensagens dos pedidos carregados e agrupa por pedido.
async function buscarConversasSupabase() {

    conversasCache = new Map();

    if (pedidosCache.length === 0) return;

    // O RLS já entrega só as mensagens dos pedidos da empresa.
    const recentes = await SERFDados.mensagens.listarRecentes(500);

    // Do mais recente para o mais antigo: a primeira de cada pedido é a última.
    [...recentes].reverse().forEach(registrarMensagemNaConversa);
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

// Conversas cujo pedido pertence ao modo, da mais recente à mais antiga.
function obterConversasDoModo(modo = estado.modo) {
    return SERFPainel.conversasDoModo(conversasCache, pedidosPorId, modo);
}

// Empresas "Ambos": mostra no botão do OUTRO modo quantas mensagens
// não lidas esperam lá (ex.: "Vender 2" enquanto está em Comprar).
function atualizarBadgesModo() {

    document.querySelectorAll(".modo-btn").forEach(botao => {
        const modo = botao.dataset.mode;
        const naoLidas = modo === estado.modo
            ? 0
            : SERFPainel.totalNaoLidas(obterConversasDoModo(modo));

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
    const pedido = obterPedido(idPedido);

    if (pedido) {
        abrirDetalhesPedido(pedido);
    }
}

// Marca como lidas as mensagens RECEBIDAS do pedido (UPDATE só em "lida").
async function marcarMensagensComoLidas(idPedido) {

    const conversa = conversasCache.get(idPedido);

    if (!empresaLogada.authUserId || !conversa || conversa.naoLidas === 0) {
        return;
    }

    try {
        await SERFDados.mensagens.marcarComoLidas(idPedido, empresaLogada.authUserId);
    } catch (erro) {
        console.warn("[SERF:Chat] Não foi possível marcar mensagens como lidas:", erro);
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

    if (canalMensagens) return;

    canalMensagens = SERFDados.mensagens.assinarNovas(payload => {
        const mensagem = payload.new;

        registrarMensagemNaConversa(mensagem);

        // Chat deste pedido aberto: a mensagem já está sendo lida.
        const recebida = mensagem.id_remetente !== empresaLogada.authUserId;
        if (recebida && chat.pedido?.id === mensagem.id_pedido) {
            marcarMensagensComoLidas(mensagem.id_pedido);
        }

        renderizarConversas();
        atualizarIndicadores();
    });
}


/* ==========================================================
   15 — ATUALIZAÇÃO DO DASHBOARD
   Duas granularidades, para não redesenhar o que não mudou:
   - atualizarListagem(): tabela + KPIs (busca, status, empresa,
     indicador clicado — nada disso afeta gráfico, radar ou conversas);
   - atualizarDashboard(): tudo (dados, modo, período).
   ========================================================== */

function atualizarListagem({ manterPaginacao = false } = {}) {

    if (!manterPaginacao) estado.limiteTabela = LIMITE_LINHAS_TABELA;

    const base = obterPedidosBase();

    renderizarPedidos(SERFPainel.filtrados(base, estado));
    atualizarIndicadores(base);
}

function atualizarDashboard() {

    atualizarListagem();
    renderizarGrafico();
    renderizarRadar();
    renderizarConversas();
}
