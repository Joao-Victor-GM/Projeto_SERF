// Tradução de erros técnicos para o usuário (utils.js → mensagemDeErro).

import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarScripts } from "./carregar-script.mjs";

const janela = carregarScripts(["utils.js"], { obterSupabase: () => null });
const mensagem = janela.SERFUtils.mensagemDeErro;

test("RLS e permissão viram frase sem jargão técnico", () => {
    const rls = mensagem({ code: "42501", message: 'new row violates row-level security policy for table "produtos"' });
    assert.match(rls, /não tem permissão/);
    assert.doesNotMatch(rls, /row-level|policy|produtos/);

    assert.match(mensagem({ message: "permission denied for table pedidos" }), /não tem permissão/);
});

test("regra de negócio do banco (P0001) passa direto: já é escrita para o usuário", () => {
    assert.equal(mensagem({ code: "P0001", message: "Estoque insuficiente: 4 unidades disponíveis." }),
        "Estoque insuficiente: 4 unidades disponíveis.");
});

test("rede, sessão e restrições comuns", () => {
    assert.match(mensagem(new TypeError("Failed to fetch")), /Sem conexão/);
    assert.match(mensagem({ message: "JWT expired", code: "PGRST301" }), /sessão expirou/);
    assert.equal(mensagem({ code: "23505", message: "duplicate key value violates unique constraint" }), "Esse registro já existe.");
    assert.match(mensagem({ code: "23514", message: 'violates check constraint "ck_produtos_preco"' }), /fora do permitido/);
    assert.match(mensagem({ code: "PGRST205", message: "Could not find the table 'public.alertas' in the schema cache" }), /ainda não está disponível/);
});

test("validação do próprio front-end (new Error) mantém o texto", () => {
    assert.equal(mensagem(new Error("Faça login para enviar mensagens.")), "Faça login para enviar mensagens.");
});

test("erro desconhecido não vaza detalhes", () => {
    const generico = mensagem({ code: "XX000", message: "internal error at relation 0x7f..." });
    assert.match(generico, /Não foi possível concluir/);
    assert.match(mensagem(null), /Não foi possível concluir/);
    assert.match(mensagem(new TypeError("Cannot read properties of undefined")), /Não foi possível concluir/);
});
