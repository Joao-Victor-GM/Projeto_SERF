// NF-e real (migration 027): dados fiscais, modo REAL e retorno do emissor.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, criarProduto, criarPedido, mudarStatus, lerComoAdmin } from "./banco.mjs";

let db, comprador, fornecedor, produto, pedido;

beforeEach(async () => {
    db = await criarBanco();
    comprador = await criarEmpresa(db, "Comprador", "Mercado Bom Preço");
    fornecedor = await criarEmpresa(db, "Fornecedor", "Distribuidora Sul");
    produto = await criarProduto(db, fornecedor, { nome: "Arroz 5kg", preco: 10, minimo: 1 });
    pedido = await criarPedido(db, comprador, produto, 5);
    await mudarStatus(db, fornecedor, pedido, "CONFIRMADO");
    await como(db, comprador, "SELECT iniciar_pagamento($1, 'PIX')", [pedido]);
    await como(db, comprador, "SELECT confirmar_pagamento_simulado($1)", [pedido]);
});

const modoReal = () => lerComoAdmin(db, "UPDATE configuracao_nfe SET modo = 'REAL'");
const nota = async () => (await lerComoAdmin(db, "SELECT * FROM notas_fiscais WHERE id_pedido = $1 ORDER BY id_nota DESC", [pedido]))[0];

async function preencherDadosFiscais({ ufComprador = "PR" } = {}) {
    await como(db, fornecedor, "UPDATE fornecedores SET estado = 'PR', cidade = 'Curitiba' WHERE id_fornecedor = $1", [fornecedor.idFornecedor]);
    await como(db, fornecedor, "UPDATE produtos SET ncm = '10063021', unidade_fiscal = 'UN' WHERE id_produto = $1", [produto]);
    await como(db, comprador, `UPDATE usuarios SET cep = '80010000', logradouro = 'Rua XV de Novembro', numero_endereco = '100',
        bairro = 'Centro', municipio = 'Curitiba', uf = $2, inscricao_estadual = '9012345678' WHERE id_usuario = $1`,
        [comprador.idUsuario, ufComprador]);
}

const preparar = () => como(db, fornecedor, "SELECT preparar_nfe($1) AS d", [pedido]).then(l => l[0].d);
const enviar = ref => lerComoAdmin(db, "SELECT * FROM registrar_nfe_enviada($1, $2, '5102', $3)", [pedido, ref, fornecedor.uid]);
const retorno = (ref, status, extras = {}) => lerComoAdmin(db,
    "SELECT * FROM atualizar_nfe_provedor($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [ref, status, extras.numero ?? null, extras.serie ?? null, extras.chave ?? null, extras.protocolo ?? null,
     extras.danfe ?? null, extras.xml ?? null, extras.mensagem ?? null]).then(l => l[0]);

const CHAVE = "41261012345678000190550010000000421234567890";

test("modo padrão SIMULADA: a NF-e da 010 continua igual; preparar_nfe recusa", async () => {
    await como(db, fornecedor, "SELECT emitir_nota_fiscal($1)", [pedido]);
    assert.equal((await nota()).status, "AUTORIZADA");
    assert.match(await erroDe(db, fornecedor, "SELECT preparar_nfe($1)", [pedido]), /não está ativa/);
});

test("preparar_nfe lista TUDO o que falta, dizendo onde corrigir", async () => {
    await modoReal();
    const erro = await erroDe(db, fornecedor, "SELECT preparar_nfe($1)", [pedido]);

    assert.match(erro, /Faltam dados para a NF-e/);
    assert.match(erro, /UF da sua empresa \(Perfil\)/);
    assert.match(erro, /NCM do produto "Arroz 5kg" \(Catálogo → editar produto\)/);
    assert.match(erro, /endereço completo de Mercado Bom Preço \(o comprador preenche no Perfil\)/);
});

test("preparar_nfe com dados completos: CFOP 5102 no mesmo estado, 6102 entre estados", async () => {
    await modoReal();
    await preencherDadosFiscais();

    const dados = await preparar();
    assert.equal(dados.ref, `serf-${pedido}-1`);
    assert.equal(dados.cfop, "5102");
    assert.equal(dados.item.ncm, "10063021");
    assert.equal(dados.destinatario.municipio, "Curitiba");
    assert.equal(Number(dados.item.valor_total), 50);

    await como(db, comprador, "UPDATE usuarios SET uf = 'SP' WHERE id_usuario = $1", [comprador.idUsuario]);
    assert.equal((await preparar()).cfop, "6102");
});

test("regime normal ainda não é suportado (mensagem clara)", async () => {
    await modoReal();
    await preencherDadosFiscais();
    await como(db, fornecedor, "UPDATE fornecedores SET regime_tributario = 'NORMAL' WHERE id_fornecedor = $1", [fornecedor.idFornecedor]);
    assert.match(await erroDe(db, fornecedor, "SELECT preparar_nfe($1)", [pedido]), /só para Simples Nacional/);
});

