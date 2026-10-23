// Posse do CNPJ (migration 029): verificação por código, CNPJ único só
// entre verificados, venda bloqueada sem identidade e o fim da "ocupação".

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { criarBanco, como, erroDe, criarEmpresa, criarProduto, criarPedido, lerComoAdmin } from "./banco.mjs";

// O mesmo hash da Edge Function e de hash_codigo_identidade()
const hash = (codigo, uid) => createHash("sha256").update(codigo + uid).digest("hex");

const registrar = (db, empresa, codigo = "123456") => lerComoAdmin(db,
    "SELECT registrar_codigo_identidade($1, $2, 'c***@empresa.com.br')", [empresa.uid, hash(codigo, empresa.uid)]);
const confirmar = (db, empresa, codigo) => como(db, empresa, "SELECT confirmar_identidade($1) AS r", [codigo]).then(l => l[0].r);
const identidade = async (db, empresa) => (await lerComoAdmin(db, "SELECT * FROM identidade_empresas WHERE auth_user_id = $1", [empresa.uid]))[0];

test("conta nova sem posse comprovada não recebe pedido nem envia proposta", async () => {
    const db = await criarBanco();
    const novo = await criarEmpresa(db, "Fornecedor", "Fornecedor Novo", { verificada: false });
    const comprador = await criarEmpresa(db, "Comprador");
    const produto = await criarProduto(db, novo, { minimo: 1 });

    await assert.rejects(criarPedido(db, comprador, produto, 1), /não comprovou a posse do CNPJ/);

    const [cotacao] = await como(db, comprador, "SELECT * FROM publicar_cotacao('Arroz', 'Alimentos & Bebidas', 1)");
    assert.match(await erroDe(db, novo, "SELECT enviar_proposta($1, $2, 10, 3)", [cotacao.id_cotacao, produto]),
        /Comprove a posse do CNPJ/);

    // Comprar continua liberado
    assert.equal(typeof (await criarProduto(db, comprador.idFornecedor ? comprador : await criarEmpresa(db, "Fornecedor"))), "number");
});

test("código certo verifica (e libera a venda); errado conta tentativa; 5 erros bloqueiam", async () => {
    const db = await criarBanco();
    const empresa = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul", { verificada: false });
    await registrar(db, empresa, "654321");

    assert.equal(await confirmar(db, empresa, "000000"), "incorreto:4");
    assert.equal((await identidade(db, empresa)).tentativas, 1, "a tentativa errada fica registrada");
    assert.equal(await confirmar(db, empresa, " 654321 "), "verificada");
    assert.equal(await confirmar(db, empresa, "654321"), "ja_verificada");

    const id = await identidade(db, empresa);
    assert.equal(id.metodo, "DEMONSTRACAO", "modo padrão");
    assert.equal(id.codigo_hash, null, "o código não fica guardado depois de usado");

    const comprador = await criarEmpresa(db, "Comprador");
    await criarPedido(db, comprador, await criarProduto(db, empresa, { minimo: 1 }), 1);

    // Outro, que erra 5 vezes
    const outro = await criarEmpresa(db, "Fornecedor", "Outra", { verificada: false });
    await registrar(db, outro, "111111");
    const restantes = [];
    for (let i = 0; i < 5; i++) restantes.push(await confirmar(db, outro, "999999"));
    assert.deepEqual(restantes, ["incorreto:4", "incorreto:3", "incorreto:2", "incorreto:1", "incorreto:0"]);
    // Nem o código certo vale depois de 5 erros: força pedir outro (força bruta inviável)
    assert.match(await erroDe(db, outro, "SELECT confirmar_identidade('111111')"), /Muitas tentativas/);
});

test("código expira; no máximo 3 envios por hora", async () => {
    const db = await criarBanco();
    const empresa = await criarEmpresa(db, "Fornecedor", "Empresa", { verificada: false });

    await registrar(db, empresa, "123456");
    await lerComoAdmin(db, "UPDATE identidade_empresas SET codigo_expira_em = NOW() - INTERVAL '1 minute' WHERE auth_user_id = $1", [empresa.uid]);
    assert.match(await erroDe(db, empresa, "SELECT confirmar_identidade('123456')"), /expirado/);

    await registrar(db, empresa);
    await registrar(db, empresa);
    await assert.rejects(registrar(db, empresa), /Muitos códigos/);
});

