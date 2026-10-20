// LGPD (migration 025): exportar os próprios dados e excluir a conta
// (anonimizar + apagar o login) sem destruir o histórico da outra empresa.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, criarProduto, criarPedido, mudarStatus, lerComoAdmin } from "./banco.mjs";

let db, comprador, fornecedor;

beforeEach(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador", "Mercado Bom Preço");
    fornecedor = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul");
});

// Pedido entregue (fluxo completo com pagamento e NF-e simulados)
async function pedidoEntregue(quantidade = 5) {
    const produto = await criarProduto(db, fornecedor, { nome: "Arroz", minimo: 1 });
    const pedido = await criarPedido(db, comprador, produto, quantidade);
    await mudarStatus(db, fornecedor, pedido, "CONFIRMADO");
    await como(db, comprador, "SELECT public.iniciar_pagamento($1, 'PIX')", [pedido]);
    await como(db, comprador, "SELECT public.confirmar_pagamento_simulado($1)", [pedido]);
    await como(db, fornecedor, "SELECT public.emitir_nota_fiscal($1)", [pedido]);
    await mudarStatus(db, fornecedor, pedido, "ENVIADO");
    await mudarStatus(db, fornecedor, pedido, "ENTREGUE");
    return pedido;
}

const excluir = empresa => lerComoAdmin(db, "SELECT public.anonimizar_conta($1)", [empresa.uid])
    .then(() => lerComoAdmin(db, "DELETE FROM auth.users WHERE id = $1", [empresa.uid]));

test("exportar: devolve os dados da própria conta (e nada de outra)", async () => {
    const pedido = await pedidoEntregue();
    await como(db, comprador, "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, 'Chegou, obrigado!')",
        [pedido, comprador.uid]);
    await como(db, comprador, "SELECT definir_segmentos($1::text[])", [["Alimentos & Bebidas"]]);

    const [{ exportar_meus_dados: dados }] = await como(db, comprador, "SELECT exportar_meus_dados()");

    assert.equal(dados.conta.email, `${comprador.uid}@teste.com`);
    assert.equal(dados.empresa_compradora.nome_empresa, "Mercado Bom Preço");
    assert.equal(dados.empresa_compradora.auth_user_id, undefined, "sem identificadores internos de login");
    assert.equal(dados.empresa_fornecedora, null);
    assert.deepEqual(dados.compras.map(c => [c.id_pedido, c.produto, c.fornecedor]), [[pedido, "Arroz", "Distribuidora Sul"]]);
    assert.deepEqual(dados.vendas, []);
    assert.deepEqual(dados.mensagens_enviadas.map(m => m.texto), ["Chegou, obrigado!"]);
    assert.equal(dados.pagamentos.length, 1);
    assert.equal(dados.notas_fiscais.length, 1);
    assert.deepEqual(dados.segmentos, ["Alimentos & Bebidas"]);

    const [{ exportar_meus_dados: doFornecedor }] = await como(db, fornecedor, "SELECT exportar_meus_dados()");
    assert.deepEqual(doFornecedor.vendas.map(v => v.comprador), ["Mercado Bom Preço"]);
    assert.equal(doFornecedor.produtos.length, 1);
    assert.deepEqual(doFornecedor.mensagens_enviadas, []);
});

test("excluir com pedido em andamento: bloqueado, com os números dos pedidos", async () => {
    const produto = await criarProduto(db, fornecedor, { minimo: 1 });
    const pedido = await criarPedido(db, comprador, produto, 2);

    const pendentes = await como(db, comprador, "SELECT * FROM meus_pedidos_em_andamento()");
    assert.deepEqual(pendentes.map(p => [p.id_pedido, p.status_pedido, p.papel]), [[pedido, "PENDENTE", "comprador"]]);
    assert.equal((await como(db, fornecedor, "SELECT * FROM meus_pedidos_em_andamento()"))[0].papel, "fornecedor");

    await assert.rejects(lerComoAdmin(db, "SELECT public.anonimizar_conta($1)", [comprador.uid]),
        new RegExp(`pedidos em andamento antes de excluir a conta: #${pedido}`));
});

