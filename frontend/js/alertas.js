/* =========================================================================
   S.E.R.F. — CENTRAL DE ALERTAS (alertas.js)
   Lista as pendências da empresa a partir da view "alertas" (migration 015).
   As REGRAS ficam no banco; aqui só o texto, a ordenação e os filtros.
   Cada alerta leva à tela onde a pendência é resolvida.
   ========================================================================= */

"use strict";

(function () {

    const { escaparHTML } = window.SERFUtils;
    const { descrever, ordenar, ORDEM_SEVERIDADE, quando } = window.SERFAlertasRegras;

    const el = id => document.getElementById(id);

    const SEVERIDADES = [
        { chave: "urgente", titulo: "Urgentes", descricao: "Resolva primeiro: há prazo correndo ou venda travada." },
        { chave: "atencao", titulo: "Atenção", descricao: "Próximos passos dos seus pedidos e do seu estoque." },
        { chave: "info", titulo: "Informativos", descricao: "Para acompanhar: nada travado." }
    ];

    const estado = {
        alertas: [],
        papel: "todos",          // "todos" | "fornecedor" | "comprador"
        severidade: "todas",     // "todas" | chave de SEVERIDADES
        carregamento: "carregando",
        erro: ""
    };


    /* =====================================================================
       1. TEXTO DE CADA TIPO DE ALERTA → js/dominio/alertas.js
       ===================================================================== */

    /* =====================================================================
       2. DADOS
       ===================================================================== */

    async function carregar() {
        const alertas = await window.SERFDados.pendencias.listarAlertas();

        estado.alertas = alertas
            .filter(a => ORDEM_SEVERIDADE[a.severidade] !== undefined)
            .sort(ordenar);
    }

    function alertasFiltrados({ ignorarSeveridade = false } = {}) {
        return estado.alertas.filter(a =>
            (estado.papel === "todos" || a.papel === estado.papel) &&
            (ignorarSeveridade || estado.severidade === "todas" || a.severidade === estado.severidade));
    }


    /* =====================================================================
       3. RENDERIZAÇÃO
       ===================================================================== */

    function renderizarResumo() {
        const base = alertasFiltrados({ ignorarSeveridade: true });

        el("alertasResumo").innerHTML = SEVERIDADES.map(s => {
            const total = base.filter(a => a.severidade === s.chave).length;
            const ativo = estado.severidade === s.chave;

            return `
                <button type="button" class="alerta-resumo ${s.chave} ${ativo ? "active" : ""}"
                        data-severidade="${s.chave}" aria-pressed="${ativo}">
                    <strong>${total}</strong>
                    <span>${escaparHTML(s.titulo)}</span>
                </button>
            `;
        }).join("");
    }

    function cartao(alerta) {
        const tipo = descrever(alerta);
        const papel = alerta.papel === "fornecedor" ? "Venda" : "Compra";

        return `
            <article class="alerta ${alerta.severidade}" data-codigo="${escaparHTML(alerta.codigo)}">
                <span class="alerta-icone" aria-hidden="true">${tipo.icone}</span>
                <div class="alerta-texto">
                    <h3>${escaparHTML(tipo.titulo(alerta))}</h3>
                    <p>${escaparHTML(tipo.descricao(alerta))}</p>
                    <small>${escaparHTML(papel)}${alerta.referencia ? ` · desde ${escaparHTML(quando(alerta.referencia))}` : ""}</small>
                </div>
                <a class="alerta-acao" href="${escaparHTML(tipo.link(alerta))}">${escaparHTML(tipo.acao)} →</a>
            </article>
        `;
    }

    function renderizarLista() {
        const lista = el("alertasLista");

        if (estado.carregamento === "carregando") {
            lista.innerHTML = `<p class="empty-state">Verificando pendências...</p>`;
            return;
        }

        if (estado.carregamento === "erro") {
            lista.innerHTML = `
                <p class="empty-state alerta-erro">
                    <strong>Não foi possível carregar os alertas.</strong><br>
                    <small>${escaparHTML(estado.erro)}</small>
                </p>`;
            return;
        }

        const alertas = alertasFiltrados();

        if (alertas.length === 0) {
            const filtrando = estado.severidade !== "todas" || estado.papel !== "todos";
            lista.innerHTML = `
                <div class="alertas-vazio">
                    <span aria-hidden="true">✓</span>
                    <h2>${filtrando ? "Nada neste filtro" : "Tudo em dia"}</h2>
                    <p>${filtrando
                        ? "Não há alertas com os filtros selecionados."
                        : "Nenhuma pendência nos seus pedidos, pagamentos ou estoque."}</p>
                </div>`;
            return;
        }

        lista.innerHTML = SEVERIDADES
            .map(s => ({ ...s, itens: alertas.filter(a => a.severidade === s.chave) }))
            .filter(grupo => grupo.itens.length > 0)
            .map(grupo => `
                <section class="alertas-grupo" aria-labelledby="grupo-${grupo.chave}">
                    <header>
                        <h2 id="grupo-${grupo.chave}">${escaparHTML(grupo.titulo)} <span>${grupo.itens.length}</span></h2>
                        <p>${escaparHTML(grupo.descricao)}</p>
                    </header>
                    ${grupo.itens.map(cartao).join("")}
                </section>
            `).join("");
    }

    function renderizar() {
        renderizarResumo();
        renderizarLista();

        el("alertasAtualizado").textContent = estado.carregamento === "ok"
            ? `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
            : "";
    }


    /* =====================================================================
       4. INTERAÇÃO E INICIALIZAÇÃO
       ===================================================================== */

    async function recarregar() {
        try {
            await carregar();
            estado.carregamento = "ok";
        } catch (erro) {
            console.error("[SERF:Alertas] Falha ao carregar alertas:", erro);
            estado.carregamento = "erro";
            estado.erro = erro.message || "Erro de comunicação com o Supabase";
        }

        renderizar();
        window.SERFAlertas?.atualizarContagem();
    }

    function configurarFiltros() {
        el("filtroPapelAlertas").addEventListener("click", evento => {
            const botao = evento.target.closest("[data-papel]");
            if (!botao) return;

            estado.papel = botao.dataset.papel;
            document.querySelectorAll("#filtroPapelAlertas [data-papel]").forEach(b => {
                const ativo = b === botao;
                b.classList.toggle("active", ativo);
                b.setAttribute("aria-pressed", String(ativo));
            });
            renderizar();
        });

        // Clicar num total filtra pela severidade; clicar de novo limpa.
        el("alertasResumo").addEventListener("click", evento => {
            const botao = evento.target.closest("[data-severidade]");
            if (!botao) return;

            estado.severidade = estado.severidade === botao.dataset.severidade ? "todas" : botao.dataset.severidade;
            renderizar();
        });

        el("btnAtualizarAlertas").addEventListener("click", recarregar);

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && estado.carregamento !== "carregando") recarregar();
        });
    }

    async function exibirEmpresa() {
        const empresa = await window.SERFUtils.obterEmpresaLogada().catch(() => null);
        const nome = empresa?.nome || "Empresa";

        el("empresaAtiva").textContent = nome;
        const avatar = document.querySelector(".profile-avatar");
        if (avatar) avatar.textContent = nome.trim().charAt(0).toUpperCase();

        // Filtro Compras/Vendas só faz sentido para quem tem os dois papéis
        el("filtroPapelGrupo").hidden = empresa?.perfil !== "Ambos";
    }

    async function iniciar() {
        configurarFiltros();
        renderizar();

        if (!(await window.serfSessao)) return;

        await Promise.all([exibirEmpresa(), recarregar()]);
    }

    iniciar();
})();
