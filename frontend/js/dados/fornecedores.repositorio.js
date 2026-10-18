/* ==========================================================
   S.E.R.F. — DADOS / FORNECEDORES.REPOSITORIO.JS
   Busca de fornecedores para as sugestões da busca da Home.
   ========================================================== */

"use strict";

(function () {

    const { cliente, dadosOuErro } = window.SERFDados.base;

    const LIMITE_SUGESTOES = 5;

    // fornecedores_publicos (catálogo) é leve; fornecedores_vitrine agrega
    // todos os pedidos da plataforma e só entra se a primeira não tiver
    // as colunas. A view que funcionou fica guardada até recarregar a página.
    const VIEWS = ["fornecedores_publicos", "fornecedores_vitrine"];
    let viewEmUso = null;

    // Vírgula, parênteses, % e * têm significado no filtro .or() do PostgREST
    function limparTermo(termo) {
        return String(termo || "").replace(/[,()%*]/g, " ").trim();
    }

    async function consultar(view, termo) {
        return dadosOuErro(await cliente()
            .from(view)
            .select("id_fornecedor, razao_social, nome_fantasia")
            .or(`nome_fantasia.ilike.%${termo}%,razao_social.ilike.%${termo}%`)
            .limit(LIMITE_SUGESTOES)) || [];
    }

    async function consultarComReserva(termo) {
        if (viewEmUso) return consultar(viewEmUso, termo);

        let ultimoErro;

        for (const view of VIEWS) {
            try {
                const linhas = await consultar(view, termo);
                viewEmUso = view;
                console.info(`[SERF:Dados] Sugestões de fornecedores via "${view}".`);
                return linhas;
            } catch (erro) {
                ultimoErro = erro;
            }
        }

        throw ultimoErro;
    }

    // Fornecedores cujo nome fantasia ou razão social contém o termo → [{ id, nome }]
    async function sugerir(termoDigitado) {
        const termo = limparTermo(termoDigitado);
        if (termo.length < 2) return [];

        const linhas = await consultarComReserva(termo);

        return linhas.map(linha => ({
            id: linha.id_fornecedor,
            nome: linha.nome_fantasia || linha.razao_social
        }));
    }

    window.SERFDados.fornecedores = Object.freeze({ sugerir });
})();
