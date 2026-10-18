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
    // Botão ☰ do celular: tratado por js/ui/layout.js (todas as páginas)

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

// Espera após a última tecla antes de filtrar (digitação contínua = 1 render)
const ATRASO_BUSCA_MS = 150;

function configurarFiltros() {

    elementos.filtroPeriodo.addEventListener("change", evento => {
        estado.periodo = Number(evento.target.value);
        atualizarDashboard();
    });

    // Status e empresa afetam só a listagem (gráfico/radar/conversas não mudam)
    elementos.filtroStatus.addEventListener("change", evento => {
        estado.status = evento.target.value;
        atualizarListagem();
    });

    elementos.filtroEmpresa.addEventListener("change", evento => {
        estado.empresa = evento.target.value;
        atualizarListagem();
    });

    // Busca com debounce: uma renderização por pausa na digitação,
    // não uma por tecla. Só tabela e KPIs dependem da busca.
    // As sugestões de fornecedores ficam em configurarSugestoesFornecedores().
    let buscaAgendada = null;
    elementos.buscaGlobal.addEventListener("input", evento => {
        estado.busca = evento.target.value.trim().toLowerCase();
        clearTimeout(buscaAgendada);
        buscaAgendada = setTimeout(atualizarListagem, ATRASO_BUSCA_MS);
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

    configurarSugestoesFornecedores();
}


/* ==========================================================
   17.1 — SUGESTÕES DE FORNECEDORES (auto-complete da busca)
   Os dados vêm de SERFDados.fornecedores (camada de dados);
   aqui só há DOM e eventos.
   ========================================================== */

// Espera maior que a da tabela: cada pausa gera uma consulta ao servidor
const ATRASO_SUGESTOES_MS = 300;

function configurarSugestoesFornecedores() {

    const campo = elementos.buscaGlobal;
    const lista = document.getElementById("resultadoBusca");
    const repositorio = window.SERFDados?.fornecedores;

    if (!campo || !lista) return;

    if (!repositorio) {
        console.warn("[SERF:Home] SERFDados.fornecedores não carregado: busca sem sugestões.");
        return;
    }

    let sugestaoAgendada = null;

    const esconder = () => {
        lista.style.display = "none";
    };

    const desenhar = sugestoes => {
        lista.replaceChildren(...sugestoes.map(fornecedor => {
            const item = document.createElement("li");
            item.style.padding = "10px";
            item.style.cursor = "pointer";
            item.style.borderBottom = "1px solid var(--serf-borda)";
            item.textContent = fornecedor.nome;

            item.addEventListener("click", () => {
                window.location.href = `empresas.html?busca=${encodeURIComponent(fornecedor.nome)}`;
            });

            return item;
        }));

        lista.style.display = "block";
    };

    campo.addEventListener("input", () => {
        clearTimeout(sugestaoAgendada);

        const termo = campo.value.trim();

        if (termo.length < 2) {
            esconder();
            return;
        }

        sugestaoAgendada = setTimeout(async () => {
            let sugestoes;

            try {
                sugestoes = await repositorio.sugerir(termo);
            } catch (erro) {
                console.error("[SERF:Home] Falha ao buscar sugestões de fornecedores:", erro);
                esconder();
                return;
            }

            // Resposta atrasada de um termo que já mudou: ignora
            if (campo.value.trim() !== termo) return;

            if (sugestoes.length === 0) {
                esconder();
                return;
            }

            desenhar(sugestoes);
        }, ATRASO_SUGESTOES_MS);
    });

    // Fecha ao clicar fora do campo e da lista, ou com Esc
    document.addEventListener("click", evento => {
        if (evento.target !== campo && !lista.contains(evento.target)) esconder();
    });

    campo.addEventListener("keydown", evento => {
        if (evento.key === "Escape") esconder();
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

            atualizarListagem();
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

        const pedido = obterPedido(Number(botao.dataset.pedido));

        if (pedido) {
            abrirDetalhesPedido(pedido);
        }
    });

    // Tabela paginada: acrescenta mais linhas sem refiltrar o resto do painel
    elementos.btnMaisPedidos?.addEventListener("click", mostrarMaisPedidos);

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
