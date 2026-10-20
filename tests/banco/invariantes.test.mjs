// Invariantes de segurança (tests/banco/invariantes.sql) no banco em
// memória. A CI roda o MESMO arquivo no Postgres do Supabase de verdade.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { criarBanco, listarMigrations, lerMigration } from "./banco.mjs";

const SQL = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "invariantes.sql"), "utf8");

test("RLS em todas as tabelas, search_path fixo, funções só-servidor protegidas", async () => {
    const db = await criarBanco();
    await db.exec(SQL);
});

test("as verificações de fato reprovam um banco errado", async () => {
    const db = await criarBanco();

    await db.exec("CREATE TABLE public.sem_rls (id INT)");
    await assert.rejects(db.exec(SQL), /Tabelas sem RLS: sem_rls/);
    await db.exec("DROP TABLE public.sem_rls");

    await db.exec("CREATE FUNCTION public.perigosa() RETURNS INT LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'");
    await assert.rejects(db.exec(SQL), /sem search_path fixo: perigosa/);
    await db.exec("DROP FUNCTION public.perigosa()");

    await db.exec("GRANT EXECUTE ON FUNCTION public.anonimizar_conta(UUID) TO authenticated");
    await assert.rejects(db.exec(SQL), /executáveis pelo navegador: anonimizar_conta/);
});

// "Pode ser executado mais de uma vez": reaplicar tudo (menos a 001, a
// estrutura inicial) sobre um banco pronto não pode falhar. A CI faz o mesmo
// no Postgres do Supabase.
test("migrations 002 em diante são idempotentes", async () => {
    const db = await criarBanco();

    for (const nome of listarMigrations().filter(nome => !nome.startsWith("001_"))) {
        await assert.doesNotReject(db.exec(lerMigration(nome)), nome);
    }

    await db.exec(SQL);   // e continua seguro depois
});
