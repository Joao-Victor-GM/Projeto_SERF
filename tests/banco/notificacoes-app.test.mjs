// Central de notificações no app (migration 023).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, criarProduto, criarPedido, mudarStatus, lerComoAdmin } from "./banco.mjs";

let db, comprador, fornecedor;

beforeEach(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador", "Mercado Bom Preço");
    fornecedor = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul");
});

const minhas = empresa => como(db, empresa,
    "SELECT id, tipo, dados, quantidade, lida_em FROM notificacoes ORDER BY atualizada_em DESC, id DESC");

test("cada evento vira notificação no app de quem deve agir", async () => {
    const produto = await criarProduto(db, fornecedor, { nome: "Arroz" });
    const pedido = await criarPedido(db, comprador, produto, 5);

    const [recebido] = await minhas(fornecedor);
    assert.equal(recebido.tipo, "PEDIDO_RECEBIDO");
    assert.equal(recebido.dados.itens[0].id_pedido, pedido);
    assert.equal(recebido.lida_em, null);

    await mudarStatus(db, fornecedor, pedido, "CONFIRMADO");
    assert.deepEqual((await minhas(comprador)).map(n => [n.tipo, n.dados.status]), [["STATUS_PEDIDO", "CONFIRMADO"]]);
});

test("no app chega mesmo para quem desligou os e-mails", async () => {
    await como(db, fornecedor, "INSERT INTO preferencias_notificacao (receber_email) VALUES (false)");
    const produto = await criarProduto(db, fornecedor);
    await criarPedido(db, comprador, produto);

    assert.equal((await minhas(fornecedor)).length, 1);
    assert.equal((await lerComoAdmin(db, "SELECT 1 FROM notificacoes_email WHERE auth_user_id = $1", [fornecedor.uid])).length, 0);
});

test("mensagens da mesma conversa agrupam: quantidade sobe e volta a 'não lida'", async () => {
    const produto = await criarProduto(db, fornecedor);
    const pedido = await criarPedido(db, comprador, produto);
    const enviar = texto => como(db, comprador,
        "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, $3)", [pedido, comprador.uid, texto]);

    await enviar("Olá");
    await como(db, fornecedor, "SELECT marcar_notificacoes_lidas()");
    await enviar("Consegue entregar amanhã?");

    const mensagens = (await minhas(fornecedor)).filter(n => n.tipo === "MENSAGEM_NOVA");
    assert.equal(mensagens.length, 1);
    assert.equal(mensagens[0].quantidade, 2);
    assert.equal(mensagens[0].dados.trecho, "Consegue entregar amanhã?");
    assert.equal(mensagens[0].lida_em, null);
});

test("privacidade: cada um só vê, marca e apaga as próprias", async () => {
    const produto = await criarProduto(db, fornecedor);
    await criarPedido(db, comprador, produto);
    const [dele] = await minhas(fornecedor);

    assert.deepEqual(await minhas(comprador), []);
    await como(db, comprador, "UPDATE notificacoes SET lida_em = NOW() WHERE id = $1", [dele.id]);
    await como(db, comprador, "DELETE FROM notificacoes WHERE id = $1", [dele.id]);
    assert.equal((await minhas(fornecedor))[0].lida_em, null, "RLS: o update de outro usuário não pega nada");
    assert.equal((await minhas(fornecedor)).length, 1);
});

test("o usuário só altera 'lida_em'; não cria nem forja notificações", async () => {
    const produto = await criarProduto(db, fornecedor);
    await criarPedido(db, comprador, produto);
    const [minha] = await minhas(fornecedor);

    await como(db, fornecedor, "UPDATE notificacoes SET lida_em = NOW() WHERE id = $1", [minha.id]);
    assert.notEqual((await minhas(fornecedor))[0].lida_em, null);

    assert.match(await erroDe(db, fornecedor, "UPDATE notificacoes SET dados = '{}' WHERE id = $1", [minha.id]), /permission denied/);
    assert.match(await erroDe(db, fornecedor,
        "INSERT INTO notificacoes (auth_user_id, tipo, chave) VALUES ($1, 'X', 'x')", [fornecedor.uid]), /permission denied/);
    assert.match(await erroDe(db, fornecedor, "SELECT notificar($1, 'X', '{}', 'x')", [comprador.uid]), /permission denied/);
});

test("marcar todas como lidas devolve quantas eram; limpeza apaga só lidas antigas", async () => {
    const produto = await criarProduto(db, fornecedor);
    const pedido = await criarPedido(db, comprador, produto);
    await como(db, comprador, "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, 'Oi')", [pedido, comprador.uid]);

    const [{ marcar_notificacoes_lidas: lidas }] = await como(db, fornecedor, "SELECT marcar_notificacoes_lidas()");
    assert.equal(lidas, 2);

    await lerComoAdmin(db, "UPDATE notificacoes SET atualizada_em = NOW() - INTERVAL '91 days' WHERE tipo = 'MENSAGEM_NOVA'");
    const [{ limpar_notificacoes_antigas: apagadas }] = await lerComoAdmin(db, "SELECT limpar_notificacoes_antigas()");
    assert.equal(apagadas, 1);
    assert.deepEqual((await minhas(fornecedor)).map(n => n.tipo), ["PEDIDO_RECEBIDO"]);
});

test("está na publicação do Realtime", async () => {
    const linhas = await lerComoAdmin(db,
        "SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notificacoes'");
    assert.equal(linhas.length, 1);
});
