/* ==========================================================
   S.E.R.F. — ACOES-PENDENTES.JS
   Bloco "Precisa da sua ação" no topo da Home: as pendências
   mais importantes (urgentes e de atenção) da view "alertas",
   cada uma com o botão que a resolve. A lista completa fica
   em alertas.html.

   Depende de: utils.js, dominio/alertas.js, dados/pendencias.repositorio.js
   Atualiza em: início, volta à aba, "serf:dados-alterados" (Realtime)
   e "serf:pedido-criado" (carrinho/negociação).
   ========================================================== */

"use strict";

(function () {

    const lista = document.getElementById("acoesLista");
    const resumo = document.getElementById("acoesResumo");
    if (!lista || !resumo) return;

    const { escaparHTML } = window.SERFUtils;
    const { descrever, ordenar } = window.SERFAlertasRegras;

    const LIMITE = 5;
    const SEVERIDADES = ["urgente", "atencao"];

    function item(alerta) {
        const tipo = descrever(alerta);
        const link = tipo.link(alerta);

        return `
            <li class="acao-item ${alerta.severidade}">
                <span class="acao-icone" aria-hidden="true">${tipo.icone}</span>
                <div class="acao-texto">
                    <strong>${escaparHTML(tipo.titulo(alerta))}</strong>
                    <span>${escaparHTML(tipo.descricao(alerta))}</span>
                </div>
                <a class="acao-botao" href="${escaparHTML(link)}"
                   ${alerta.id_pedido ? `data-pedido="${alerta.id_pedido}"` : ""}>${escaparHTML(tipo.acao)}</a>
            </li>`;
    }

    async function atualizar() {
        let alertas;

        try {
            alertas = (await window.SERFDados.pendencias.listarAlertas())
                .filter(a => SEVERIDADES.includes(a.severidade))
                .sort(ordenar);
        } catch (erro) {
            // Sem a migration 015 o bloco some; o resto da Home segue normal
            console.warn("[SERF:Home] Pendências indisponíveis:", erro.message || erro);
            document.getElementById("acoes").hidden = true;
            return;
        }

        const urgentes = alertas.filter(a => a.severidade === "urgente").length;

        if (alertas.length === 0) {
            resumo.textContent = "Tudo em dia: nenhuma pendência nos seus pedidos, pagamentos ou estoque.";
            lista.innerHTML = "";
            lista.hidden = true;
        } else {
            resumo.textContent = alertas.length === 1
                ? "1 pendência" + (urgentes ? " urgente." : ".")
                : `${alertas.length} pendências${urgentes ? `, ${urgentes} urgente${urgentes === 1 ? "" : "s"}` : ""}.` +
                  (alertas.length > LIMITE ? ` Mostrando as ${LIMITE} mais importantes.` : "");
            lista.hidden = false;
            lista.innerHTML = alertas.slice(0, LIMITE).map(item).join("");
        }

        document.getElementById("acoes").classList.toggle("tudo-em-dia", alertas.length === 0);
        window.SERFAlertas?.atualizarContagem();
    }

    // Pedido: abre o modal aqui mesmo (sem recarregar a Home)
    lista.addEventListener("click", evento => {
        const botao = evento.target.closest("[data-pedido]");
        if (!botao || typeof abrirPedidoPorId !== "function") return;

        evento.preventDefault();
        abrirPedidoPorId(Number(botao.dataset.pedido));
    });

    // Várias mudanças seguidas (Realtime) viram uma consulta só
    let agendada = null;
    const agendar = () => {
        clearTimeout(agendada);
        agendada = setTimeout(atualizar, 600);
    };

    window.addEventListener("serf:dados-alterados", agendar);
    window.addEventListener("serf:pedido-criado", agendar);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) agendar(); });

    (async () => {
        if (await window.serfSessao) atualizar();
    })();

    window.SERFAcoesPendentes = Object.freeze({ atualizar });
})();
