// Descadastro em um clique (supabase/functions/_shared/descadastro.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarToken, lerToken, linksDeDescadastro, tratarDescadastro }
    from "../../supabase/functions/_shared/descadastro.ts";

const SEGREDO = "segredo-de-teste";
const UID = "00000000-0000-0000-0000-000000000042";
const FUNCAO = "https://projeto.supabase.co/functions/v1/descadastrar";

function servidor() {
    const desligados = [];
    const tratar = req => tratarDescadastro(req, {
        segredo: SEGREDO, urlApp: "https://serf.exemplo.com/", desligar: async uid => { desligados.push(uid); }
    });
    return { tratar, desligados };
}

test("token assinado: lê o próprio usuário; adulterado ou de outro segredo, não", async () => {
    const token = await gerarToken(UID, SEGREDO);
    assert.equal(await lerToken(token, SEGREDO), UID);

    const outroUid = "00000000-0000-0000-0000-000000000043";
    const [, assinatura] = token.split(".");
    assert.equal(await lerToken(`${outroUid}.${assinatura}`, SEGREDO), null, "trocar o usuário invalida");
    assert.equal(await lerToken(token, "outro-segredo"), null);
    assert.equal(await lerToken(`${token}x`, SEGREDO), null);
    assert.equal(await lerToken("lixo", SEGREDO), null);
    assert.equal(await lerToken(null, SEGREDO), null);
    assert.equal(await lerToken(token, ""), null, "sem segredo configurado, nada vale");
});

test("links: página de confirmação no app e POST direto na função", async () => {
    const links = linksDeDescadastro("a.b", "https://serf.exemplo.com/", "https://projeto.supabase.co");
    assert.equal(links.pagina, "https://serf.exemplo.com/pages/public/descadastro.html?t=a.b");
    assert.equal(links.umClique, `${FUNCAO}?t=a.b`);
});

test("um clique do Gmail/Yahoo (POST com List-Unsubscribe=One-Click) desliga os e-mails", async () => {
    const { tratar, desligados } = servidor();
    const t = encodeURIComponent(await gerarToken(UID, SEGREDO));

    const resposta = await tratar(new Request(`${FUNCAO}?t=${t}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click"
    }));

    assert.equal(resposta.status, 200);
    assert.deepEqual(desligados, [UID]);
});

test("página de confirmação (POST com JSON {t}) desliga os e-mails", async () => {
    const { tratar, desligados } = servidor();
    const resposta = await tratar(new Request(FUNCAO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: await gerarToken(UID, SEGREDO) })
    }));

    assert.equal(resposta.status, 200);
    assert.equal(resposta.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(desligados, [UID]);
});

test("GET (pré-visualização de link) NÃO descadastra: só leva à página de confirmação", async () => {
    const { tratar, desligados } = servidor();
    const resposta = await tratar(new Request(`${FUNCAO}?t=abc.def`));

    assert.equal(resposta.status, 303);
    assert.equal(resposta.headers.get("location"), "https://serf.exemplo.com/pages/public/descadastro.html?t=abc.def");
    assert.deepEqual(desligados, []);
});

test("token inválido: 400, ninguém é descadastrado; preflight CORS responde", async () => {
    const { tratar, desligados } = servidor();

    const invalido = await tratar(new Request(`${FUNCAO}?t=${UID}.falsa`, { method: "POST" }));
    assert.equal(invalido.status, 400);
    assert.deepEqual(desligados, []);

    assert.equal((await tratar(new Request(FUNCAO, { method: "OPTIONS" }))).status, 204);
    assert.equal((await tratar(new Request(FUNCAO, { method: "DELETE" }))).status, 405);
});

test("falha ao gravar a preferência: 500 com mensagem genérica", async () => {
    const original = console.error;
    console.error = () => {};
    try {
        const resposta = await tratarDescadastro(
            new Request(`${FUNCAO}?t=${encodeURIComponent(await gerarToken(UID, SEGREDO))}`, { method: "POST" }),
            { segredo: SEGREDO, urlApp: "", desligar: async () => { throw new Error("banco fora"); } });

        assert.equal(resposta.status, 500);
        assert.doesNotMatch(await resposta.text(), /banco fora/);
    } finally {
        console.error = original;
    }
});
