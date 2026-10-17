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
