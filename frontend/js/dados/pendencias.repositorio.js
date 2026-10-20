/* ==========================================================
   S.E.R.F. — DADOS / PENDENCIAS.REPOSITORIO.JS
   Views derivadas do estado: alertas (015) e oportunidades (016/017),
   e os segmentos que filtram o radar (021).
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

    // segmentos: categorias escolhidas; vazio = todas. O filtro roda no
    // servidor (o limite vale para o segmento, não para a rede inteira).
    async function listarOportunidades(limite, segmentos = []) {
        let consulta = cliente()
            .from("oportunidades")
            .select("*");

        if (segmentos.length) consulta = consulta.in("categoria", segmentos);

        return dadosOuErro(await consulta
            .order("relevancia", { ascending: false })
            .order("referencia", { ascending: false, nullsFirst: false })
            .limit(limite)) || [];
    }

    async function meusSegmentos() {
        const linhas = dadosOuErro(await cliente().from("segmentos_interesse").select("categoria")) || [];
        return linhas.map(l => l.categoria);
    }

    // Troca a seleção inteira de uma vez (RPC transacional); devolve a salva
    async function definirSegmentos(categorias) {
        return dadosOuErro(await cliente().rpc("definir_segmentos", { p_categorias: categorias })) || [];
    }

    // Checklist de primeiros passos (migration 019); null = sem cadastro de empresa
    async function primeirosPassos() {
        return dadosOuErro(await cliente().rpc("primeiros_passos"));
    }

    window.SERFDados.pendencias = Object.freeze({
        primeirosPassos,
        listarAlertas,
        severidadesDosAlertas,
        listarOportunidades,
        meusSegmentos,
        definirSegmentos
    });
})();
