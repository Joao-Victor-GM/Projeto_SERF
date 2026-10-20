// Segmentos de interesse (migration 021): filtro do radar e aviso de
// produto novo no segmento.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, lerComoAdmin } from "./banco.mjs";

const ALIMENTOS = "Alimentos & Bebidas";
const METAIS = "Metalurgia & Usinagem";

let db, comprador, outroComprador, fornecedor;

beforeEach(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador", "Mercado Bom Preço");
    outroComprador = await criarEmpresa(db, "Comprador", "Padaria Central");
    fornecedor = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul");
});

const definir = (empresa, categorias) =>
    como(db, empresa, "SELECT public.definir_segmentos($1::text[]) AS s", [categorias]);
const meus = async empresa =>
    (await como(db, empresa, "SELECT categoria FROM segmentos_interesse ORDER BY categoria")).map(l => l.categoria);

async function cadastrarProduto(nome, categoria, extras = {}) {
    const p = { estoque: 100, minimo: 1, ativo: true, ...extras };
    const [linha] = await como(db, fornecedor, `
        INSERT INTO produtos (id_fornecedor, nome_produto, categoria, preco_atacado, quantidade_minima, quantidade_estoque, ativo)
        VALUES ($1, $2, $3, 10, $4, $5, $6) RETURNING id_produto`,
        [fornecedor.idFornecedor, nome, categoria, p.minimo, p.estoque, p.ativo]);
    return linha.id_produto;
}

const avisos = async empresa => (await lerComoAdmin(db,
    "SELECT dados FROM notificacoes_email WHERE tipo = 'NOVO_PRODUTO_SEGMENTO' AND auth_user_id = $1", [empresa.uid]))
    .map(l => l.dados);

test("definir_segmentos troca a seleção de uma vez, sem repetir nem vazios", async () => {
    await definir(comprador, [ALIMENTOS, METAIS]);
    assert.deepEqual(await meus(comprador), [ALIMENTOS, METAIS]);

    await definir(comprador, [METAIS, `  ${METAIS} `, "", "Construção Civil"]);
    assert.deepEqual(await meus(comprador), ["Construção Civil", METAIS]);

    await definir(comprador, []);
    assert.deepEqual(await meus(comprador), [], "lista vazia = acompanhar tudo");
});

test("privacidade: cada um vê e altera só os próprios segmentos", async () => {
    await definir(comprador, [ALIMENTOS]);
    await definir(outroComprador, [METAIS]);

    assert.deepEqual(await meus(outroComprador), [METAIS]);
    await como(db, outroComprador, "DELETE FROM segmentos_interesse");          // RLS: só os dele
    assert.deepEqual(await meus(comprador), [ALIMENTOS]);

    assert.match(await erroDe(db, outroComprador,
        "INSERT INTO segmentos_interesse (auth_user_id, categoria) VALUES ($1, 'X')", [comprador.uid]), /row-level security/);
});

test("limite de 20 segmentos", async () => {
    const muitos = Array.from({ length: 21 }, (_, i) => `Segmento ${i}`);
    assert.match(await erroDe(db, comprador, "SELECT public.definir_segmentos($1::text[])", [muitos]), /no máximo 20/);
});

test("radar: filtrar a view oportunidades pelo segmento", async () => {
    await cadastrarProduto("Arroz", ALIMENTOS);
    await cadastrarProduto("Chapa de aço", METAIS);

    const filtradas = await como(db, comprador,
        "SELECT produto_nome FROM oportunidades WHERE categoria = ANY ($1::text[])", [[METAIS]]);
    assert.deepEqual([...new Set(filtradas.map(o => o.produto_nome))], ["Chapa de aço"]);
});

test("produto novo no segmento avisa quem acompanha; 1 e-mail por dia agrupando produtos", async () => {
    await definir(comprador, [ALIMENTOS]);
    await definir(outroComprador, [METAIS]);

    await cadastrarProduto("Arroz", ALIMENTOS);
    await cadastrarProduto("Feijão", ALIMENTOS);

    const [aviso, ...resto] = await avisos(comprador);
    assert.equal(resto.length, 0, "um e-mail só no dia");
    assert.equal(aviso.categoria, ALIMENTOS);
    assert.deepEqual(aviso.itens.map(i => i.produto), ["Arroz", "Feijão"]);
    assert.equal(aviso.itens[0].fornecedor, "Distribuidora Sul");

    assert.deepEqual(await avisos(outroComprador), [], "não acompanha alimentos");
});

test("só produtos disponíveis: inativo ou sem estoque não avisa; reativar avisa", async () => {
    await definir(comprador, [METAIS]);

    const pausado = await cadastrarProduto("Chapa pausada", METAIS, { ativo: false });
    await cadastrarProduto("Chapa sem estoque", METAIS, { minimo: 50, estoque: 10 });
    assert.deepEqual(await avisos(comprador), []);

    await como(db, fornecedor, "UPDATE produtos SET ativo = true WHERE id_produto = $1", [pausado]);
    assert.deepEqual((await avisos(comprador))[0].itens.map(i => i.produto), ["Chapa pausada"]);
});

test("fornecedor não é avisado do próprio produto; quem desligou e-mails não recebe", async () => {
    const ambos = await criarEmpresa(db, "Ambos", "Atacadão Ambos");
    await definir(ambos, [ALIMENTOS]);
    await definir(comprador, [ALIMENTOS]);
    await como(db, comprador, "INSERT INTO preferencias_notificacao (receber_email) VALUES (false)");

    await como(db, ambos, `INSERT INTO produtos (id_fornecedor, nome_produto, categoria, preco_atacado, quantidade_minima, quantidade_estoque)
                           VALUES ($1, 'Meu arroz', $2, 10, 1, 100)`, [ambos.idFornecedor, ALIMENTOS]);

    assert.deepEqual(await avisos(ambos), [], "não avisa o dono");
    assert.deepEqual(await avisos(comprador), [], "respeita a preferência de e-mail");
});
