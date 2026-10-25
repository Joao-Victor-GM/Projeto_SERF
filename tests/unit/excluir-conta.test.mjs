// Exclusão de conta (supabase/functions/excluir-conta/regras.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { tratarExclusao, ErroDeRegra } from "../../supabase/functions/excluir-conta/regras.ts";

const URL_FUNCAO = "https://projeto.supabase.co/functions/v1/excluir-conta";

function cenario({ usuario = { id: "u-1" }, anonimizar, apagarArquivos, apagarLogin } = {}) {
    const passos = [];
    const deps = {
        usuarioDoToken: async token => (token === "token-valido" ? usuario : null),
        anonimizar: anonimizar || (async uid => { passos.push(["anonimizar", uid]); }),
        apagarArquivos: apagarArquivos || (async uid => { passos.push(["apagarArquivos", uid]); }),
        apagarLogin: apagarLogin || (async uid => { passos.push(["apagarLogin", uid]); })
    };
    const pedir = (corpo, token = "token-valido") => tratarExclusao(new Request(URL_FUNCAO, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(corpo)
    }), deps);
    return { pedir, passos };
}

test("caminho feliz: anonimiza, apaga o logo do Storage e depois o login, nessa ordem", async () => {
    const { pedir, passos } = cenario();
    const resposta = await pedir({ confirmacao: "excluir " });

    assert.equal(resposta.status, 200);
    assert.deepEqual(passos, [["anonimizar", "u-1"], ["apagarArquivos", "u-1"], ["apagarLogin", "u-1"]]);
});

test("falha ao apagar o arquivo do Storage não impede a exclusão do login", async () => {
    const passos = [];
    const { pedir } = cenario({
        apagarArquivos: async () => { throw new Error("Storage 500"); },
        apagarLogin: async uid => { passos.push(["apagarLogin", uid]); }
    });
    const erroOriginal = console.error;
    console.error = () => {};
    try {
        assert.equal((await pedir({ confirmacao: "EXCLUIR" })).status, 200);
    } finally {
        console.error = erroOriginal;
    }
    assert.deepEqual(passos, [["apagarLogin", "u-1"]]);
});

test("sem sessão válida: 401 e nada acontece", async () => {
    for (const token of [null, "token-falso"]) {
        const { pedir, passos } = cenario();
        assert.equal((await pedir({ confirmacao: "EXCLUIR" }, token)).status, 401);
        assert.deepEqual(passos, []);
    }
});

test("sem a confirmação digitada: 400 e nada acontece", async () => {
    const { pedir, passos } = cenario();
    const resposta = await pedir({ confirmacao: "sim" });

    assert.equal(resposta.status, 400);
    assert.equal((await resposta.json()).erro, "Digite EXCLUIR para confirmar.");
    assert.deepEqual(passos, []);
});

test("pedido em andamento (regra do banco): 409 com a mensagem; o login fica", async () => {
    const passos = [];
    const { pedir } = cenario({
        anonimizar: async () => { throw new ErroDeRegra("Conclua ou cancele os pedidos em andamento antes de excluir a conta: #12."); },
        apagarLogin: async () => { passos.push("apagou"); }
    });

    const resposta = await pedir({ confirmacao: "EXCLUIR" });
    assert.equal(resposta.status, 409);
    assert.match((await resposta.json()).erro, /#12/);
    assert.deepEqual(passos, []);
});

test("falhas técnicas: 500 com mensagem genérica (detalhe só no log)", async () => {
    const original = console.error;
    console.error = () => {};
    try {
        const banco = cenario({ anonimizar: async () => { throw new Error("connection refused 10.0.0.1"); } });
        const r1 = await banco.pedir({ confirmacao: "EXCLUIR" });
        assert.equal(r1.status, 500);
        assert.doesNotMatch(await r1.text(), /10\.0\.0\.1/);

        const auth = cenario({ apagarLogin: async () => { throw new Error("auth fora"); } });
        const r2 = await auth.pedir({ confirmacao: "EXCLUIR" });
        assert.equal(r2.status, 500);
        assert.match((await r2.json()).erro, /Tente de novo para concluir/);
    } finally {
        console.error = original;
    }
});

test("preflight CORS e método errado", async () => {
    const { passos } = cenario();
    const deps = { usuarioDoToken: async () => null, anonimizar: async () => {}, apagarLogin: async () => {} };
    assert.equal((await tratarExclusao(new Request(URL_FUNCAO, { method: "OPTIONS" }), deps)).status, 204);
    assert.equal((await tratarExclusao(new Request(URL_FUNCAO, { method: "GET" }), deps)).status, 405);
    assert.deepEqual(passos, []);
});
