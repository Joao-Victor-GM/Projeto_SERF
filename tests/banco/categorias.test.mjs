// Categorias validadas pelo banco (migration 022).

import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, lerComoAdmin } from "./banco.mjs";
import { carregarScripts, simples } from "../unit/carregar-script.mjs";

const { SERFUtils } = carregarScripts(["utils.js"], { obterSupabase: () => ({}) });

const inserirProduto = (db, fornecedor, categoria, nome = "Produto") => como(db, fornecedor, `
    INSERT INTO produtos (id_fornecedor, nome_produto, categoria, preco_atacado, quantidade_minima, quantidade_estoque)
    VALUES ($1, $2, $3, 10, 1, 100) RETURNING id_produto`, [fornecedor.idFornecedor, nome, categoria]);

test("a lista do banco é a mesma do front-end (SERFUtils.CATEGORIAS_PRODUTO), na mesma ordem", async () => {
    const db = await criarBanco();
    const comprador = await criarEmpresa(db, "Comprador");

    const doBanco = (await como(db, comprador, "SELECT nome FROM categorias ORDER BY ordem")).map(l => l.nome);
    assert.deepEqual(doBanco, simples(SERFUtils.CATEGORIAS_PRODUTO));

    assert.match(await erroDe(db, comprador, "INSERT INTO categorias (nome) VALUES ('Nova')"), /permission denied|row-level security/);
});

test("produto só aceita categoria oficial (ou nenhuma)", async () => {
    const db = await criarBanco();
    const fornecedor = await criarEmpresa(db, "Fornecedor");

    await inserirProduto(db, fornecedor, "Alimentos & Bebidas");
    await inserirProduto(db, fornecedor, null);
    assert.match(await erroDe(db, fornecedor, `
        INSERT INTO produtos (id_fornecedor, nome_produto, categoria, preco_atacado, quantidade_minima, quantidade_estoque)
        VALUES ($1, 'X', 'alimentos', 10, 1, 100)`, [fornecedor.idFornecedor]), /fk_produtos_categoria/);
});

test("segmento desconhecido: mensagem clara, nada é salvo", async () => {
    const db = await criarBanco();
    const comprador = await criarEmpresa(db, "Comprador");

    assert.match(await erroDe(db, comprador, "SELECT definir_segmentos($1::text[])", [["Alimentos & Bebidas", "Grãos"]]),
        /Segmento desconhecido: Grãos/);
    assert.deepEqual(await como(db, comprador, "SELECT categoria FROM segmentos_interesse"), []);
});

test("renomear uma categoria propaga para produtos e segmentos", async () => {
    const db = await criarBanco();
    const fornecedor = await criarEmpresa(db, "Fornecedor");
    const comprador = await criarEmpresa(db, "Comprador");
    await inserirProduto(db, fornecedor, "Outros");
    await como(db, comprador, "SELECT definir_segmentos($1::text[])", [["Outros"]]);

    await lerComoAdmin(db, "UPDATE categorias SET nome = 'Diversos' WHERE nome = 'Outros'");

    assert.deepEqual(await lerComoAdmin(db, "SELECT DISTINCT categoria FROM produtos"), [{ categoria: "Diversos" }]);
    assert.deepEqual(await como(db, comprador, "SELECT categoria FROM segmentos_interesse"), [{ categoria: "Diversos" }]);
});

test("dados antigos são convertidos antes da FK (sem perder produtos)", async () => {
    let fornecedor, comprador;

    const db = await criarBanco({
        antesDe: async (nome, banco) => {
            if (!nome.startsWith("022")) return;
            fornecedor = await criarEmpresa(banco, "Fornecedor");
            comprador = await criarEmpresa(banco, "Comprador");

            for (const [produto, categoria] of [
                ["A", "ALIMENTOS & BEBIDAS"], ["B", " construcao  civil "], ["C", "Metalurgia pesada"],
                ["D", "Grãos"], ["E", null], ["F", "Tecnologia & Insumos"]
            ]) await inserirProduto(banco, fornecedor, categoria, produto);

            await como(banco, comprador, "SELECT definir_segmentos($1::text[])",
                [["Alimentos & Bebidas", "alimentos & bebidas", "Grãos", "metalurgia"]]);
        }
    });

    const produtos = await lerComoAdmin(db, "SELECT nome_produto, categoria FROM produtos ORDER BY nome_produto");
    assert.deepEqual(produtos.map(p => [p.nome_produto, p.categoria]), [
        ["A", "Alimentos & Bebidas"], ["B", "Construção Civil"], ["C", "Metalurgia & Usinagem"],
        ["D", "Outros"], ["E", null], ["F", "Tecnologia & Insumos"]
    ]);

    const segmentos = await como(db, comprador, "SELECT categoria FROM segmentos_interesse ORDER BY categoria");
    assert.deepEqual(segmentos.map(s => s.categoria), ["Alimentos & Bebidas", "Metalurgia & Usinagem"]);
});
