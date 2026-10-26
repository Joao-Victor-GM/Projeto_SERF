// Monitoramento de erros do navegador (migration 032).

import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, lerComoAdmin } from "./banco.mjs";

const RELATAR = "INSERT INTO erros_navegador (pagina, mensagem, origem) VALUES ($1, $2, 'catalogo.js:10')";
const linhas = db => lerComoAdmin(db, "SELECT auth_user_id, pagina, mensagem, quantidade FROM erros_navegador ORDER BY id");

test("a empresa registra um erro em nome próprio; o mesmo erro só soma", async () => {
    const db = await criarBanco();
    const empresa = await criarEmpresa(db, "Comprador");

    for (let i = 0; i < 3; i++) await como(db, empresa, RELATAR, ["/pages/app/catalogo.html", "TypeError: x is undefined"]);
    await como(db, empresa, RELATAR, ["/pages/app/home.html", "TypeError: x is undefined"]);

    assert.deepEqual(await linhas(db), [
        { auth_user_id: empresa.uid, pagina: "/pages/app/catalogo.html", mensagem: "TypeError: x is undefined", quantidade: 3 },
        { auth_user_id: empresa.uid, pagina: "/pages/app/home.html", mensagem: "TypeError: x is undefined", quantidade: 1 }
    ]);
});

test("ninguém lê os erros pela API, nem o resumo", async () => {
    const db = await criarBanco();
    const empresa = await criarEmpresa(db, "Comprador");
    await como(db, empresa, RELATAR, ["/pages/app/home.html", "Erro"]);

    assert.match(await erroDe(db, empresa, "SELECT * FROM erros_navegador"), /permission denied|permissão negada/i);
    assert.match(await erroDe(db, empresa, "SELECT * FROM erros_resumo"), /permission denied|permissão negada/i);
});

test("não dá para relatar em nome de outra empresa nem mexer no contador", async () => {
    const db = await criarBanco();
    const empresa = await criarEmpresa(db, "Comprador");
    const outra = await criarEmpresa(db, "Comprador");

    assert.match(await erroDe(db, empresa,
        "INSERT INTO erros_navegador (auth_user_id, pagina, mensagem) VALUES ($1, '/pages/app/home.html', 'falso')", [outra.uid]),
        /permission denied|permissão negada/i);
    assert.match(await erroDe(db, empresa,
        "INSERT INTO erros_navegador (pagina, mensagem, quantidade) VALUES ('/pages/app/home.html', 'x', 999)"),
        /permission denied|permissão negada/i);
});

test("página só como caminho do site (sem domínio nem ?token=)", async () => {
    const db = await criarBanco();
    const empresa = await criarEmpresa(db, "Comprador");

    for (const pagina of ["/pages/public/descadastro.html?t=segredo", "https://outro.site/x", "javascript:alert(1)"]) {
        assert.match(await erroDe(db, empresa, RELATAR, [pagina, "Erro"]), /ck_erros_navegador_pagina/);
    }
});

test("no máximo 30 erros diferentes por usuário por hora (o resto é descartado sem erro)", async () => {
    const db = await criarBanco();
    const empresa = await criarEmpresa(db, "Comprador");
    for (let i = 0; i < 35; i++) await como(db, empresa, RELATAR, ["/pages/app/home.html", `Erro ${i}`]);

    assert.equal((await linhas(db)).length, 30);
});

test("erros com mais de 30 dias são apagados", async () => {
    const db = await criarBanco();
    const empresa = await criarEmpresa(db, "Comprador");
    await como(db, empresa, RELATAR, ["/pages/app/home.html", "Antigo"]);
    await lerComoAdmin(db, "UPDATE erros_navegador SET criado_em = NOW() - INTERVAL '31 days', ultimo_em = NOW() - INTERVAL '31 days'");

    await como(db, empresa, RELATAR, ["/pages/app/home.html", "Novo"]);
    assert.deepEqual((await linhas(db)).map(l => l.mensagem), ["Novo"]);
});
