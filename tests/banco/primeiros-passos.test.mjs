// Primeiros passos (migration 019).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, criarProduto, criarPedido, lerComoAdmin } from "./banco.mjs";

let db;

beforeEach(async () => { db = await criarBanco(); });

const passos = async empresa => (await como(db, empresa, "SELECT public.primeiros_passos() AS p"))[0].p;

test("empresa nova: nada feito; passos de cada papel conforme o perfil", async () => {
    const comprador = await criarEmpresa(db, "Comprador");
    const fornecedor = await criarEmpresa(db, "Fornecedor");

    assert.deepEqual(await passos(comprador), {
        perfil: "Comprador", perfil_completo: false, cadastrou_produto: null,
        cnpj_verificado: null, fez_pedido: false, enviou_mensagem: false
    });

    const p = await passos(fornecedor);
    assert.equal(p.perfil, "Fornecedor");
    assert.equal(p.fez_pedido, null, "fornecedor puro não tem passo de compra");
    assert.equal(p.cadastrou_produto, false);
    assert.equal(p.cnpj_verificado, false);
});

test("cada ação marca o passo", async () => {
    const comprador = await criarEmpresa(db, "Comprador");
    const fornecedor = await criarEmpresa(db, "Fornecedor");

    await como(db, comprador, "UPDATE usuarios SET telefone = '41999990000' WHERE auth_user_id = $1", [comprador.uid]);
    assert.equal((await passos(comprador)).perfil_completo, true, "telefone + nicho (da segmentação)");

    const produto = await criarProduto(db, fornecedor);
    assert.equal((await passos(fornecedor)).cadastrou_produto, true);

    const pedido = await criarPedido(db, comprador, produto, 5);
    assert.equal((await passos(comprador)).fez_pedido, true);

    await como(db, comprador, "INSERT INTO mensagens_pedidos (id_pedido, id_remetente, texto) VALUES ($1, $2, 'Olá')", [pedido, comprador.uid]);
    assert.equal((await passos(comprador)).enviou_mensagem, true);
    assert.equal((await passos(fornecedor)).enviou_mensagem, false, "receber não conta");
});

test("fornecedor: perfil completo exige cidade/UF; CNPJ verificado = APROVADO", async () => {
    const fornecedor = await criarEmpresa(db, "Fornecedor");

    await como(db, fornecedor, "UPDATE fornecedores SET telefone = '41999990000' WHERE auth_user_id = $1", [fornecedor.uid]);
    assert.equal((await passos(fornecedor)).perfil_completo, false);

    await como(db, fornecedor, "UPDATE fornecedores SET cidade = 'Curitiba', estado = 'PR' WHERE auth_user_id = $1", [fornecedor.uid]);
    assert.equal((await passos(fornecedor)).perfil_completo, true);

    await lerComoAdmin(db, "UPDATE fornecedores SET status_cadastro = 'APROVADO' WHERE auth_user_id = $1", [fornecedor.uid]);
    assert.equal((await passos(fornecedor)).cnpj_verificado, true);
});

test("o navegador não consegue se homologar sozinho", async () => {
    const fornecedor = await criarEmpresa(db, "Fornecedor");

    for (const coluna of ["status_cadastro", "homologacao_motivo", "homologacao_em"]) {
        const erro = await erroDe(db, fornecedor,
            `UPDATE fornecedores SET ${coluna} = ${coluna} WHERE auth_user_id = $1`, [fornecedor.uid]);
        assert.match(erro, /permission denied/, coluna);
    }
});