test("o dono verdadeiro recupera o CNPJ ocupado; quem ocupava perde a carência", async () => {
    const db = await criarBanco();
    const CNPJ = "11222333000181";

    // Alguém cadastrou o CNPJ antes (conta antiga, com carência)
    const ocupante = await criarEmpresa(db, "Fornecedor", "Ocupante", { verificada: false, cnpj: CNPJ });
    await lerComoAdmin(db, "UPDATE identidade_empresas SET carencia_ate = NOW() + INTERVAL '30 days' WHERE auth_user_id = $1", [ocupante.uid]);
    const comprador = await criarEmpresa(db, "Comprador");
    const produtoOcupante = await criarProduto(db, ocupante, { minimo: 1 });
    await criarPedido(db, comprador, produtoOcupante, 1);           // na carência, vende

    // O dono consegue se cadastrar com o MESMO CNPJ (antes: CNPJ_JA_CADASTRADO)
    const dono = await criarEmpresa(db, "Fornecedor", "Empresa Verdadeira", { verificada: false, cnpj: CNPJ });
    await registrar(db, dono, "222222");
    assert.equal(await confirmar(db, dono, "222222"), "verificada");

    const doOcupante = await identidade(db, ocupante);
    assert.ok(doOcupante.contestada_em);
    assert.equal(doOcupante.carencia_ate, null);
    await assert.rejects(criarPedido(db, comprador, produtoOcupante, 1), /não comprovou a posse/);
    await assert.rejects(registrar(db, ocupante), /já foi verificado por outra conta/);

    // Daqui em diante, ninguém mais cadastra esse CNPJ
    await assert.rejects(criarEmpresa(db, "Comprador", "Terceiro", { cnpj: CNPJ }), /CNPJ_JA_VERIFICADO/);
});

test("selo homologado exige a posse; vem sozinho ao comprovar", async () => {
    const db = await criarBanco();
    const empresa = await criarEmpresa(db, "Fornecedor", "Distribuidora", { verificada: false });

    // A Edge Function homologar-fornecedor grava APROVADO (Receita OK)...
    await lerComoAdmin(db, "UPDATE fornecedores SET status_cadastro = 'APROVADO' WHERE id_fornecedor = $1", [empresa.idFornecedor]);
    let [f] = await lerComoAdmin(db, "SELECT status_cadastro, homologacao_motivo FROM fornecedores WHERE id_fornecedor = $1", [empresa.idFornecedor]);
    assert.equal(f.status_cadastro, "PENDENTE", "...mas sem a posse o selo não vem");
    assert.match(f.homologacao_motivo, /^POSSE_PENDENTE:/);

    await registrar(db, empresa, "333333");
    await confirmar(db, empresa, "333333");
    [f] = await lerComoAdmin(db, "SELECT status_cadastro FROM fornecedores WHERE id_fornecedor = $1", [empresa.idFornecedor]);
    assert.equal(f.status_cadastro, "APROVADO");
});

test("privacidade: ninguém lê o hash do código, a identidade alheia nem registra código", async () => {
    const db = await criarBanco();
    const empresa = await criarEmpresa(db, "Fornecedor", "A", { verificada: false });
    const outra = await criarEmpresa(db, "Comprador", "B");
    await registrar(db, empresa);

    assert.match(await erroDe(db, empresa, "SELECT codigo_hash FROM identidade_empresas"), /permission denied/);
    const [propria] = await como(db, empresa, "SELECT email_destino, verificada_em FROM identidade_empresas");
    assert.equal(propria.email_destino, "c***@empresa.com.br");
    assert.equal((await como(db, outra, "SELECT 1 FROM identidade_empresas WHERE auth_user_id = $1", [empresa.uid])).length, 0);

    assert.match(await erroDe(db, outra, "SELECT registrar_codigo_identidade($1, 'x', 'y')", [outra.uid]), /permission denied/);
    assert.match(await erroDe(db, outra, "UPDATE identidade_empresas SET verificada_em = NOW()"), /permission denied/);
});
