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

    window.SERFDados.produtos = Object.freeze({ atualizar, definirAtivo, sugerir });
})();
