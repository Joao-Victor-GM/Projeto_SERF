/* ==========================================================
   S.E.R.F. — PRIMEIROS-PASSOS.JS
   Checklist da Home para empresas novas. O progresso vem do
   banco (primeiros_passos(), migration 019): o cartão some
   sozinho quando tudo está feito, ou quando o usuário oculta.

   Depende de: dados/pendencias.repositorio.js
   ========================================================== */

"use strict";

(function () {

    const secao = document.getElementById("primeirosPassos");
    if (!secao) return;

    // chave do progresso → texto e destino. "aplica" = passo vale para o perfil
    const PASSOS = [
        {
            chave: "perfil_completo",
            titulo: "Complete o cadastro da empresa",
            descricao: "Telefone e nicho (e cidade/UF para fornecedores) aparecem para os parceiros.",
            acao: "Completar", link: "perfil.html"
        },
        {
            chave: "cadastrou_produto",
            titulo: "Cadastre seu primeiro produto",
            descricao: "Com preço de atacado, pedido mínimo e estoque.",
            acao: "Cadastrar", link: "catalogo.html?modo=vender&novo=1"
        },
        {
            chave: "cnpj_verificado",
            titulo: "Verifique seu CNPJ",
            descricao: "Conferimos na Receita Federal e você ganha o selo de fornecedor homologado.",
            acao: "Verificar", link: "perfil.html#homologacao"
        },
        {
            chave: "fez_pedido",
            titulo: "Faça seu primeiro pedido",
            descricao: "Monte um carrinho com produtos de vários fornecedores.",
            acao: "Ver catálogo", link: "catalogo.html"
        },
        {
            chave: "enviou_mensagem",
            titulo: "Converse com um parceiro",
            descricao: "Cada pedido tem um chat para combinar entrega e condições.",
            acao: "Ver pedidos", link: "#pedidos"
        }
    ];

    let chaveOculto = null;

    function oculto() {
        try { return localStorage.getItem(chaveOculto) === "1"; } catch { return false; }
    }

    function renderizar(progresso) {
        const aplicaveis = PASSOS.filter(passo => progresso[passo.chave] !== null && progresso[passo.chave] !== undefined);
        const feitos = aplicaveis.filter(passo => progresso[passo.chave] === true).length;

        if (feitos === aplicaveis.length || oculto()) {
            secao.hidden = true;
            return;
        }

        const proximo = aplicaveis.find(passo => !progresso[passo.chave]);

        secao.innerHTML = `
            <div class="panel-heading">
                <div>
                    <h2 id="ppTitulo">Primeiros passos no S.E.R.F.</h2>
                    <p>${feitos} de ${aplicaveis.length} concluídos</p>
                </div>
                <button type="button" class="btn-text" id="ppOcultar">Ocultar</button>
            </div>
            <div class="pp-progresso" role="progressbar" aria-label="Primeiros passos"
                 aria-valuemin="0" aria-valuemax="${aplicaveis.length}" aria-valuenow="${feitos}">
                <span data-css="width:${Math.round((feitos / aplicaveis.length) * 100)}%"></span>
            </div>
            <ol class="pp-lista">
                ${aplicaveis.map(passo => {
                    const feito = progresso[passo.chave] === true;
                    return `
                        <li class="pp-passo${feito ? " feito" : ""}${passo === proximo ? " proximo" : ""}">
                            <span class="pp-marca" aria-hidden="true">${feito ? '<svg class="serf-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>' : ""}</span>
                            <div class="pp-texto">
                                <strong>${passo.titulo}</strong>
                                <span>${passo.descricao}</span>
                            </div>
                            ${feito
                                ? '<span class="sr-only">Concluído</span>'
                                : `<a class="pp-acao" href="${passo.link}">${passo.acao}</a>`}
                        </li>`;
                }).join("")}
            </ol>`;

        secao.hidden = false;

        secao.querySelector("#ppOcultar").addEventListener("click", () => {
            try { localStorage.setItem(chaveOculto, "1"); } catch { /* sem armazenamento */ }
            secao.hidden = true;
        });
    }

    async function atualizar() {
        try {
            const progresso = await window.SERFDados.pendencias.primeirosPassos();
            if (progresso) renderizar(progresso);
        } catch (erro) {
            // Sem a migration 019: só não mostra o checklist
            console.warn("[SERF:Home] Primeiros passos indisponíveis:", erro.message || erro);
        }
    }

    (async () => {
        if (!(await window.serfSessao)) return;
        const empresa = await window.SERFUtils.obterEmpresaLogada().catch(() => null);
        chaveOculto = `serf-primeiros-passos-oculto-${empresa?.authUserId || "anonimo"}`;
        atualizar();
    })();

    window.addEventListener("serf:pedido-criado", atualizar);
})();
