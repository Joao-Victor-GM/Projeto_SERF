// Falha corrigida na migration 028: escrita pelas views públicas.

import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, criarProduto, criarPedido, mudarStatus, lerComoAdmin } from "./banco.mjs";

test("ninguém renomeia nem apaga fornecedor alheio pelas views (028)", async () => {
    const db = await criarBanco();
    const vitima = await criarEmpresa(db, "Fornecedor", "Distribuidora Vítima");
    const atacante = await criarEmpresa(db, "Comprador", "Atacante");
    await criarProduto(db, vitima);

    for (const sql of [
        "UPDATE fornecedores_publicos SET razao_social = 'HACK' WHERE id_fornecedor = $1",
        "DELETE FROM fornecedores_publicos WHERE id_fornecedor = $1",
        "INSERT INTO fornecedores_publicos (razao_social) SELECT 'x' WHERE $1::bigint > 0",
        "DELETE FROM fornecedores_vitrine WHERE id_fornecedor = $1"
    ]) {
        assert.match(await erroDe(db, atacante, sql, [vitima.idFornecedor]), /permission denied|cannot (delete from|update|insert into) view/, sql);
    }

    const [linha] = await lerComoAdmin(db, "SELECT razao_social FROM fornecedores WHERE id_fornecedor = $1", [vitima.idFornecedor]);
    assert.equal(linha.razao_social, "Distribuidora Vítima");

    // A leitura continua (é o diretório público)
    assert.equal((await como(db, atacante, "SELECT 1 FROM fornecedores_publicos")).length, 1);
});

test("ninguém consulta se o pedido de OUTRA empresa foi pago (028)", async () => {
    const db = await criarBanco();
    const fornecedor = await criarEmpresa(db, "Fornecedor");
    const comprador = await criarEmpresa(db, "Comprador");
    const curioso = await criarEmpresa(db, "Comprador");
    const pedido = await criarPedido(db, comprador, await criarProduto(db, fornecedor, { minimo: 1 }), 2);
    await mudarStatus(db, fornecedor, pedido, "CONFIRMADO");

    assert.match(await erroDe(db, curioso, "SELECT pagamento_libera_envio($1)", [pedido]), /permission denied/);

    // As regras que a usam continuam funcionando (rodam como o servidor)
    await como(db, comprador, "SELECT iniciar_pagamento($1, 'PIX')", [pedido]);
    await como(db, comprador, "SELECT confirmar_pagamento_simulado($1)", [pedido]);
    await como(db, fornecedor, "SELECT emitir_nota_fiscal($1)", [pedido]);
    await mudarStatus(db, fornecedor, pedido, "ENVIADO");
});
