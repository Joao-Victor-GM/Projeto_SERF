
/* ==========================================================
   S.E.R.F. — HOME.JS
   SCRUM-12: Dashboard e indicadores
   SCRUM-13: Navegação lateral

   Objetivo:
   Controlar a interface da Home e simular operações B2B.

   IMPORTANTE:
   Os dados abaixo são fictícios e utilizados apenas
   para desenvolvimento e testes.
   ========================================================== */

"use strict";


/* ==========================================================
   01 — DADOS FICTÍCIOS
   Simulam empresas e pedidos de uma plataforma B2B.
   ========================================================== */

// Empresa utilizada para demonstrar a Home.
// A autenticação real será integrada posteriormente.
const empresaDemo = {
    id: 1,
    nome: "Indústria Atlas Ltda.",
    perfil: "ambos"
};

// Empresas parceiras fictícias.
const empresasDemo = [
    { id: 2, nome: "Metalúrgica Horizonte" },
    { id: 3, nome: "Distribuidora Prime" },
    { id: 4, nome: "Tecnologia Nexus" },
    { id: 5, nome: "Comercial Aurora" },
    { id: 6, nome: "Logística Delta" }
];

// Retorna uma data relativa ao dia atual.
// Permite testar filtros sem depender de datas fixas.
function diasAtras(quantidade) {
    const data = new Date();
    data.setDate(data.getDate() - quantidade);
    return data.toISOString().slice(0, 10);
}

// Pedidos demonstrativos.
// "comprar": empresa ativa é compradora.
// "vender": empresa ativa é fornecedora.
const pedidosDemo = [
    {
        id: 1001,
        empresaId: 2,
        produto: "Chapas de aço carbono",
        modo: "comprar",
        status: "aberto",
        criadoEm: diasAtras(2),
        atualizadoEm: diasAtras(1),
        concluidoEm: null,
        aguardandoResposta: true
    },
    {
        id: 1002,
        empresaId: 3,
        produto: "Componentes industriais",
        modo: "comprar",
        status: "negociacao",
        criadoEm: diasAtras(5),
        atualizadoEm: diasAtras(2),
        concluidoEm: null,
        aguardandoResposta: false
    },
    {
        id: 1003,
        empresaId: 4,
        produto: "Equipamentos de automação",
        modo: "comprar",
        status: "concluido",
        criadoEm: diasAtras(12),
        atualizadoEm: diasAtras(3),
        concluidoEm: diasAtras(3),
        aguardandoResposta: false
    },
    {
        id: 1004,
        empresaId: 5,
        produto: "Embalagens industriais",
        modo: "comprar",
        status: "aberto",
        criadoEm: diasAtras(1),
        atualizadoEm: diasAtras(1),
        concluidoEm: null,
        aguardandoResposta: false
    },
    {
        id: 1005,
        empresaId: 6,
        produto: "Peças de reposição",
        modo: "comprar",
        status: "concluido",
        criadoEm: diasAtras(24),
        atualizadoEm: diasAtras(10),
        concluidoEm: diasAtras(10),
        aguardandoResposta: false
    },
    {
        id: 1006,
        empresaId: 2,
        produto: "Conjunto de engrenagens",
        modo: "vender",
        status: "aberto",
        criadoEm: diasAtras(1),
        atualizadoEm: diasAtras(1),
        concluidoEm: null,
        aguardandoResposta: true
    },
    {
        id: 1007,
        empresaId: 3,
        produto: "Suportes metálicos",
        modo: "vender",
        status: "negociacao",
        criadoEm: diasAtras(4),
        atualizadoEm: diasAtras(2),
        concluidoEm: null,
        aguardandoResposta: true
    },
    {
        id: 1008,
        empresaId: 4,
        produto: "Conectores industriais",
        modo: "vender",
        status: "concluido",
        criadoEm: diasAtras(8),
        atualizadoEm: diasAtras(2),
        concluidoEm: diasAtras(2),
        aguardandoResposta: false
    },
    {
        id: 1009,
        empresaId: 5,
        produto: "Tubulações de aço",
        modo: "vender",
        status: "aberto",
        criadoEm: diasAtras(3),
        atualizadoEm: diasAtras(3),
        concluidoEm: null,
        aguardandoResposta: false
    },
    {
        id: 1010,
        empresaId: 6,
        produto: "Ferramentas de manutenção",
        modo: "vender",
        status: "concluido",
        criadoEm: diasAtras(18),
        atualizadoEm: diasAtras(6),
        concluidoEm: diasAtras(6),
        aguardandoResposta: false
    }
];

