import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarScripts, simples } from "./carregar-script.mjs";

const { SERFPedidos } = carregarScripts(["utils.js", "pedidos.js"], { obterSupabase: () => null });

const LINHA = {
    id_pedido: 7, id_usuario: 1, id_produto: 3, id_fornecedor: 2,
    quantidade: "5", valor_unitario: "10.50", valor_total: "52.50",
    status_pedido: "ENTREGUE", observacao: null, motivo_cancelamento: null,
    data_pedido: "2026-10-01T15:00:00Z", data_atualizacao: "2026-10-05T15:00:00Z",
    data_resposta: "2026-10-01T18:00:00Z", data_envio: "2026-10-03T15:00:00Z",
    data_entrega: "2026-10-05T15:00:00Z", data_cancelamento: null,
    nome_produto: "Arroz", categoria: null,
    fornecedor_razao_social: "Distribuidora Sul LTDA", fornecedor_nome_fantasia: "Distribuidora Sul",
    fornecedor_cidade: "Curitiba", fornecedor_estado: "PR",
    comprador_nome: "Mercado", sou_comprador: true, sou_fornecedor: false
};

test("normalizar: números, nomes, papéis e status", () => {
    const p = SERFPedidos.normalizar(LINHA);

    assert.deepEqual(simples([p.quantidade, p.valorUnitario, p.valorTotal]), [5, 10.5, 52.5]);
    assert.equal(p.fornecedorNome, "Distribuidora Sul");
    assert.equal(p.compradorNome, "Mercado");
    assert.deepEqual(simples([p.souComprador, p.souFornecedor]), [true, false]);
    assert.deepEqual(simples([p.statusBanco, p.status, p.statusRotulo]), ["ENTREGUE", "concluido", "Entregue"]);
    assert.equal(p.categoria, "");
});

test("normalizar: datas como Date e como dia local", () => {
    const p = SERFPedidos.normalizar(LINHA);

    assert.equal(p.dataEntrega.toISOString(), "2026-10-05T15:00:00.000Z");
    assert.equal(p.dataCancelamento, null);
    assert.match(p.criadoEm, /^2026-10-0[12]$/);
    assert.equal(p.concluidoEm, p.atualizadoEm);
});

test("normalizar: valores ausentes têm padrão legível", () => {
    const p = SERFPedidos.normalizar({ id_pedido: 1, id_produto: 9, status_pedido: "PENDENTE" });

    assert.equal(p.produto, "Produto #9");
    assert.equal(p.fornecedorNome, "Fornecedor");
    assert.equal(p.compradorNome, "Comprador");
    assert.equal(p.aguardandoResposta, true);
    assert.equal(p.concluidoEm, null);
    assert.equal(p.souComprador, false);
});

test("consultar usa a view pedidos_painel com as colunas declaradas", () => {
    let tabela = null, colunas = null;
    const client = { from(t) { tabela = t; return { select(c) { colunas = c; return "consulta"; } }; } };

    assert.equal(SERFPedidos.consultar(client), "consulta");
    assert.equal(tabela, "pedidos_painel");
    assert.equal(colunas, SERFPedidos.COLUNAS);
    assert.match(colunas, /sou_comprador/);
});
