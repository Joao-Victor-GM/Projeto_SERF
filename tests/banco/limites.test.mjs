// Limites contra abuso e índices (migration 030).

import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, criarProduto, criarPedido, lerComoAdmin } from "./banco.mjs";

test("chat: no máximo 20 mensagens por minuto por remetente", async () => {
    const db = await criarBanco();
    const fornecedor = await criarEmpresa(db, "Fornecedor");
    const comprador = await criarEmpresa(db, "Comprador");
    const pedido = await criarPedido(db, comprador, await criarProduto(db, fornecedor, { minimo: 1 }), 1);
    const enviar = () => como(db, comprador,
        "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, 'oi')", [pedido, comprador.uid]);

    for (let i = 0; i < 20; i++) await enviar();
    await assert.rejects(enviar(), /Muitas mensagens em pouco tempo/);

    // O outro lado continua conversando normalmente
    await como(db, fornecedor, "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, 'olá')", [pedido, fornecedor.uid]);
});

test("produtos: no máximo 60 cadastros por hora por fornecedor", async () => {
    const db = await criarBanco();
    const fornecedor = await criarEmpresa(db, "Fornecedor");
    await lerComoAdmin(db, `INSERT INTO produtos (id_fornecedor, nome_produto, categoria, preco_atacado, quantidade_minima, quantidade_estoque)
                            SELECT $1, 'P' || g, 'Outros', 10, 1, 10 FROM generate_series(1, 60) g`, [fornecedor.idFornecedor]);
    await assert.rejects(criarProduto(db, fornecedor), /Limite de 60 produtos/);
});

test("cotações: no máximo 10 publicações por hora", async () => {
    const db = await criarBanco();
    const comprador = await criarEmpresa(db, "Comprador");
    for (let i = 0; i < 10; i++) {
        const [c] = await como(db, comprador, "SELECT * FROM publicar_cotacao($1, 'Outros', 1)", [`Item ${i}`]);
        await como(db, comprador, "SELECT cancelar_cotacao($1)", [c.id_cotacao]);   // abre e cancela: ainda conta
    }
    assert.match(await erroDe(db, comprador, "SELECT publicar_cotacao('Mais um', 'Outros', 1)"), /10 cotações por hora/);
});

test("chaves estrangeiras usadas em filtros e cascatas têm índice", async () => {
    const db = await criarBanco();
    const semIndice = await lerComoAdmin(db, `
        SELECT c.conrelid::regclass::text || '.' || a.attname AS coluna
          FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
           AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`);
    assert.deepEqual(semIndice.map(l => l.coluna), []);
});
