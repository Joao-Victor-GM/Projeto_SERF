// Cotação reversa (migration 024): publicar, propor, aceitar → pedido.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, criarProduto, criarPedido, mudarStatus, lerComoAdmin } from "./banco.mjs";

const METAIS = "Metalurgia & Usinagem";
const ALIMENTOS = "Alimentos & Bebidas";

let db, comprador, fornecedor, concorrente, outroSegmento;

beforeEach(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador", "Oficina Central");
    fornecedor = await criarEmpresa(db, "Fornecedor", "Aços Sul");
    concorrente = await criarEmpresa(db, "Fornecedor", "Metalúrgica Norte");
    outroSegmento = await criarEmpresa(db, "Fornecedor", "Distribuidora de Alimentos");
});

async function produtoDe(empresa, nome, categoria, extras = {}) {
    const p = { preco: 50, minimo: 100, estoque: 1000, ...extras };
    const [linha] = await como(db, empresa, `
        INSERT INTO produtos (id_fornecedor, nome_produto, categoria, preco_atacado, quantidade_minima, quantidade_estoque)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_produto`,
        [empresa.idFornecedor, nome, categoria, p.preco, p.minimo, p.estoque]);
    return linha.id_produto;
}

async function publicar(empresa = comprador, extras = {}) {
    const c = { titulo: "Chapa de aço 2mm", categoria: METAIS, quantidade: 20, unidade: "un.", dias: 7, ...extras };
    const [linha] = await como(db, empresa,
        "SELECT * FROM publicar_cotacao($1, $2, $3, $4, $5, $6, $7)",
        [c.titulo, c.categoria, c.quantidade, c.unidade, c.descricao ?? null, c.preco_alvo ?? null, c.dias]);
    return linha;
}

const propor = (empresa, idCotacao, idProduto, preco, prazo = 5) =>
    como(db, empresa, "SELECT * FROM enviar_proposta($1, $2, $3, $4)", [idCotacao, idProduto, preco, prazo]).then(l => l[0]);

const avisos = (empresa, tipo) => lerComoAdmin(db,
    "SELECT dados, quantidade FROM notificacoes WHERE auth_user_id = $1 AND tipo = $2", [empresa.uid, tipo]);