// Conversas fictícias, separadas por contexto.
const conversasDemo = [
    {
        id: 1,
        empresaId: 2,
        modo: "comprar",
        mensagem: "Enviamos uma atualização da proposta.",
        dias: 1,
        naoLidas: 2
    },
    {
        id: 2,
        empresaId: 3,
        modo: "comprar",
        mensagem: "Podemos confirmar o prazo de entrega?",
        dias: 2,
        naoLidas: 0
    },
    {
        id: 3,
        empresaId: 4,
        modo: "vender",
        mensagem: "Gostaríamos de solicitar um orçamento.",
        dias: 1,
        naoLidas: 3
    },
    {
        id: 4,
        empresaId: 5,
        modo: "vender",
        mensagem: "Aguardamos sua confirmação.",
        dias: 3,
        naoLidas: 1
    }
];


/* ==========================================================
   02 — ESTADO DA INTERFACE
   Armazena o modo ativo, filtros e pesquisa.
   ========================================================== */

const estado = {
    modo: "comprar",
    periodo: 30,
    status: "todos",
    empresa: "todas",
    busca: "",
    indicador: null
};


/* ==========================================================
   03 — ELEMENTOS HTML
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
    btnTodasMensagens: document.getElementById("btnTodasMensagens")
};


/* ==========================================================
   04 — FUNÇÕES AUXILIARES
   Formatam datas, localizam empresas e tratam textos.
   ========================================================== */

// Localiza o nome de uma empresa pelo identificador.
function obterEmpresa(id) {
    return empresasDemo.find(empresa => empresa.id === id);
}

// Formata datas no padrão brasileiro.
function formatarData(dataISO) {
    if (!dataISO) return "—";

    const [ano, mes, dia] = dataISO.split("-");

    return `${dia}/${mes}/${ano}`;
}

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

// Impede a inserção de HTML não confiável.
// Será útil também durante a integração com o banco.
function escaparHTML(valor) {
    return String(valor).replace(/[&<>"']/g, caractere => {
        const entidades = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entidades[caractere];
    });
}

// Traduz os status para a interface.
function nomeStatus(status) {
    const nomes = {
        aberto: "Aberto",
        negociacao: "Em negociação",
        concluido: "Concluído",
        cancelado: "Cancelado"
    };

    return nomes[status] || status;
}


/* ==========================================================
   05 — ALTERNÂNCIA COMPRAR / VENDER
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

    atualizarDashboard();
}


/* ==========================================================
   06 — FILTRAGEM DE PEDIDOS
   Aplica modo, período, status, empresa e pesquisa.
   ========================================================== */

