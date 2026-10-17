/* ==========================================================
   S.E.R.F. — HOME / EVENTOS.JS
   Navegação lateral, eventos dos filtros, indicadores e ações da
   Home (seções 16–19).

   A Home é dividida em scripts clássicos que compartilham o escopo
   global, carregados nesta ordem (todos com defer):
     estado.js → dashboard.js → eventos.js → chat.js →
     pedido-modal.js → tempo-real.js → inicializacao.js
   Só inicializacao.js executa algo ao carregar (iniciarHome()).
   ========================================================== */

"use strict";


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