test("fluxo completo: publicar → propostas → aceitar vira pedido com o preço da proposta", async () => {
    const chapa = await produtoDe(fornecedor, "Chapa 2mm", METAIS, { preco: 50, minimo: 100 });
    const chapaNorte = await produtoDe(concorrente, "Chapa fina", METAIS, { preco: 45 });

    const cotacao = await publicar(comprador, { preco_alvo: 40 });
    assert.equal(cotacao.status, "ABERTA");
    assert.equal(cotacao.comprador_nome, "Oficina Central");

    const minha = await propor(fornecedor, cotacao.id_cotacao, chapa, 38.5, 3);
    await propor(concorrente, cotacao.id_cotacao, chapaNorte, 41);

    const idPedido = (await como(db, comprador, "SELECT aceitar_proposta($1) AS id", [minha.id_proposta]))[0].id;

    const [pedido] = await lerComoAdmin(db,
        "SELECT id_usuario, id_produto, quantidade, valor_unitario, valor_total, status_pedido, id_proposta, observacao FROM pedidos WHERE id_pedido = $1", [idPedido]);
    assert.equal(pedido.id_produto, chapa);
    assert.equal(pedido.quantidade, 20, "quantidade da cotação, mesmo abaixo do mínimo de 100 do catálogo");
    assert.equal(Number(pedido.valor_unitario), 38.5, "preço da proposta, não o do catálogo (50)");
    assert.equal(Number(pedido.valor_total), 770);
    assert.equal(pedido.status_pedido, "PENDENTE");
    assert.match(pedido.observacao, /Cotação #\d+ aceita: Chapa de aço 2mm/);

    const propostas = await lerComoAdmin(db, "SELECT fornecedor_nome, status FROM propostas ORDER BY fornecedor_nome");
    assert.deepEqual(propostas.map(p => [p.fornecedor_nome, p.status]), [["Aços Sul", "ACEITA"], ["Metalúrgica Norte", "RECUSADA"]]);
    const [fechada] = await lerComoAdmin(db, "SELECT status, id_proposta_aceita FROM cotacoes");
    assert.deepEqual([fechada.status, fechada.id_proposta_aceita], ["FECHADA", minha.id_proposta]);

    // Daí em diante, o fluxo normal: o fornecedor confirma e o estoque é reservado
    await mudarStatus(db, fornecedor, idPedido, "CONFIRMADO");
    const [{ quantidade_estoque }] = await lerComoAdmin(db, "SELECT quantidade_estoque FROM produtos WHERE id_produto = $1", [chapa]);
    assert.equal(quantidade_estoque, 980);
});

test("sigilo: fornecedor só vê a própria proposta; o comprador vê todas as da sua cotação", async () => {
    const cotacao = await publicar();
    await propor(fornecedor, cotacao.id_cotacao, await produtoDe(fornecedor, "Chapa", METAIS), 40);
    await propor(concorrente, cotacao.id_cotacao, await produtoDe(concorrente, "Chapa N", METAIS), 39);

    const vistasPeloFornecedor = await como(db, fornecedor, "SELECT fornecedor_nome, preco_unitario FROM propostas");
    assert.deepEqual(vistasPeloFornecedor.map(p => p.fornecedor_nome), ["Aços Sul"]);
    assert.equal((await como(db, comprador, "SELECT 1 FROM propostas")).length, 2);
    assert.equal((await como(db, outroSegmento, "SELECT 1 FROM propostas")).length, 0);
});

test("mercado: cotação aberta é visível a todos; fechada só para o dono e quem propôs", async () => {
    const cotacao = await publicar();
    assert.equal((await como(db, outroSegmento, "SELECT 1 FROM cotacoes")).length, 1);

    const proposta = await propor(fornecedor, cotacao.id_cotacao, await produtoDe(fornecedor, "Chapa", METAIS), 40);
    await como(db, comprador, "SELECT aceitar_proposta($1)", [proposta.id_proposta]);

    assert.equal((await como(db, outroSegmento, "SELECT 1 FROM cotacoes")).length, 0);
    assert.equal((await como(db, fornecedor, "SELECT status FROM cotacoes"))[0].status, "FECHADA");
    assert.equal((await como(db, comprador, "SELECT status FROM cotacoes"))[0].status, "FECHADA");
});

test("ninguém escreve direto nas tabelas nem forja o preço de um pedido", async () => {
    const cotacao = await publicar();
    const chapa = await produtoDe(fornecedor, "Chapa", METAIS, { minimo: 1 });
    const proposta = await propor(fornecedor, cotacao.id_cotacao, chapa, 1);

    assert.match(await erroDe(db, fornecedor, "UPDATE propostas SET preco_unitario = 999"), /permission denied/);
    assert.match(await erroDe(db, comprador, "UPDATE cotacoes SET status = 'FECHADA'"), /permission denied/);

    // O comprador tenta criar um pedido com o preço de R$ 1 da proposta sem aceitá-la
    assert.match(await erroDe(db, comprador, `
        INSERT INTO pedidos (id_usuario, id_produto, quantidade, valor_unitario, id_proposta)
        VALUES ($1, $2, 20, 1, $3)`, [comprador.idUsuario, chapa, proposta.id_proposta]), /não corresponde à proposta/);
});

test("depois de criado, o pedido não muda de preço, quantidade nem produto", async () => {
    const produto = await criarProduto(db, fornecedor, { preco: 10, minimo: 1 });
    const pedido = await criarPedido(db, comprador, produto, 5);

    // 1ª camada (003): o navegador só altera status_pedido
    assert.match(await erroDe(db, fornecedor, "UPDATE pedidos SET valor_unitario = 999 WHERE id_pedido = $1", [pedido]),
        /permission denied/);

    // 2ª camada (024): nem o servidor muda o combinado
    await lerComoAdmin(db, "UPDATE pedidos SET valor_unitario = 999, quantidade = 1, status_pedido = 'CONFIRMADO' WHERE id_pedido = $1", [pedido]);
    const [linha] = await lerComoAdmin(db, "SELECT valor_unitario, quantidade, status_pedido FROM pedidos WHERE id_pedido = $1", [pedido]);
    assert.deepEqual([Number(linha.valor_unitario), linha.quantidade, linha.status_pedido], [10, 5, "CONFIRMADO"]);
});

test("regras da proposta: produto próprio, ativo, com estoque; cotação aberta e de outra empresa", async () => {
    const cotacao = await publicar(comprador, { quantidade: 500 });
    const pouco = await produtoDe(fornecedor, "Chapa pouca", METAIS, { estoque: 100 });
    const doConcorrente = await produtoDe(concorrente, "Chapa N", METAIS);

    assert.match(await erroDe(db, fornecedor, "SELECT enviar_proposta($1, $2, 10, 5)", [cotacao.id_cotacao, pouco]),
        /Estoque insuficiente: o comprador precisa de 500 e você tem 100/);
    assert.match(await erroDe(db, fornecedor, "SELECT enviar_proposta($1, $2, 10, 5)", [cotacao.id_cotacao, doConcorrente]),
        /produto do seu catálogo/);

    const ambos = await criarEmpresa(db, "Ambos", "Atacadão Ambos");
    const daAmbos = await publicar(ambos);
    const produtoAmbos = await produtoDe(ambos, "Chapa A", METAIS);
    assert.match(await erroDe(db, ambos, "SELECT enviar_proposta($1, $2, 10, 5)", [daAmbos.id_cotacao, produtoAmbos]),
        /sua própria cotação/);

    await como(db, comprador, "SELECT cancelar_cotacao($1)", [cotacao.id_cotacao]);
    const bastante = await produtoDe(fornecedor, "Chapa grande", METAIS, { estoque: 5000 });
    assert.match(await erroDe(db, fornecedor, "SELECT enviar_proposta($1, $2, 10, 5)", [cotacao.id_cotacao, bastante]),
        /não está mais recebendo/);
});

test("proposta pode ser atualizada (uma por fornecedor) e retirada; retirada não pode ser aceita", async () => {
    const cotacao = await publicar();
    const chapa = await produtoDe(fornecedor, "Chapa", METAIS);

    await propor(fornecedor, cotacao.id_cotacao, chapa, 40);
    const atualizada = await propor(fornecedor, cotacao.id_cotacao, chapa, 37, 2);
    assert.equal(Number(atualizada.preco_unitario), 37);
    assert.equal((await lerComoAdmin(db, "SELECT 1 FROM propostas")).length, 1);

    await como(db, fornecedor, "SELECT retirar_proposta($1)", [cotacao.id_cotacao]);
    assert.match(await erroDe(db, comprador, "SELECT aceitar_proposta($1)", [atualizada.id_proposta]), /não está mais disponível/);
});

test("validações da publicação", async () => {
    assert.match(await erroDe(db, fornecedor, "SELECT publicar_cotacao('Chapa', $1, 10)", [METAIS]), /Só empresas compradoras/);
    assert.match(await erroDe(db, comprador, "SELECT publicar_cotacao('Chapa', 'Grãos', 10)"), /segmento da lista/);
    assert.match(await erroDe(db, comprador, "SELECT publicar_cotacao('Chapa', $1, 10, 'un.', null, null, 60)", [METAIS]), /1 a 30 dias/);
    assert.match(await erroDe(db, comprador, "SELECT publicar_cotacao('ab', $1, 10)", [METAIS]), /pelo menos 3 letras/);
});

test("avisos: fornecedores do segmento recebem a cotação (agrupada no dia); comprador recebe as propostas", async () => {
    await produtoDe(fornecedor, "Chapa", METAIS);                         // vende no segmento
    await como(db, concorrente, "SELECT definir_segmentos($1::text[])", [[METAIS]]);   // acompanha o segmento
    await produtoDe(outroSegmento, "Arroz", ALIMENTOS);                  // outro segmento

    const primeira = await publicar();
    await publicar(comprador, { titulo: "Barra redonda", quantidade: 50, unidade: "kg" });

    const [doFornecedor] = await avisos(fornecedor, "COTACAO_NOVA");
    assert.deepEqual(doFornecedor.dados.itens.map(i => i.titulo), ["Chapa de aço 2mm", "Barra redonda"]);
    assert.equal(doFornecedor.dados.itens[1].unidade, "kg");
    assert.equal((await avisos(concorrente, "COTACAO_NOVA")).length, 1);
    assert.equal((await avisos(outroSegmento, "COTACAO_NOVA")).length, 0);
    assert.equal((await lerComoAdmin(db, "SELECT 1 FROM notificacoes_email WHERE tipo = 'COTACAO_NOVA'")).length, 2);

    await propor(fornecedor, primeira.id_cotacao, (await lerComoAdmin(db, "SELECT id_produto FROM produtos WHERE nome_produto = 'Chapa'"))[0].id_produto, 40);
    await propor(concorrente, primeira.id_cotacao, await produtoDe(concorrente, "Chapa N", METAIS), 39);

    const [propostas] = await avisos(comprador, "PROPOSTA_RECEBIDA");
    assert.equal(propostas.quantidade, 2);
    assert.equal(propostas.dados.fornecedor, "Metalúrgica Norte");
});
