// @ts-check
/* ==========================================================
   S.E.R.F. — DADOS / COTACOES.REPOSITORIO.JS
   Cotação reversa (migration 024). Leitura pelas tabelas (o RLS
   decide o que cada empresa vê); escrita só pelas RPCs.
   ========================================================== */

"use strict";

(function () {

    const { cliente, dadosOuErro, assinar } = window.SERFDados.base;

    const COLUNAS_PROPOSTA = "id_proposta, id_cotacao, id_fornecedor, id_produto, fornecedor_nome, produto_nome, preco_unitario, prazo_entrega_dias, observacao, status, criada_em, atualizada_em";
    const COLUNAS_COTACAO = "id_cotacao, id_usuario, comprador_nome, titulo, descricao, categoria, quantidade, unidade, preco_alvo, valida_ate, status, id_proposta_aceita, criada_em, encerrada_em";

    // Comprador: as próprias cotações, com as propostas recebidas.
    // cotacoes e propostas têm DUAS ligações (propostas.id_cotacao e
    // cotacoes.id_proposta_aceita): sem dizer qual usar, o PostgREST recusa
    // a consulta (PGRST201). A ligação certa é a das propostas da cotação.
    async function minhasCotacoes(idUsuario) {
        return dadosOuErro(await cliente()
            .from("cotacoes")
            .select(`${COLUNAS_COTACAO}, propostas!fk_propostas_cotacoes ( ${COLUNAS_PROPOSTA} )`)
            .eq("id_usuario", idUsuario)
            .order("criada_em", { ascending: false })
            .limit(50)) || [];
    }

    // Fornecedor: cotações abertas no prazo (segmentos vazios = todos)
    async function cotacoesAbertas(segmentos = []) {
        let consulta = cliente()
            .from("cotacoes")
            .select(COLUNAS_COTACAO)
            .eq("status", "ABERTA")
            .gte("valida_ate", new Date().toISOString());

        if (segmentos.length) consulta = consulta.in("categoria", segmentos);

        return dadosOuErro(await consulta.order("criada_em", { ascending: false }).limit(100)) || [];
    }

    // Fornecedor: as próprias propostas (o RLS não mostra as dos concorrentes)
    async function minhasPropostas(idFornecedor) {
        return dadosOuErro(await cliente()
            .from("propostas")
            .select(COLUNAS_PROPOSTA)
            .eq("id_fornecedor", idFornecedor)) || [];
    }

    async function meusProdutosAtivos(idFornecedor) {
        return dadosOuErro(await cliente()
            .from("produtos")
            .select("id_produto, nome_produto, categoria, preco_atacado, quantidade_estoque")
            .eq("id_fornecedor", idFornecedor)
            .eq("ativo", true)
            .order("nome_produto")) || [];
    }

    const rpc = async (nome, argumentos) => dadosOuErro(await cliente().rpc(nome, argumentos));

    const publicar = c => rpc("publicar_cotacao", {
        p_titulo: c.titulo, p_categoria: c.categoria, p_quantidade: c.quantidade, p_unidade: c.unidade,
        p_descricao: c.descricao || null, p_preco_alvo: c.precoAlvo || null, p_dias_validade: c.dias
    });
    const cancelar = idCotacao => rpc("cancelar_cotacao", { p_id_cotacao: idCotacao });
    const enviarProposta = p => rpc("enviar_proposta", {
        p_id_cotacao: p.idCotacao, p_id_produto: p.idProduto, p_preco_unitario: p.preco,
        p_prazo_entrega_dias: p.prazo, p_observacao: p.observacao || null
    });
    const retirarProposta = idCotacao => rpc("retirar_proposta", { p_id_cotacao: idCotacao });
    const aceitarProposta = idProposta => rpc("aceitar_proposta", { p_id_proposta: idProposta });

    // Propostas chegando (comprador) ou mudando de status (fornecedor)
    const assinarPropostas = aoMudar => assinar({ canal: "serf-propostas", tabela: "propostas", aoReceber: aoMudar });

    window.SERFDados.cotacoes = Object.freeze({
        minhasCotacoes, cotacoesAbertas, minhasPropostas, meusProdutosAtivos,
        publicar, cancelar, enviarProposta, retirarProposta, aceitarProposta, assinarPropostas
    });
})();
