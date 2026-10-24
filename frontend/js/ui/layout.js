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
    const ITENS = [
        { pagina: "home", icone: "▦", rotulo: "Home", href: "home.html#visao-geral", local: "#visao-geral" },
        { pagina: "empresas", icone: "▤", rotulo: "Empresas", href: "empresas.html" },
        {
            // Sem id no rótulo: nenhum outro script consegue trocar "Catálogo" por outro nome
            pagina: "produtos", icone: "▣", rotulo: "Catálogo", href: "catalogo.html", local: "#produtos"
        },
        { pagina: "pedidos", icone: "☷", rotulo: "Pedidos", href: "home.html#pedidos", naHome: { href: "#pedidos" } },
        {
            pagina: "mensagens", icone: "✉", rotulo: "Mensagens", href: "home.html#mensagens", naHome: { href: "#mensagens" },
            contadorEm: ["home", "produtos"]
        },
        { pagina: "cotacoes", icone: "⇄", rotulo: "Cotações", href: "cotacoes.html" },
        { pagina: "relatorios", icone: "▥", rotulo: "Relatórios", href: "relatorios.html" },
        { pagina: "alertas", icone: "⚑", rotulo: "Alertas", href: "alertas.html", contadorAlertas: true }
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

        link.append(
            criar("span", { class: "nav-icon" }, item.icone),
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

    window.SERFLayout = Object.freeze({ ITENS, renderizarMenu });
})();
