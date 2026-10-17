/* =========================================================================
   S.E.R.F. — CENTRAL DE ALERTAS (alertas.js)
   Lista as pendências da empresa a partir da view "alertas" (migration 015).
   As REGRAS ficam no banco; aqui só o texto, a ordenação e os filtros.
   Cada alerta leva à tela onde a pendência é resolvida.
   ========================================================================= */

"use strict";

(function () {

    const { escaparHTML, formatarMoeda, formatarData, dataLocalISO, tempoRelativo } = window.SERFUtils;

    const el = id => document.getElementById(id);

    const SEVERIDADES = [
        { chave: "urgente", titulo: "Urgentes", descricao: "Resolva primeiro: há prazo correndo ou venda travada." },
        { chave: "atencao", titulo: "Atenção", descricao: "Próximos passos dos seus pedidos e do seu estoque." },
        { chave: "info", titulo: "Informativos", descricao: "Para acompanhar: nada travado." }
    ];

    const METODOS = { PIX: "Pix", BOLETO: "boleto", CARTAO: "pagamento no cartão" };

    const estado = {
        alertas: [],
        papel: "todos",          // "todos" | "fornecedor" | "comprador"
        severidade: "todas",     // "todas" | chave de SEVERIDADES
        carregamento: "carregando",
        erro: ""
    };


    /* =====================================================================
       1. TEXTO DE CADA TIPO DE ALERTA
       ===================================================================== */

    const linkPedido = a => `home.html?pedido=${encodeURIComponent(a.id_pedido)}`;
    const pedidoN = a => `pedido #${a.id_pedido}`;
    const valor = a => formatarMoeda(a.valor);
    const quando = data => (data ? formatarData(dataLocalISO(data)) : "—");
    const unidades = n => `${n} un.`;

    // codigo → { titulo, descricao, acao, link }
    const TIPOS = {
        RESPONDER_PEDIDO: {
            icone: "✉",
            titulo: a => `Responda o ${pedidoN(a)}`,
            descricao: a => `${a.parceiro_nome} pediu ${unidades(a.quantidade)} de ${a.produto_nome} (${valor(a)}) ${tempoRelativo(a.referencia)}. Confirme ou recuse.`,
            acao: "Responder pedido",
            link: linkPedido
        },
        APROVAR_PRAZO: {
            icone: "📅",
            titulo: a => `Analise o pagamento a prazo do ${pedidoN(a)}`,
            descricao: a => `${a.parceiro_nome} pediu faturamento a prazo de ${valor(a)}. Aprove ou recuse a análise de crédito.`,
            acao: "Analisar prazo",
            link: linkPedido
        },
        EMITIR_NFE: {
            icone: "🧾",
            titulo: a => `Emita a NF-e do ${pedidoN(a)}`,
            descricao: a => `Pagamento de ${a.parceiro_nome} liberado. A nota fiscal é obrigatória para enviar a mercadoria.`,
            acao: "Emitir NF-e",
            link: linkPedido
        },
        PRONTO_PARA_ENVIO: {
            icone: "📦",
            titulo: a => `${pedidoN(a).replace(/^p/, "P")} pronto para envio`,
            descricao: a => `NF-e autorizada. Marque como enviado quando ${unidades(a.quantidade)} de ${a.produto_nome} saírem para ${a.parceiro_nome}.`,
            acao: "Atualizar status",
            link: linkPedido
        },
        CONFIRMAR_ENTREGA: {
            icone: "🚚",
            titulo: a => `Confirme a entrega do ${pedidoN(a)}`,
            descricao: a => `Enviado ${tempoRelativo(a.referencia)}. Marque como entregue quando ${a.parceiro_nome} receber.`,
            acao: "Atualizar status",
            link: linkPedido
        },
        SEM_ESTOQUE: {
            icone: "⛔",
            titulo: a => `Sem estoque: ${a.produto_nome}`,
            descricao: a => `Restam ${unidades(a.quantidade)}, abaixo do pedido mínimo (${unidades(a.detalhe)}): ninguém consegue comprar este produto.`,
            acao: "Ver meus produtos",
            link: () => "catalogo.html?modo=vender"
        },
        ESTOQUE_BAIXO: {
            icone: "📉",
            titulo: a => `Estoque baixo: ${a.produto_nome}`,
            descricao: a => `Restam ${unidades(a.quantidade)} (pedido mínimo: ${unidades(a.detalhe)}). Reponha antes de travar as vendas.`,
            acao: "Ver meus produtos",
            link: () => "catalogo.html?modo=vender"
        },
        CANCELADO_COMPRADOR: {
            icone: "✕",
            titulo: a => `${pedidoN(a).replace(/^p/, "P")} cancelado pelo comprador`,
            descricao: a => `${a.parceiro_nome} cancelou ${tempoRelativo(a.referencia)}. Motivo: “${a.detalhe}”.`,
            acao: "Ver pedido",
            link: linkPedido
        },
        PAGAR_PEDIDO: {
            icone: "💳",
            titulo: a => `Pague o ${pedidoN(a)}`,
            descricao: a => {
                if (a.detalhe === "prazo recusado") {
                    return `${a.parceiro_nome} recusou o pagamento a prazo. Escolha outra forma para pagar ${valor(a)}.`;
                }
                if (a.vencimento) {
                    return `Cobrança de ${valor(a)} gerada. Vence em ${quando(a.vencimento)}.`;
                }
                return `${a.parceiro_nome} confirmou o pedido. Escolha a forma de pagamento (${valor(a)}) para liberar o envio.`;
            },
            acao: "Pagar",
            link: linkPedido
        },
        COBRANCA_VENCIDA: {
            icone: "⏰",
            titulo: a => `Cobrança vencida no ${pedidoN(a)}`,
            descricao: a => `O ${METODOS[a.detalhe] || "pagamento"} de ${valor(a)} venceu em ${quando(a.vencimento)}. Gere uma nova cobrança para não perder o pedido.`,
            acao: "Gerar nova cobrança",
            link: linkPedido
        },
        FATURA_A_PRAZO: {
            icone: "📅",
            titulo: a => `Fatura a prazo do ${pedidoN(a)}`,
            descricao: a => `${valor(a)} para ${a.parceiro_nome}, vencimento em ${quando(a.vencimento)}.`,
            acao: "Ver fatura",
            link: linkPedido
        },
        MENSAGENS: {
            icone: "💬",
            titulo: a => {
                const n = Number(a.detalhe) || 1;
                return `${n} mensage${n === 1 ? "m não lida" : "ns não lidas"} no ${pedidoN(a)}`;
            },
            descricao: a => `${a.parceiro_nome} escreveu ${tempoRelativo(a.referencia)} sobre ${a.produto_nome}.`,
            acao: "Abrir conversa",
            link: linkPedido
        }
    };

    // Tipo novo no banco e ainda não descrito aqui: aparece de forma genérica.
    const TIPO_GENERICO = {
        icone: "•",
        titulo: a => a.id_pedido ? `Pendência no ${pedidoN(a)}` : "Pendência",
        descricao: a => a.produto_nome || "",
        acao: "Ver",
        link: a => (a.id_pedido ? linkPedido(a) : "home.html")
    };


    /* =====================================================================
       2. DADOS
       ===================================================================== */

    const ORDEM_SEVERIDADE = { urgente: 0, atencao: 1, info: 2 };

    function ordenar(a, b) {
        const severidade = ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade];
        if (severidade !== 0) return severidade;

        // Pendências: a mais antiga primeiro. Informativos: o mais recente primeiro.
        const ta = new Date(a.referencia || 0).getTime();
        const tb = new Date(b.referencia || 0).getTime();
        return a.severidade === "info" ? tb - ta : ta - tb;
    }

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
        const tipo = TIPOS[alerta.codigo] || TIPO_GENERICO;
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