test("fluxo: PROCESSANDO → AUTORIZADA (idempotente) libera o envio", async () => {
    await modoReal();
    await preencherDadosFiscais();
    const { ref } = await preparar();
    await enviar(ref);

    assert.equal((await nota()).status, "PROCESSANDO");
    assert.match(await erroDe(db, fornecedor, "SELECT preparar_nfe($1)", [pedido]), /em processamento/);
    await assert.rejects(mudarStatus(db, fornecedor, pedido, "ENVIADO"), /Emita a nota fiscal antes/);

    const autorizada = await retorno(ref, "AUTORIZADA", { numero: 42, serie: 1, chave: CHAVE, protocolo: "141260000012345",
        danfe: "https://focus/danfe.pdf", xml: "https://focus/nota.xml", mensagem: "Autorizado o uso da NF-e" });
    assert.equal(autorizada.status, "AUTORIZADA");
    assert.equal(autorizada.numero, 42);
    assert.equal(autorizada.url_danfe, "https://focus/danfe.pdf");
    assert.equal((await retorno(ref, "AUTORIZADA", { numero: 99 })).numero, 42, "repetido não muda nada");

    await mudarStatus(db, fornecedor, pedido, "ENVIADO");
});

test("REJEITADA guarda a mensagem da SEFAZ e permite emitir de novo (nova referência)", async () => {
    await modoReal();
    await preencherDadosFiscais();
    const { ref } = await preparar();
    await enviar(ref);

    await retorno(ref, "REJEITADA", { mensagem: "Rejeição 778: NCM inexistente" });
    assert.equal((await nota()).mensagem_sefaz, "Rejeição 778: NCM inexistente");

    assert.equal((await preparar()).ref, `serf-${pedido}-2`);
});

test("modo REAL: nota simulada bloqueada; nota real só autoriza/cancela pelo emissor", async () => {
    await modoReal();
    assert.match(await erroDe(db, fornecedor, "SELECT emitir_nota_fiscal($1)", [pedido]), /emita pela SEFAZ/);

    await preencherDadosFiscais();
    const { ref } = await preparar();
    await enviar(ref);
    await retorno(ref, "AUTORIZADA", { numero: 42, chave: CHAVE, protocolo: "1" });

    assert.match(await erroDe(db, fornecedor, "SELECT cancelar_nota_fiscal($1, 'Erro no pedido do cliente')", [pedido]),
        /Cancelar NF-e/);
    // Cancelar o pedido também não derruba a nota real sozinho
    await assert.rejects(mudarStatus(db, fornecedor, pedido, "CANCELADO"), /Cancelar NF-e/);

    const ref2 = (await como(db, fornecedor, "SELECT preparar_cancelamento_nfe($1, 'Pedido digitado com erro') AS r", [pedido]))[0].r;
    assert.equal(ref2, ref);
    await retorno(ref, "CANCELADA", { mensagem: "Pedido digitado com erro" });
    assert.equal((await nota()).status, "CANCELADA");
    await mudarStatus(db, fornecedor, pedido, "CANCELADO");
});

test("cancelamento: justificativa mínima, prazo de 24 h e só o fornecedor do pedido", async () => {
    await modoReal();
    await preencherDadosFiscais();
    const { ref } = await preparar();
    await enviar(ref);
    await retorno(ref, "AUTORIZADA", { numero: 42, chave: CHAVE, protocolo: "1" });

    assert.match(await erroDe(db, fornecedor, "SELECT preparar_cancelamento_nfe($1, 'curto')", [pedido]), /15 caracteres/);
    assert.match(await erroDe(db, comprador, "SELECT preparar_cancelamento_nfe($1, 'Justificativa longa o bastante')", [pedido]), /não encontrado/);

    await lerComoAdmin(db, "UPDATE notas_fiscais SET data_emissao = NOW() - INTERVAL '25 hours' WHERE provedor_ref = $1", [ref]);
    assert.match(await erroDe(db, fornecedor, "SELECT preparar_cancelamento_nfe($1, 'Justificativa longa o bastante')", [pedido]), /expirou/);
});

test("dados fiscais: formatos validados e cada empresa só altera os seus", async () => {
    assert.match(await erroDe(db, fornecedor, "UPDATE produtos SET ncm = '123' WHERE id_produto = $1", [produto]), /ck_produtos_ncm/);
    assert.match(await erroDe(db, comprador, "UPDATE usuarios SET cep = '8001A000' WHERE id_usuario = $1", [comprador.idUsuario]), /ck_usuarios_cep/);
    await como(db, comprador, "UPDATE usuarios SET inscricao_estadual = 'ISENTO' WHERE id_usuario = $1", [comprador.idUsuario]);

    // Só leem/escrevem as notas pelas funções; o emissor só pelo servidor
    assert.match(await erroDe(db, fornecedor, "SELECT atualizar_nfe_provedor('x', 'AUTORIZADA')"), /permission denied/);
    assert.match(await erroDe(db, fornecedor, "SELECT registrar_nfe_enviada($1, 'x', '5102', null)", [pedido]), /permission denied/);
    assert.match(await erroDe(db, comprador, "SELECT nfe_ref_do_pedido(999999)"), /não encontrado/);
});