test("excluir: dados pessoais somem; histórico da outra empresa (pedido, chat, NF-e) fica", async () => {
    const pedido = await pedidoEntregue();
    await como(db, comprador, "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, 'Chegou!')", [pedido, comprador.uid]);
    await como(db, comprador, "SELECT definir_segmentos($1::text[])", [["Alimentos & Bebidas"]]);
    await como(db, comprador, "INSERT INTO preferencias_notificacao (receber_email) VALUES (true)");

    await excluir(comprador);

    const [usuario] = await lerComoAdmin(db, "SELECT nome_empresa, nome_responsavel, email, telefone, ativo, auth_user_id FROM usuarios WHERE id_usuario = $1",
        [comprador.idUsuario]);
    assert.equal(usuario.nome_responsavel, "Titular removido");
    assert.match(usuario.email, /^removido-u\d+@serf\.invalid$/);
    assert.equal(usuario.telefone, null);
    assert.equal(usuario.ativo, false);
    assert.equal(usuario.auth_user_id, null);
    assert.equal(usuario.nome_empresa, "Mercado Bom Preço", "nome empresarial fica no histórico (pessoa jurídica)");

    for (const tabela of ["segmentos_interesse", "preferencias_notificacao", "notificacoes", "notificacoes_email"]) {
        const restantes = await lerComoAdmin(db, `SELECT 1 FROM ${tabela} WHERE auth_user_id = $1`, [comprador.uid]);
        assert.equal(restantes.length, 0, tabela);
    }

    // O fornecedor continua vendo a venda, a conversa e a nota
    assert.equal((await como(db, fornecedor, "SELECT 1 FROM pedidos WHERE id_pedido = $1", [pedido])).length, 1);
    const mensagens = await lerComoAdmin(db, "SELECT texto, id_remetente FROM mensagens_pedidos WHERE id_pedido = $1", [pedido]);
    assert.deepEqual(mensagens.map(m => [m.texto, m.id_remetente]), [["Chegou!", null]]);
    assert.equal((await lerComoAdmin(db, "SELECT 1 FROM notas_fiscais WHERE id_pedido = $1", [pedido])).length, 1);
});

test("excluir fornecedor: produtos saem do ar, propostas abertas são retiradas", async () => {
    const outroComprador = await criarEmpresa(db, "Comprador", "Oficina");
    await criarProduto(db, fornecedor, { nome: "Arroz", minimo: 1 });
    const [cotacao] = await como(db, outroComprador, "SELECT * FROM publicar_cotacao('Arroz', 'Alimentos & Bebidas', 10)");
    const [{ id_produto }] = await lerComoAdmin(db, "SELECT id_produto FROM produtos LIMIT 1");
    await como(db, fornecedor, "SELECT enviar_proposta($1, $2, 9, 3)", [cotacao.id_cotacao, id_produto]);

    await excluir(fornecedor);

    assert.deepEqual(await lerComoAdmin(db, "SELECT ativo FROM produtos"), [{ ativo: false }]);
    assert.deepEqual(await lerComoAdmin(db, "SELECT status FROM propostas"), [{ status: "RETIRADA" }]);
    const [f] = await lerComoAdmin(db, "SELECT email, auth_user_id FROM fornecedores WHERE id_fornecedor = $1", [fornecedor.idFornecedor]);
    assert.match(f.email, /^removido-f\d+@serf\.invalid$/);
    assert.equal(f.auth_user_id, null);
});

test("só o servidor anonimiza; o usuário só exporta os próprios dados", async () => {
    assert.match(await erroDe(db, comprador, "SELECT anonimizar_conta($1)", [fornecedor.uid]), /permission denied/);
    assert.match(await erroDe(db, comprador, "SELECT * FROM pedidos_em_andamento_da_conta($1)", [fornecedor.uid]), /permission denied/);
});
