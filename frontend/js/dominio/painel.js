/* ==========================================================
   S.E.R.F. — DOMÍNIO / PAINEL.JS
   Regras do painel da Home como funções PURAS: sem DOM, sem
   Supabase e sem estado global. Recebem tudo por parâmetro
   (inclusive "hoje"), então são testáveis em Node
   (tests/unit/painel.test.mjs) e reutilizáveis.

   Formato do pedido: o de SERFPedidos.normalizar() + os campos
   da Home (modos, parceiros). Carregar depois de utils.js.
   ========================================================== */

"use strict";

(function () {

    const DIA_MS = 86400000;

    // Início do dia local (base de todas as contas em dias)
    function inicioDoDia(data = new Date()) {
        const dia = new Date(data);
        dia.setHours(0, 0, 0, 0);
        return dia.getTime();
    }

    // "AAAA-MM-DD" (dia local) → dias decorridos até "hoje"
    function diasDesde(dataISO, hoje) {
        if (!dataISO) return Infinity;
        return Math.floor((hoje - new Date(`${dataISO}T00:00:00`).getTime()) / DIA_MS);
    }

    const parceiroDe = (pedido, modo) => pedido.parceiros[modo];

    // Texto de busca do pedido no modo (nº, produto, parceiro), em minúsculas.
    // Calculado uma vez por pedido/modo e guardado: a busca roda a cada tecla.
    function textoDeBusca(pedido, modo) {
        pedido._busca = pedido._busca || {};
        if (pedido._busca[modo] === undefined) {
            pedido._busca[modo] = [pedido.id, pedido.produto, parceiroDe(pedido, modo).nome].join(" ").toLowerCase();
        }
        return pedido._busca[modo];
    }


    /* ---------------- FILTROS ---------------- */

    function doModo(pedidos, modo) {
        return pedidos.filter(pedido => pedido.modos.includes(modo));
    }

    // Base da tabela e dos KPIs: modo, período, empresa parceira e busca.
    function base(pedidos, { modo, periodo, empresa, busca }, hoje) {
        return pedidos.filter(pedido =>
            pedido.modos.includes(modo) &&
            diasDesde(pedido.criadoEm, hoje) <= periodo &&
            (empresa === "todas" || parceiroDe(pedido, modo).id === empresa) &&
            (!busca || textoDeBusca(pedido, modo).includes(busca)));
    }

    // Tabela: base + status selecionado + indicador clicado.
    function filtrados(pedidosBase, { status, indicador }) {
        return pedidosBase.filter(pedido => {
            if (status !== "todos" && pedido.status !== status) return false;
            if (indicador === "abertos") return pedido.status === "aberto";
            if (indicador === "respostas") return pedido.aguardandoResposta;
            if (indicador === "concluidos") return pedido.status === "concluido";
            return true;
        });
    }

    // Mais recentemente atualizados primeiro (estável para empates).
    function ordenarPorAtualizacao(pedidos) {
        const chave = pedido => (pedido.atualizadoEm ? new Date(`${pedido.atualizadoEm}T00:00:00`).getTime() : 0);
        return pedidos
            .map((pedido, indice) => ({ pedido, indice, t: chave(pedido) }))
            .sort((a, b) => b.t - a.t || a.indice - b.indice)
            .map(item => item.pedido);
    }


    /* ---------------- INDICADORES ---------------- */

    // Uma passada só sobre a base
    function indicadores(pedidosBase) {
        let abertos = 0, respostas = 0, concluidos = 0;

        for (const pedido of pedidosBase) {
            if (pedido.status === "aberto") abertos += 1;
            if (pedido.aguardandoResposta) respostas += 1;
            if (pedido.status === "concluido") concluidos += 1;
        }

        return { abertos, respostas, concluidos };
    }

    // Empresas parceiras do modo, em ordem alfabética: [[id, nome], ...]
    function parceiros(pedidosDoModo, modo) {
        const mapa = new Map();
        pedidosDoModo.forEach(pedido => {
            const parceiro = parceiroDe(pedido, modo);
            mapa.set(parceiro.id, parceiro.nome);
        });
        return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
    }


    /* ---------------- GRÁFICO ---------------- */

    // Criados e concluídos por faixa de dias (até 6 faixas no período).
    // Cada pedido é classificado uma vez (antes: uma vez por faixa).
    function faixasDoGrafico(pedidosDoModo, periodo, hoje) {
        const quantidade = Math.min(6, Math.ceil(periodo / 7));
        const tamanho = periodo / quantidade;
        const criados = new Array(quantidade).fill(0);
        const concluidos = new Array(quantidade).fill(0);

        const faixaDe = dias => (dias >= 0 && dias < periodo ? Math.floor(dias / tamanho) : -1);

        for (const pedido of pedidosDoModo) {
            const c = faixaDe(diasDesde(pedido.criadoEm, hoje));
            if (c >= 0 && c < quantidade) criados[c] += 1;

            if (pedido.concluidoEm) {
                const f = faixaDe(diasDesde(pedido.concluidoEm, hoje));
                if (f >= 0 && f < quantidade) concluidos[f] += 1;
            }
        }

        const faixas = [];
        for (let indice = quantidade - 1; indice >= 0; indice--) {
            const inicio = indice * tamanho;
            const fim = (indice + 1) * tamanho;
            faixas.push({ rotulo: `${Math.ceil(inicio)}–${Math.ceil(fim)}d`, criados: criados[indice], concluidos: concluidos[indice] });
        }

        const maiorValor = Math.max(1, ...faixas.flatMap(f => [f.criados, f.concluidos]));
        return { quantidade, faixas, maiorValor };
    }


    /* ---------------- RADAR DE PEDIDOS ---------------- */

    // Pendências do modo: sem resposta do fornecedor ou parados há 3+ dias.
    function alertasDoRadar(pedidosDoModo, modo, hoje) {
        const alertas = [];

        for (const pedido of pedidosDoModo) {
            if (pedido.status === "concluido" || pedido.status === "cancelado") continue;

            if (pedido.aguardandoResposta) {
                alertas.push({
                    pedidoId: pedido.id,
                    tipo: "atencao",
                    titulo: `Pedido #${pedido.id} — Resposta pendente`,
                    descricao: `${parceiroDe(pedido, modo).nome} aguarda acompanhamento.`
                });
                continue;
            }

            const diasParado = diasDesde(pedido.atualizadoEm, hoje);
            if (diasParado >= 3) {
                alertas.push({
                    pedidoId: pedido.id,
                    tipo: "urgente",
                    titulo: `Pedido #${pedido.id} — Sem movimentação`,
                    descricao: `Última atualização há ${diasParado} dias.`
                });
            }
        }

        return alertas;
    }


    /* ---------------- CONVERSAS ---------------- */

    // Conversas cujo pedido está no modo, da mais recente à mais antiga.
    // pedidosPorId: Map id → pedido (O(1) por conversa).
    function conversasDoModo(conversas, pedidosPorId, modo) {
        const lista = [];

        for (const conversa of conversas.values()) {
            const pedido = pedidosPorId.get(conversa.idPedido);
            if (pedido?.modos.includes(modo)) lista.push({ ...conversa, pedido });
        }

        return lista.sort((a, b) => new Date(b.ultimaData) - new Date(a.ultimaData));
    }

    const totalNaoLidas = conversas => conversas.reduce((total, c) => total + c.naoLidas, 0);

    window.SERFPainel = Object.freeze({
        inicioDoDia,
        diasDesde,
        doModo,
        base,
        filtrados,
        ordenarPorAtualizacao,
        indicadores,
        parceiros,
        faixasDoGrafico,
        alertasDoRadar,
        conversasDoModo,
        totalNaoLidas
    });
})();
