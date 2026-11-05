/* ==========================================================
   S.E.R.F. — NOTIFICACOES.JS
   Sino de notificações no topo de todas as páginas internas.
   - Contador de não lidas; lista das 20 mais recentes.
   - Tempo real (Realtime na tabela notificacoes, migration 023).
   - Clicar numa notificação marca como lida e leva ao destino.
   - Sem a migration 023, o sino não aparece (nada quebra).

   Depende de: utils.js, auth-check.js, dados/base.js,
   dados/notificacoes.repositorio.js, dominio/notificacoes.js.
   ========================================================== */

"use strict";

(function () {

    const { tempoRelativo } = window.SERFUtils;
    const regras = window.SERFNotificacoesRegras;
    const repositorio = () => window.SERFDados.notificacoes;

    const topo = document.querySelector(".topbar-right");
    if (!topo || !regras) return;

    const estado = { lista: [], aberto: false, canal: null, recarga: null };

    function criar(tag, classe, texto) {
        const elemento = document.createElement(tag);
        if (classe) elemento.className = classe;
        if (texto !== undefined) elemento.textContent = texto;
        return elemento;
    }

    const svg = caminhos =>
        `<svg class="serf-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caminhos}</svg>`;

    const ICONES_NOTIF = {
        SINO: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
        PEDIDO_RECEBIDO: svg('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>'),
        STATUS_PEDIDO: svg('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
        PEDIDO_CANCELADO: svg('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'),
        MENSAGEM_NOVA: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
        PAGAMENTO_CONFIRMADO: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>'),
        PRAZO_SOLICITADO: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
        NOVO_PRODUTO_SEGMENTO: svg('<path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/>'),
        COTACAO_NOVA: svg('<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>'),
        PROPOSTA_RECEBIDA: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>')
    };

    /* ---------------- ESTRUTURA ---------------- */

    const raiz = criar("div", "notif");
    raiz.hidden = true;

    const botao = criar("button", "icon-button notif-sino");
    botao.type = "button";
    botao.id = "notifSino";
    botao.setAttribute("aria-haspopup", "true");
    botao.setAttribute("aria-expanded", "false");
    botao.setAttribute("aria-controls", "notifPainel");
    const iconeSino = criar("span", "notif-icone");
    iconeSino.setAttribute("aria-hidden", "true");
    iconeSino.innerHTML = ICONES_NOTIF.SINO;
    botao.append(iconeSino);

    const contador = criar("span", "notif-contador");
    contador.hidden = true;
    botao.append(contador);

    const painel = criar("section", "notif-painel");
    painel.id = "notifPainel";
    painel.hidden = true;
    painel.setAttribute("aria-label", "Notificações");

    const cabecalho = criar("header", "notif-cabecalho");
    const titulo = criar("h2", null, "Notificações");
    const marcarTodas = criar("button", "notif-marcar", "Marcar todas como lidas");
    marcarTodas.type = "button";
    cabecalho.append(titulo, marcarTodas);

    const lista = criar("ul", "notif-lista");
    const vazio = criar("p", "notif-vazio", "Nada por aqui ainda. Pedidos, mensagens e oportunidades aparecem aqui.");

    painel.append(cabecalho, lista, vazio);
    raiz.append(botao, painel);

    // Antes do botão de tema (ou no fim da barra)
    topo.insertBefore(raiz, topo.querySelector(".btn-tema") || null);

    /* ---------------- DESENHO ---------------- */

    const naoLidas = () => estado.lista.filter(n => !n.lida_em).length;

    function atualizarContador() {
        const n = naoLidas();
        contador.hidden = n === 0;
        contador.textContent = n > 9 ? "9+" : String(n);
        botao.setAttribute("aria-label", n ? `Notificações: ${n} não lida${n === 1 ? "" : "s"}` : "Notificações");
        marcarTodas.disabled = n === 0;
    }

    function itemDe(n) {
        const { icone, titulo: tituloItem, texto, link } = regras.descrever(n);
        const item = criar("li", n.lida_em ? "notif-item" : "notif-item nao-lida");

        const acao = criar("a", "notif-link");
        acao.href = link;
        acao.dataset.id = String(n.id);

        const simbolo = criar("span", "notif-simbolo");
        simbolo.setAttribute("aria-hidden", "true");
        if (ICONES_NOTIF[n.tipo]) simbolo.innerHTML = ICONES_NOTIF[n.tipo];
        else simbolo.textContent = icone;

        const corpo = criar("span", "notif-corpo");
        corpo.append(criar("strong", null, tituloItem));
        if (texto) corpo.append(criar("span", "notif-texto", texto));
        corpo.append(criar("small", null, tempoRelativo(n.atualizada_em)));

        acao.append(simbolo, corpo);
        if (!n.lida_em) acao.append(criar("span", "sr-only", " (não lida)"));

        acao.addEventListener("click", evento => abrirNotificacao(evento, n, link));
        item.append(acao);
        return item;
    }

    function desenhar() {
        lista.replaceChildren(...estado.lista.map(itemDe));
        vazio.hidden = estado.lista.length > 0;
        atualizarContador();
    }

    /* ---------------- DADOS ---------------- */

    async function carregar() {
        estado.lista = await repositorio().listar(20);
        desenhar();
    }

    // Vários eventos seguidos (ex.: carrinho com 5 itens) = uma recarga só
    function agendarRecarga() {
        clearTimeout(estado.recarga);
        estado.recarga = setTimeout(() => carregar().catch(() => {}), 300);
    }

    async function abrirNotificacao(evento, n, link) {
        if (n.lida_em) return;           // segue o link normalmente
        evento.preventDefault();

        n.lida_em = new Date().toISOString();
        atualizarContador();
        try { await repositorio().marcarLida(n.id); } catch (erro) { console.warn("[SERF:Notificações]", erro.message); }

        window.location.href = link;
    }

    /* ---------------- PAINEL ---------------- */

    function abrir(aberto) {
        estado.aberto = aberto;
        painel.hidden = !aberto;
        botao.setAttribute("aria-expanded", String(aberto));
        if (aberto) {
            // Celular: o painel é fixo na tela, logo abaixo do sino (o topo quebra em linhas)
            painel.style.top = window.matchMedia("(max-width: 600px)").matches
                ? `${Math.round(botao.getBoundingClientRect().bottom + 8)}px`
                : "";
            desenhar();
            (lista.querySelector("a") || marcarTodas).focus();
        }
    }

    botao.addEventListener("click", () => abrir(!estado.aberto));

    marcarTodas.addEventListener("click", async () => {
        estado.lista.forEach(n => { n.lida_em = n.lida_em || new Date().toISOString(); });
        desenhar();
        // O botão fica desabilitado: o foco não pode se perder fora do painel
        (lista.querySelector("a") || botao).focus();
        try { await repositorio().marcarTodasLidas(); } catch (erro) { console.warn("[SERF:Notificações]", erro.message); }
    });

    document.addEventListener("keydown", evento => {
        if (evento.key !== "Escape" || !estado.aberto) return;
        abrir(false);
        botao.focus();
    });

    document.addEventListener("click", evento => {
        if (estado.aberto && !raiz.contains(evento.target)) abrir(false);
    });

    /* ---------------- INÍCIO ---------------- */

    async function iniciar() {
        if (!(await window.serfSessao)) return;

        try {
            await carregar();
        } catch (erro) {
            // Sem a migration 023 o sino fica escondido
            console.warn("[SERF:Notificações] Indisponível:", erro.message || erro);
            return;
        }

        raiz.hidden = false;
        estado.canal = await repositorio().assinarMudancas(agendarRecarga);

        // Ao voltar para a aba (o Realtime pode ter caído no meio tempo)
        document.addEventListener("visibilitychange", () => { if (!document.hidden) agendarRecarga(); });
    }

    window.SERFNotificacoes = Object.freeze({ recarregar: carregar, naoLidas });

    iniciar();
})();
