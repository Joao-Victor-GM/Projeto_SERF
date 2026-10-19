/* ==========================================================
   S.E.R.F. — DADOS / FORNECEDORES.REPOSITORIO.JS
   Busca de fornecedores para as sugestões da busca da Home.
   ========================================================== */

"use strict";

(function () {

    const { cliente, dadosOuErro } = window.SERFDados.base;

    const LIMITE_SUGESTOES = 5;

    // Só a view leve fornecedores_publicos (dados comerciais, sem agregação).
    // fornecedores_vitrine NÃO serve de reserva: agrega todos os pedidos da
    // plataforma a cada consulta, e as sugestões consultam a cada pausa da digitação.

    // O termo vai entre aspas no filtro .or() do PostgREST (vírgula, ponto e
    // parênteses ficam seguros: "Ind. Ltda", "S.A."). Removemos só o que
    // quebraria as aspas (" e \) e os curingas do LIKE (% * _), para que o
    // usuário busque texto literal.
    function limparTermo(termo) {
        return String(termo || "").replace(/["\\%*_]/g, " ").replace(/\s+/g, " ").trim();
    }

    // Fornecedores cujo nome fantasia ou razão social contém o termo → [{ id, nome }]
    async function sugerir(termoDigitado) {
        const termo = limparTermo(termoDigitado);
        if (termo.length < 2) return [];

        const linhas = dadosOuErro(await cliente()
            .from("fornecedores_publicos")
            .select("id_fornecedor, razao_social, nome_fantasia")
            .or(`nome_fantasia.ilike."%${termo}%",razao_social.ilike."%${termo}%"`)
            .order("razao_social")
            .limit(LIMITE_SUGESTOES)) || [];

        return linhas.map(linha => ({
            id: linha.id_fornecedor,
            nome: linha.nome_fantasia || linha.razao_social
        }));
    }

    window.SERFDados.fornecedores = Object.freeze({ sugerir, limparTermo });
})();
