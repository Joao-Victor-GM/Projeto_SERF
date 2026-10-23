// Posse do CNPJ: Edge Function verificar-cnpj (regras) e o e-mail enviado.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tratarEnvio, mascararEmail, gerarCodigo, hashCodigo, ErroDeRegra }
    from "../../supabase/functions/verificar-cnpj/regras.ts";
import { montarEmail } from "../../supabase/functions/enviar-emails/modelos.ts";

const UID = "00000000-0000-0000-0000-000000000042";

function cenario({ modo = "REAL", receita = { email: "contato@contabilxyz.com.br", razao_social: "DISTRIBUIDORA SUL LTDA" },
                   identidade = { cnpj: "12345678000190", verificada_em: null }, registrar } = {}) {
    const passos = [];
    const deps = {
        modo: async () => modo,
        usuario: async token => (token === "jwt" ? { id: UID, email: "golpista@gmail.com" } : null),
        identidade: async () => identidade,
        receita: async () => receita,
        registrar: registrar || (async (uid, hash, mascarado) => { passos.push(["registrar", hash, mascarado]); }),
        enfileirar: async (uid, destino, dados) => { passos.push(["enfileirar", destino, dados]); },
        gerar: () => "482913"
    };
    const pedir = (token = "jwt") => tratarEnvio(new Request("https://x/functions/v1/verificar-cnpj", {
        method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}
    }), deps);
    return { pedir, passos };
}

test("REAL: o código vai para o e-mail da RECEITA (não para quem pediu) e nunca volta na resposta", async () => {
    const { pedir, passos } = cenario();
    const resposta = await pedir();
    const corpo = await resposta.json();

    assert.equal(resposta.status, 200);
    assert.deepEqual(corpo, { modo: "REAL", destino: "c***@contabilxyz.com.br" });
    assert.equal(corpo.codigo, undefined, "quem pediu não vê o código");

    const [, destino, dados] = passos.find(p => p[0] === "enfileirar");
    assert.equal(destino, "contato@contabilxyz.com.br");
    assert.equal(dados.codigo, "482913");
    assert.equal(dados.solicitante, "g***@gmail.com", "o e-mail diz quem pediu");

    // O banco recebe só o hash, igual ao do banco (sha256(código + uid))
    const [, hash] = passos.find(p => p[0] === "registrar");
    assert.equal(hash, createHash("sha256").update("482913" + UID).digest("hex"));
});

test("REAL: CNPJ sem e-mail na Receita → 422 explicando a saída; Receita fora → 503", async () => {
    const semEmail = cenario({ receita: { email: null, razao_social: "X" } });
    const r1 = await semEmail.pedir();
    assert.equal(r1.status, 422);
    assert.match((await r1.json()).erro, /não tem e-mail cadastrado/);
    assert.deepEqual(semEmail.passos, []);

    assert.equal((await cenario({ receita: null }).pedir()).status, 503);
});

test("DEMONSTRAÇÃO: o código volta para a tela e nenhum e-mail é enviado", async () => {
    const { pedir, passos } = cenario({ modo: "DEMONSTRACAO" });
    const corpo = await (await pedir()).json();

    assert.deepEqual(corpo, { modo: "DEMONSTRACAO", destino: "g***@gmail.com", codigo: "482913" });
    assert.equal(passos.some(p => p[0] === "enfileirar"), false);
});

test("sem sessão 401; já verificada 409; limite do banco vira mensagem 409", async () => {
    assert.equal((await cenario().pedir(null)).status, 401);
    assert.equal((await cenario({ identidade: { cnpj: "1", verificada_em: "2026-10-01" } }).pedir()).status, 409);

    const limitado = cenario({ registrar: async () => { throw new ErroDeRegra("Muitos códigos pedidos. Aguarde uma hora e tente de novo."); } });
    const resposta = await limitado.pedir();
    assert.equal(resposta.status, 409);
    assert.match((await resposta.json()).erro, /Aguarde uma hora/);
    assert.equal(limitado.passos.some(p => p[0] === "enfileirar"), false, "sem registrar, nada é enviado");
});

test("código: 6 dígitos, uniforme (descarta valores enviesados); máscara de e-mail", async () => {
    const valores = [0xFFFFFFFF, 1234];                 // o 1º é descartado
    assert.equal(gerarCodigo(buf => { buf[0] = valores.shift(); }), "001234");
    for (let i = 0; i < 200; i++) assert.match(gerarCodigo(), /^\d{6}$/);

    assert.equal(mascararEmail("joao.silva@empresa.com.br"), "j***@empresa.com.br");
    assert.equal(mascararEmail("invalido"), "e-mail cadastrado");
    assert.equal(await hashCodigo("1", "a"), createHash("sha256").update("1a").digest("hex"));
});

test("e-mail de verificação: diz quem pediu, o código, a validade; sem descadastro", () => {
    const email = montarEmail("VERIFICACAO_CNPJ", { codigo: "482913", cnpj: "12345678000190",
        razao_social: "DISTRIBUIDORA SUL LTDA", solicitante: "g***@gmail.com" }, "https://serf.exemplo.com", "https://link-de-descadastro");

    assert.match(email.texto, /g\*\*\*@gmail\.com/);
    assert.match(email.texto, /DISTRIBUIDORA SUL LTDA \(CNPJ 12\.345\.678\/0001-90\)/);
    assert.match(email.texto, /Código: 482913/);
    assert.match(email.texto, /30 minutos/);
    assert.match(email.texto, /Não reconhece este pedido\? Ignore/);
    assert.doesNotMatch(email.texto + email.html, /link-de-descadastro|Parar de receber/);
    assert.doesNotMatch(email.assunto, /482913/, "o código não aparece no assunto (prévia de notificação)");
});
