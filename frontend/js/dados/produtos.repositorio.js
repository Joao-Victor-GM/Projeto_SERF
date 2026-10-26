// @ts-check
/* ==========================================================
   S.E.R.F. — DADOS / PRODUTOS.REPOSITORIO.JS
   Gestão dos produtos do próprio fornecedor (o RLS da 007 só
   permite alterar os da empresa; o GRANT limita as colunas).
   ========================================================== */

"use strict";

(function () {

    const { cliente, dadosOuErro } = window.SERFDados.base;

    const EDITAVEIS = ["nome_produto", "descricao", "categoria", "marca",
        "preco_atacado", "quantidade_minima", "quantidade_estoque", "ativo", "ncm"];

    // Catálogo (catalogo.js): busca, segmento, ordem e página, tudo no
    // servidor (a API corta respostas em 1.000 linhas). Com idFornecedor:
    // "Meus produtos", inclusive pausados; sem ele, só os ativos da rede.
    const COLUNAS_CATALOGO = "id_produto, id_fornecedor, nome_produto, descricao, categoria, marca, preco_atacado, "
        + "quantidade_minima, quantidade_estoque, ativo, data_cadastro, "
        + "fornecedores:fornecedores_publicos ( id_fornecedor, razao_social, nome_fantasia, cidade, estado )";

    /** @type {Record<string, [string, boolean]>} coluna e se é crescente */
    const ORDENS_CATALOGO = {
        recentes: ["id_produto", false],
        menor_preco: ["preco_atacado", true],
        maior_preco: ["preco_atacado", false]
    };

    // % _ e caracteres de sintaxe do PostgREST não podem ir crus no ILIKE
    const limparTermo = termo => String(termo || "").replace(/["\\%*_,()]/g, " ").replace(/\s+/g, " ").trim();

    /**
     * @param {{ termo?: string, categoria?: string, ordem?: string, pagina?: number, tamanho?: number, idFornecedor?: number | null }} [filtros]
     */
    async function catalogo({ termo = "", categoria = "", ordem = "recentes", pagina = 0, tamanho = 24, idFornecedor = null } = {}) {
        let consulta = cliente().from("produtos").select(COLUNAS_CATALOGO, { count: "exact" });
        consulta = idFornecedor ? consulta.eq("id_fornecedor", idFornecedor) : consulta.eq("ativo", true);

        const limpo = limparTermo(termo);
        if (limpo) consulta = consulta.ilike("nome_produto", `%${limpo}%`);
        if (categoria) consulta = consulta.eq("categoria", categoria);

        const [coluna, crescente] = ORDENS_CATALOGO[ordem] || ORDENS_CATALOGO.recentes;
        consulta = consulta.order(coluna, { ascending: crescente });
        if (coluna !== "id_produto") consulta = consulta.order("id_produto", { ascending: false });   // desempate estável

        const inicio = pagina * tamanho;
        const { data, error, count } = await consulta.range(inicio, inicio + tamanho - 1);
        if (error) throw error;
        return { produtos: data || [], total: typeof count === "number" ? count : null };
    }

    // Atualiza só as colunas editáveis; devolve a linha gravada
    async function atualizar(idProduto, campos) {
        /** @type {import("../../types/globais").Atualizacao<"produtos">} */
        const permitidos = Object.fromEntries(
            Object.entries(campos).filter(([coluna]) => EDITAVEIS.includes(coluna)));

        const linha = dadosOuErro(await cliente()
            .from("produtos")
            .update(permitidos)
            .eq("id_produto", idProduto)
            .select("*")
            .maybeSingle());

        // UPDATE bloqueado pelo RLS não gera erro: só não altera linhas
        if (!linha) throw new Error("Este produto não pertence à sua empresa ou foi removido.");
        return linha;
    }

    const definirAtivo = (idProduto, ativo) => atualizar(idProduto, { ativo });

    // Produtos ativos cujo nome contém o termo (busca da Home).
    // Mesma limpeza do termo das sugestões de fornecedores.
    async function sugerir(termoDigitado, limite = 5) {
        const termo = window.SERFDados.fornecedores?.limparTermo(termoDigitado) ?? String(termoDigitado || "").trim();
        if (termo.length < 2) return [];

        return dadosOuErro(await cliente()
            .from("produtos")
            .select(`id_produto, id_fornecedor, nome_produto, categoria, preco_atacado, quantidade_minima, quantidade_estoque,
                     fornecedores:fornecedores_publicos ( id_fornecedor, razao_social, nome_fantasia, cidade, estado )`)
            .eq("ativo", true)
            .ilike("nome_produto", `%${termo}%`)
            .order("nome_produto")
            .limit(limite)) || [];
    }

    window.SERFDados.produtos = Object.freeze({ catalogo, limparTermo, atualizar, definirAtivo, sugerir });
})();
