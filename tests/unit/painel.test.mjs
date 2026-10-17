// Regras puras do painel da Home (js/dominio/painel.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarScripts, simples } from "./carregar-script.mjs";

const { SERFPainel: P } = carregarScripts(["utils.js", "dominio/painel.js"], { obterSupabase: () => null });

const HOJE = new Date("2026-10-17T12:00:00").getTime();
const hoje = P.inicioDoDia(HOJE);

// "AAAA-MM-DD" de N dias atrás (dia local)
function diaAtras(n) {
    const d = new Date(hoje - n * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pedido(id, { modo = "comprar", status = "aberto", criado = 1, atualizado = criado, concluido = null,
                      parceiro = "Distribuidora Sul", produto = "Arroz", pendente = false } = {}) {
    return {
        id, modos: [modo], status, produto, aguardandoResposta: pendente,
        criadoEm: diaAtras(criado), atualizadoEm: diaAtras(atualizado),
        concluidoEm: concluido === null ? null : diaAtras(concluido),
        parceiros: {
            comprar: { id: `f-${parceiro}`, nome: parceiro },
            vender: { id: `u-${parceiro}`, nome: parceiro }
        }
    };
}

const FILTROS = { modo: "comprar", periodo: 30, empresa: "todas", busca: "" };

test("diasDesde: dias inteiros a partir do início do dia", () => {
    assert.equal(P.diasDesde(diaAtras(0), hoje), 0);
    assert.equal(P.diasDesde(diaAtras(7), hoje), 7);
    assert.equal(P.diasDesde(null, hoje), Infinity);
});

test("base: modo, período (inclusive), empresa e busca", () => {
    const pedidos = [
        pedido(1, { criado: 30 }),                         // limite do período: entra
        pedido(2, { criado: 31 }),                         // fora do período
        pedido(3, { modo: "vender" }),                     // outro modo
        pedido(4, { parceiro: "Atacado Norte", produto: "Café" })
    ];

    assert.deepEqual(simples(P.base(pedidos, FILTROS, hoje).map(p => p.id)), [1, 4]);
    assert.deepEqual(simples(P.base(pedidos, { ...FILTROS, empresa: "f-Atacado Norte" }, hoje).map(p => p.id)), [4]);
    assert.deepEqual(simples(P.base(pedidos, { ...FILTROS, busca: "café" }, hoje).map(p => p.id)), [4]);
    assert.deepEqual(simples(P.base(pedidos, { ...FILTROS, busca: "norte" }, hoje).map(p => p.id)), [4]);
    assert.deepEqual(simples(P.base(pedidos, { ...FILTROS, busca: "1" }, hoje).map(p => p.id)), [1], "busca pelo número");
});

test("base: o texto de busca usa o parceiro do modo consultado", () => {
    const ambos = pedido(9, { parceiro: "X" });
    ambos.modos = ["comprar", "vender"];
    ambos.parceiros.vender = { id: "u-Cliente", nome: "Cliente Bom" };

    assert.deepEqual(simples(P.base([ambos], { ...FILTROS, busca: "cliente" }, hoje).map(p => p.id)), []);
    assert.deepEqual(simples(P.base([ambos], { ...FILTROS, modo: "vender", busca: "cliente" }, hoje).map(p => p.id)), [9]);
});

test("filtrados: status da lista e indicador clicado", () => {
    const base = [
        pedido(1, { status: "aberto", pendente: true }),
        pedido(2, { status: "negociacao" }),
        pedido(3, { status: "concluido" })
    ];
    const ids = filtros => P.filtrados(base, { status: "todos", indicador: null, ...filtros }).map(p => p.id);

    assert.deepEqual(ids({}), [1, 2, 3]);
    assert.deepEqual(ids({ status: "negociacao" }), [2]);
    assert.deepEqual(ids({ indicador: "abertos" }), [1]);
    assert.deepEqual(ids({ indicador: "respostas" }), [1]);
    assert.deepEqual(ids({ indicador: "concluidos" }), [3]);
    assert.deepEqual(ids({ status: "aberto", indicador: "concluidos" }), []);
});

test("ordenarPorAtualizacao: mais recente primeiro, empate mantém a ordem", () => {
    const lista = [pedido(1, { atualizado: 5 }), pedido(2, { atualizado: 1 }), pedido(3, { atualizado: 5 }), pedido(4, { atualizado: 0 })];
    assert.deepEqual(simples(P.ordenarPorAtualizacao(lista).map(p => p.id)), [4, 2, 1, 3]);
    assert.deepEqual(simples(lista.map(p => p.id)), [1, 2, 3, 4], "não altera a lista original");
});

test("indicadores: uma passada conta abertos, respostas e concluídos", () => {
    const base = [pedido(1, { pendente: true }), pedido(2), pedido(3, { status: "concluido" }), pedido(4, { status: "cancelado" })];
    assert.deepEqual(simples(P.indicadores(base)), { abertos: 2, respostas: 1, concluidos: 1 });
});

test("faixasDoGrafico: classifica criados e concluídos nas faixas certas", () => {
    // 30 dias → 5 faixas de 6 dias; da mais antiga (24–30d) à mais recente (0–6d)
    const pedidos = [
        pedido(1, { criado: 0 }), pedido(2, { criado: 5 }), pedido(3, { criado: 6 }),
        pedido(4, { criado: 29 }), pedido(5, { criado: 30 }),           // 30 = fora (fim exclusivo)
        pedido(6, { criado: 20, concluido: 2 })
    ];

    const { quantidade, faixas, maiorValor } = P.faixasDoGrafico(pedidos, 30, hoje);

    assert.equal(quantidade, 5);
    assert.deepEqual(simples(faixas.map(f => f.rotulo)), ["24–30d", "18–24d", "12–18d", "6–12d", "0–6d"]);
    assert.deepEqual(simples(faixas.map(f => f.criados)), [1, 1, 0, 1, 2]);
    assert.deepEqual(simples(faixas.map(f => f.concluidos)), [0, 0, 0, 0, 1]);
    assert.equal(maiorValor, 2);
});

test("faixasDoGrafico: 7 dias = 1 faixa; 90 dias = 6 faixas de 15", () => {
    assert.equal(P.faixasDoGrafico([], 7, hoje).quantidade, 1);
    const noventa = P.faixasDoGrafico([pedido(1, { criado: 89 })], 90, hoje);
    assert.equal(noventa.quantidade, 6);
    assert.equal(noventa.faixas[0].rotulo, "75–90d");
    assert.equal(noventa.faixas[0].criados, 1);
    assert.equal(noventa.maiorValor, 1);
});

test("alertasDoRadar: pendente de resposta e parado há 3+ dias", () => {
    const pedidos = [
        pedido(1, { pendente: true }),
        pedido(2, { status: "negociacao", atualizado: 3 }),
        pedido(3, { status: "negociacao", atualizado: 2 }),
        pedido(4, { status: "concluido", atualizado: 10 }),
        pedido(5, { status: "cancelado", atualizado: 10 })
    ];

    const alertas = P.alertasDoRadar(pedidos, "comprar", hoje);
    assert.deepEqual(simples(alertas.map(a => [a.pedidoId, a.tipo])), [[1, "atencao"], [2, "urgente"]]);
    assert.equal(alertas[1].descricao, "Última atualização há 3 dias.");
    assert.equal(alertas[0].descricao, "Distribuidora Sul aguarda acompanhamento.");
});

test("parceiros: únicos e em ordem alfabética (pt-BR)", () => {
    const pedidos = [pedido(1, { parceiro: "Zeta" }), pedido(2, { parceiro: "Ácido" }), pedido(3, { parceiro: "Zeta" })];
    assert.deepEqual(simples(P.parceiros(pedidos, "comprar")), [["f-Ácido", "Ácido"], ["f-Zeta", "Zeta"]]);
});

test("conversasDoModo: só pedidos do modo, mais recentes primeiro; total de não lidas", () => {
    const pedidos = new Map([[1, pedido(1)], [2, pedido(2, { modo: "vender" })], [3, pedido(3)]]);
    const conversas = new Map([
        [1, { idPedido: 1, ultimaData: "2026-10-16T10:00:00Z", naoLidas: 2 }],
        [2, { idPedido: 2, ultimaData: "2026-10-17T10:00:00Z", naoLidas: 5 }],
        [3, { idPedido: 3, ultimaData: "2026-10-17T09:00:00Z", naoLidas: 1 }],
        [99, { idPedido: 99, ultimaData: "2026-10-17T11:00:00Z", naoLidas: 7 }]   // pedido fora do painel
    ]);

    const lista = P.conversasDoModo(conversas, pedidos, "comprar");
    assert.deepEqual(simples(lista.map(c => c.idPedido)), [3, 1]);
    assert.equal(P.totalNaoLidas(lista), 3);
});
