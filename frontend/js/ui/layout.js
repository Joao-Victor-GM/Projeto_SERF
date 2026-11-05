/* ==========================================================
   S.E.R.F. — UI / LAYOUT.JS
   Menu lateral das páginas internas, definido UMA vez.
   Antes o mesmo menu estava copiado em 6 HTMLs (e o botão de
   abrir o menu no celular, em 6 scripts): cada item novo exigia
   editar todos.

   Uso (logo depois da <nav>, SEM defer — desenha antes da 1ª pintura):
     <nav class="sidebar-nav" aria-label="Menu principal" data-pagina-atual="relatorios"></nav>
     <script src="../../js/ui/layout.js"></script>
   ========================================================== */

"use strict";

(function () {

    // pagina: identificador do item (data-page) e da página atual
    // href: destino a partir das outras páginas
    // local: destino quando o usuário já está na página do item
    // naHome: ajustes quando a página atual é a Home (seções da própria Home)
    // contadorEm: páginas que mostram o contador de mensagens (#mensagensCount)
    const svg = caminhos =>
        `<svg class="serf-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caminhos}</svg>`;

    const ICONES = {
        home: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
        empresas: svg('<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>'),
        produtos: svg('<path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/>'),
        pedidos: svg('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>'),
        mensagens: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
        cotacoes: svg('<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>'),
        relatorios: svg('<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>'),
        alertas: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
        menu: svg('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>'),
        lua: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
        sol: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>')
    };

    const ITENS = [
        { pagina: "home", icone: ICONES.home, rotulo: "Home", href: "home.html#visao-geral", local: "#visao-geral" },
        { pagina: "empresas", icone: ICONES.empresas, rotulo: "Empresas", href: "empresas.html" },
        {
            // Sem id no rótulo: nenhum outro script consegue trocar "Catálogo" por outro nome
            pagina: "produtos", icone: ICONES.produtos, rotulo: "Catálogo", href: "catalogo.html", local: "#produtos"
        },
        { pagina: "pedidos", icone: ICONES.pedidos, rotulo: "Pedidos", href: "home.html#pedidos", naHome: { href: "#pedidos" } },
        {
            pagina: "mensagens", icone: ICONES.mensagens, rotulo: "Mensagens", href: "home.html#mensagens", naHome: { href: "#mensagens" },
            contadorEm: ["home", "produtos"]
        },
        { pagina: "cotacoes", icone: ICONES.cotacoes, rotulo: "Cotações", href: "cotacoes.html" },
        { pagina: "relatorios", icone: ICONES.relatorios, rotulo: "Relatórios", href: "relatorios.html" },
        { pagina: "alertas", icone: ICONES.alertas, rotulo: "Alertas", href: "alertas.html", contadorAlertas: true }
    ];

    function criar(tag, atributos = {}, texto) {
        const elemento = document.createElement(tag);
        Object.entries(atributos).forEach(([nome, valor]) => {
            if (valor !== undefined && valor !== null && valor !== false) elemento.setAttribute(nome, valor === true ? "" : valor);
        });
        if (texto !== undefined) elemento.textContent = texto;
        return elemento;
    }

    function itemDoMenu(item, paginaAtual) {
        const naHome = paginaAtual === "home" ? item.naHome || {} : {};
        const atual = item.pagina === paginaAtual;

        const href = naHome.href || (atual && item.local) || item.href;
        const link = criar("a", {
            href,
            class: atual ? "nav-item active" : "nav-item",
            "aria-current": atual ? "page" : null,
            "data-page": item.pagina
        });

        const icone = criar("span", { class: "nav-icon", "aria-hidden": "true" });
        icone.innerHTML = item.icone;

        link.append(
            icone,
            criar("span", { id: item.idRotulo }, naHome.rotulo || item.rotulo)
        );

        if (item.contadorEm?.includes(paginaAtual)) {
            link.append(criar("span", { class: "nav-count", id: "mensagensCount" }, "0"));
        }

        if (item.contadorAlertas) {
            link.append(criar("span", { class: "nav-count", "data-alertas-contagem": true, hidden: true }));
        }

        return link;
    }

    function renderizarMenu(nav) {
        const paginaAtual = nav.dataset.paginaAtual;
        nav.replaceChildren(...ITENS.map(item => itemDoMenu(item, paginaAtual)));
    }

    document.querySelectorAll("nav.sidebar-nav[data-pagina-atual]").forEach(renderizarMenu);

    function definirMenuAberto(aberto) {
        const sidebar = document.getElementById("sidebar");
        if (!sidebar) return;

        sidebar.classList.toggle("open", aberto);
        document.getElementById("menuToggle")?.setAttribute("aria-expanded", String(aberto));
    }

    const menuAberto = () => document.getElementById("sidebar")?.classList.contains("open");

    // Botão ☰ (celular): delegação, funciona antes mesmo do cabeçalho existir.
    // No celular o menu aberto cobre o ☰: fecha também com toque fora ou Esc
    // (antes não havia como fechar sem sair da página).
    document.addEventListener("click", evento => {
        if (evento.target.closest("#menuToggle")) {
            definirMenuAberto(!menuAberto());
            return;
        }

        if (menuAberto() && !evento.target.closest("#sidebar")) {
            definirMenuAberto(false);
        }
    });

    document.addEventListener("keydown", evento => {
        if (evento.key === "Escape" && menuAberto()) {
            definirMenuAberto(false);
            document.getElementById("menuToggle")?.focus();
        }
    });

    function aplicarIconesBarraSuperior() {
        const botaoMenu = document.getElementById("menuToggle");
        if (botaoMenu && !botaoMenu.querySelector("svg")) {
            botaoMenu.innerHTML = ICONES.menu;
        }

        document.querySelectorAll(".tema-icone-escuro").forEach(el => {
            if (!el.querySelector("svg")) el.innerHTML = ICONES.lua;
        });
        document.querySelectorAll(".tema-icone-claro").forEach(el => {
            if (!el.querySelector("svg")) el.innerHTML = ICONES.sol;
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", aplicarIconesBarraSuperior, { once: true });
    } else {
        aplicarIconesBarraSuperior();
    }

    window.SERFLayout = Object.freeze({ ITENS, renderizarMenu });
})();
