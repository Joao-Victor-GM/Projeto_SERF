/* ==========================================================
   S.E.R.F. — DADOS / PENDENCIAS.REPOSITORIO.JS
   Views derivadas do estado: alertas (015) e oportunidades (016/017).
   ========================================================== */

"use strict";

(function () {

    const { cliente, dadosOuErro } = window.SERFDados.base;

    const COLUNAS_ALERTA = "codigo, severidade, papel, id_pedido, id_produto, parceiro_nome, produto_nome, valor, quantidade, referencia, vencimento, detalhe";

    async function listarAlertas() {
        return dadosOuErro(await cliente().from("alertas").select(COLUNAS_ALERTA)) || [];
    }

    // Só a severidade: o contador do menu não precisa do resto
    async function severidadesDosAlertas(severidades) {
        return dadosOuErro(await cliente()
            .from("alertas")
            .select("severidade")
            .in("severidade", severidades)) || [];
    }

    async function listarOportunidades(limite) {
        return dadosOuErro(await cliente()
            .from("oportunidades")
            .select("*")
            .order("relevancia", { ascending: false })
            .order("referencia", { ascending: false, nullsFirst: false })
            .limit(limite)) || [];
    }

    window.SERFDados.pendencias = Object.freeze({
        listarAlertas,
        severidadesDosAlertas,
        listarOportunidades
    });
})();
