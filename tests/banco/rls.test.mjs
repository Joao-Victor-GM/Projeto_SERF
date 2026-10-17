// Quem vê e quem altera o quê (RLS + GRANT por coluna).

import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
    criarBanco, lerMigration, como, erroDe, criarEmpresa, criarProduto,
    criarPedido, mudarStatus, lerComoAdmin
} from "./banco.mjs";

let db, comprador, fornecedor, intruso, ambos, idProduto, idPedido;

before(async () => {
    db = await criarBanco({
        // Simula a política permissiva criada pelo painel no banco real
        antesDe: async (nome, banco) => {
            if (nome.startsWith("012")) {
                await banco.exec(`CREATE POLICY "Enable read access for all users"
                                  ON public.pedidos FOR SELECT USING (true)`);
            }
        }
    });

    comprador = await criarEmpresa(db, "Comprador", "Mercado Bom Preço");
    fornecedor = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul");
    intruso = await criarEmpresa(db, "Comprador", "Empresa Curiosa");
    ambos = await criarEmpresa(db, "Ambos", "Atacadão Ambos");

    idProduto = await criarProduto(db, fornecedor, { preco: 10, minimo: 5, estoque: 100 });
    idPedido = await criarPedido(db, comprador, idProduto, 10);
});

test("a 012 remove políticas criadas pelo painel", async () => {
    const politicas = await lerComoAdmin(db,
        "SELECT policyname FROM pg_policies WHERE tablename = 'pedidos'");

    assert.ok(!politicas.some(p => p.policyname === "Enable read access for all users"));
});

test("o preço do pedido vem do produto, não do navegador", async () => {
    const [pedido] = await lerComoAdmin(db,
        "SELECT valor_unitario, valor_total FROM pedidos WHERE id_pedido = $1", [idPedido]);

    assert.equal(Number(pedido.valor_unitario), 10);
    assert.equal(Number(pedido.valor_total), 100);
});

test("pedido: só comprador e fornecedor enxergam", async () => {
    const contar = async empresa => (await como(db, empresa, "SELECT id_pedido FROM pedidos")).length;

    assert.equal(await contar(comprador), 1);
    assert.equal(await contar(fornecedor), 1);
    assert.equal(await contar(intruso), 0);
    assert.equal(await contar(ambos), 0);
});

test("cadastro: fornecedor lê o nome do comprador; terceiros não", async () => {
    const nomes = async empresa =>
        (await como(db, empresa, "SELECT nome_empresa FROM usuarios")).map(l => l.nome_empresa);

    assert.ok((await nomes(fornecedor)).includes("Mercado Bom Preço"));
    assert.ok(!(await nomes(intruso)).includes("Mercado Bom Preço"));
});

test("cadastro: CNPJ e razão social não podem ser editados", async () => {
    const erro = await erroDe(db, comprador,
        "UPDATE usuarios SET cnpj = '99999999000199' WHERE auth_user_id = $1", [comprador.uid]);

    assert.match(erro, /permission denied/);
});

test("pedido: terceiro não altera status; navegador não altera preço", async () => {
    await mudarStatus(db, intruso, idPedido, "CONFIRMADO");
    const [linha] = await lerComoAdmin(db, "SELECT status_pedido FROM pedidos WHERE id_pedido = $1", [idPedido]);
    assert.equal(linha.status_pedido, "PENDENTE");

    const erro = await erroDe(db, fornecedor,
        "UPDATE pedidos SET valor_unitario = 1 WHERE id_pedido = $1", [idPedido]);
    assert.match(erro, /permission denied/);
});

test("chat: participantes leem; terceiros não; destinatário marca como lida", async () => {
    await como(db, comprador,
        "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, 'Olá!')",
        [idPedido, comprador.uid]);

    assert.equal((await como(db, fornecedor, "SELECT id FROM mensagens_pedidos")).length, 1);
    assert.equal((await como(db, intruso, "SELECT id FROM mensagens_pedidos")).length, 0);

    const erro = await erroDe(db, intruso,
        "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, 'oi')",
        [idPedido, intruso.uid]);
    assert.match(erro, /row-level security/);

    await como(db, fornecedor, "UPDATE mensagens_pedidos SET lida = true WHERE id_pedido = $1", [idPedido]);
    const [msg] = await lerComoAdmin(db, "SELECT lida FROM mensagens_pedidos");
    assert.equal(msg.lida, true);
});

test("produtos: comprador ainda vê o produto desativado que comprou", async () => {
    const outro = await criarProduto(db, fornecedor, { nome: "Feijão" });
    const pedidoOutro = await criarPedido(db, comprador, outro, 1);
    assert.ok(pedidoOutro);

    await como(db, fornecedor, "UPDATE produtos SET ativo = false WHERE id_produto = $1", [outro]);

    const ver = async empresa =>
        (await como(db, empresa, "SELECT id_produto FROM produtos WHERE id_produto = $1", [outro])).length;

    assert.equal(await ver(comprador), 1, "comprador");
    assert.equal(await ver(fornecedor), 1, "dono");
    assert.equal(await ver(intruso), 0, "terceiro");
});

test("empresa Ambos não compra o próprio produto, mas compra de outros", async () => {
    const proprio = await criarProduto(db, ambos, { nome: "Produto próprio" });

    const erro = await erroDe(db, ambos,
        "INSERT INTO pedidos (id_usuario, id_produto, quantidade, valor_unitario) VALUES ($1, $2, 1, 1)",
        [ambos.idUsuario, proprio]);
    assert.match(erro, /próprio catálogo/);

    assert.ok(await criarPedido(db, ambos, idProduto, 5));
});

test("a 012 pode ser executada de novo (idempotente)", async () => {
    await lerComoAdmin(db, "SELECT 1");
    await db.exec(lerMigration("012_desempenho_rls_indices.sql"));
});

test("RLS de pedidos calcula a lista uma vez por consulta (sem função por linha)", async () => {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [fornecedor.uid]);
    await db.exec("SET ROLE authenticated");
    const plano = (await db.query("EXPLAIN SELECT * FROM pedidos")).rows.map(r => r["QUERY PLAN"]).join("\n");
    await db.exec("RESET ROLE");

    assert.match(plano, /hashed SubPlan|InitPlan/);
    assert.doesNotMatch(plano, /fornecedor_do_produto/);
});