function obterPedidosFiltrados() {

    return pedidosDemo.filter(pedido => {

        // Apenas pedidos relacionados ao modo selecionado.
        if (pedido.modo !== estado.modo) {
            return false;
        }

        // Considera a criação do pedido no período escolhido.
        if (calcularDias(pedido.criadoEm) > estado.periodo) {
            return false;
        }

        // Filtra pelo status selecionado.
        if (
            estado.status !== "todos" &&
            pedido.status !== estado.status
        ) {
            return false;
        }

        // Filtra pela empresa parceira.
        if (
            estado.empresa !== "todas" &&
            pedido.empresaId !== Number(estado.empresa)
        ) {
            return false;
        }

        // Pesquisa por número, empresa ou produto.
        if (estado.busca) {
            const empresa = obterEmpresa(pedido.empresaId);

            const conteudo = [
                pedido.id,
                pedido.produto,
                empresa?.nome || ""
            ].join(" ").toLowerCase();

            if (!conteudo.includes(estado.busca)) {
                return false;
            }
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
   07 — TABELA DE PEDIDOS
   Constrói as linhas a partir dos registros filtrados.
   ========================================================== */

function renderizarPedidos(pedidos) {

    elementos.totalPedidos.textContent =
        `${pedidos.length} pedido${pedidos.length === 1 ? "" : "s"}`;

    // Exibe uma mensagem quando nenhum registro é encontrado.
    if (pedidos.length === 0) {
        elementos.pedidosTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    Nenhum pedido encontrado para os filtros selecionados.
                </td>
            </tr>
        `;

        return;
    }

    // Ordena os pedidos pela última atualização.
    const ordenados = [...pedidos].sort((a, b) =>
        converterData(b.atualizadoEm) -
        converterData(a.atualizadoEm)
    );

    elementos.pedidosTableBody.innerHTML = ordenados.map(pedido => {

        const empresa = obterEmpresa(pedido.empresaId);

        return `
            <tr>
                <td>
                    <strong>#${pedido.id}</strong>
                </td>

                <td>
                    ${escaparHTML(empresa?.nome || "Empresa não encontrada")}
                </td>

                <td>
                    ${escaparHTML(pedido.produto)}
                </td>

                <td>
                    <span class="order-status ${pedido.status}">
                        ${nomeStatus(pedido.status)}
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
   08 — INDICADORES KPI
   Calcula as métricas com os dados do modo selecionado.
   ========================================================== */

function atualizarIndicadores() {

    // Mantém período, empresa e busca nos indicadores.
    // O filtro de status é aplicado apenas à tabela.
    const pedidosBase = pedidosDemo.filter(pedido => {

        if (pedido.modo !== estado.modo) return false;

        if (calcularDias(pedido.criadoEm) > estado.periodo) {
            return false;
        }

        if (
            estado.empresa !== "todas" &&
            pedido.empresaId !== Number(estado.empresa)
        ) {
            return false;
        }

        if (estado.busca) {
            const empresa = obterEmpresa(pedido.empresaId);

            const texto = [
                pedido.id,
                pedido.produto,
                empresa?.nome || ""
            ].join(" ").toLowerCase();

            if (!texto.includes(estado.busca)) return false;
        }

        return true;
    });

    const abertos = pedidosBase.filter(
        pedido => pedido.status === "aberto"
    ).length;

    const respostas = pedidosBase.filter(
        pedido => pedido.aguardandoResposta
    ).length;

    // Conclusões são contadas pela data de conclusão.
    const concluidos = pedidosDemo.filter(pedido =>
        pedido.modo === estado.modo &&
        pedido.status === "concluido" &&
        pedido.concluidoEm &&
        calcularDias(pedido.concluidoEm) <= estado.periodo &&
        (
            estado.empresa === "todas" ||
            pedido.empresaId === Number(estado.empresa)
        )
    ).length;

    // Total de mensagens não lidas no modo ativo.
    const mensagens = conversasDemo
        .filter(conversa => conversa.modo === estado.modo)
        .reduce((total, conversa) => total + conversa.naoLidas, 0);

    elementos.kpiAbertos.textContent = abertos;
    elementos.kpiRespostas.textContent = respostas;
    elementos.kpiMensagens.textContent = mensagens;
    elementos.kpiConcluidos.textContent = concluidos;
    elementos.mensagensCount.textContent = mensagens;
}


/* ==========================================================
   09 — FILTRO DE EMPRESAS
   Preenche a lista com as empresas demonstrativas.
   ========================================================== */

function preencherFiltroEmpresas() {

    elementos.filtroEmpresa.innerHTML = `
        <option value="todas">Todas as empresas</option>
    `;

    empresasDemo.forEach(empresa => {
        const opcao = document.createElement("option");

        opcao.value = String(empresa.id);
        opcao.textContent = empresa.nome;

        elementos.filtroEmpresa.appendChild(opcao);
    });
}


/* ==========================================================
   10 — GRÁFICO DE PRODUÇÃO
   Representa pedidos criados e concluídos por semana.
   ========================================================== */

function renderizarGrafico() {

    const pedidos = pedidosDemo.filter(pedido =>
        pedido.modo === estado.modo
    );

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
   11 — RADAR DE PEDIDOS
   Destaca registros sem resposta ou sem movimentação.
   ========================================================== */

function renderizarRadar() {

    const pedidos = pedidosDemo.filter(pedido =>
        pedido.modo === estado.modo &&
        pedido.status !== "concluido" &&
        pedido.status !== "cancelado"
    );

    const alertas = [];

    pedidos.forEach(pedido => {

        const empresa = obterEmpresa(pedido.empresaId);
        const diasParado = calcularDias(pedido.atualizadoEm);

        // Regra demonstrativa: resposta pendente.
        if (pedido.aguardandoResposta) {
            alertas.push({
                pedidoId: pedido.id,
                tipo: "atencao",
                titulo: `Pedido #${pedido.id} — Resposta pendente`,
                descricao: `${empresa?.nome || "Empresa"} aguarda acompanhamento.`
            });

            return;
        }

        // Regra demonstrativa: pedido parado há 3 dias ou mais.
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
   12 — CONVERSAS RECENTES
   Exibe mensagens fictícias relacionadas ao modo ativo.
   ========================================================== */

function renderizarConversas() {

    const conversas = conversasDemo.filter(
        conversa => conversa.modo === estado.modo
    );

    if (conversas.length === 0) {
        elementos.conversasRecentes.innerHTML = `
            <p class="empty-state">
                Nenhuma conversa disponível.
            </p>
        `;

        return;
    }

    elementos.conversasRecentes.innerHTML = conversas.map(conversa => {

        const empresa = obterEmpresa(conversa.empresaId);

        return `
            <div class="conversation-item">

                <div class="conversation-info">
                    <strong>
                        ${escaparHTML(empresa?.nome || "Empresa")}
                    </strong>

                    <span>
                        ${escaparHTML(conversa.mensagem)}
                    </span>
                </div>

                <div style="
                    display:flex;
                    align-items:center;
                    gap:12px;
                ">
                    ${conversa.naoLidas > 0 ? `
                        <span class="nav-count">
                            ${conversa.naoLidas}
                        </span>
                    ` : ""}

                    <span class="conversation-time">
                        Há ${conversa.dias} dia(s)
                    </span>
                </div>

            </div>
        `;
    }).join("");
}


/* ==========================================================
   13 — ATUALIZAÇÃO DO DASHBOARD
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
   14 — NAVEGAÇÃO LATERAL
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
   15 — EVENTOS DOS FILTROS
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
   16 — INTERAÇÃO DOS INDICADORES
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
   17 — AÇÕES DEMONSTRATIVAS
   Identifica funcionalidades que ainda terão páginas próprias.
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

        const pedidoId = Number(botao.dataset.pedido);

        alert(
            `Pedido #${pedidoId}\n\n` +
            "A visualização detalhada será implementada posteriormente."
        );
    });

    // Acesso ao futuro módulo de mensagens.
    elementos.btnTodasMensagens.addEventListener("click", () => {
        alert(
            "O módulo de chat entre empresas será integrado na SCRUM-20."
        );
    });
}


/* ==========================================================
   18 — INICIALIZAÇÃO DA HOME
   Executa a configuração quando a página estiver pronta.
   ========================================================== */

function iniciarHome() {

    // Identifica a empresa fictícia no cabeçalho.
    elementos.empresaAtiva.textContent = empresaDemo.nome;

    // Preenche filtros e ativa as interações.
    preencherFiltroEmpresas();
    configurarNavegacao();
    configurarFiltros();
    configurarIndicadores();
    configurarAcoes();

    // Apresenta o modo inicial de comprador.
    alterarModo("comprar");

    console.info(
        "[SERF] Home demonstrativa inicializada com sucesso."
    );
}

// O script utiliza defer no HTML.
// Portanto, os elementos já estarão disponíveis.
iniciarHome();


/* ==========================================================
   FIM — HOME.JS

   Próximas integrações:
   - Autenticação e perfil pelo Supabase.
   - Pedidos e empresas reais.
   - Histórico de status e indicadores.
   - Chat entre empresas (SCRUM-20).
   - Regras de acesso por empresa.
   ========================================================== */
