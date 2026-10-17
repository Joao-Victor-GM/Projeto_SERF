// Banco de teste: PostgreSQL real (PGlite, em memória) com as migrations
// de supabase/migrations aplicadas em ordem, sobre um "Supabase mínimo":
// papéis anon/authenticated, schema auth com users e auth.uid(), e a
// publicação do Realtime. Nada aqui acessa o Supabase de verdade.

import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PASTA_MIGRATIONS = path.join(RAIZ, "supabase", "migrations");

const SUPABASE_MINIMO = `
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;

    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
        id UUID PRIMARY KEY,
        email TEXT,
        raw_user_meta_data JSONB
    );
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
        $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    GRANT USAGE ON SCHEMA public TO anon, authenticated;

    -- Privilégios padrão de um projeto Supabase
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;

    CREATE PUBLICATION supabase_realtime;
`;

export function listarMigrations() {
    return fs.readdirSync(PASTA_MIGRATIONS).filter(f => f.endsWith(".sql")).sort();
}

export function lerMigration(nome) {
    return fs.readFileSync(path.join(PASTA_MIGRATIONS, nome), "utf8");
}

// antesDe(nome, db): gancho para simular o banco real antes de uma migration
export async function criarBanco({ antesDe } = {}) {
    const db = new PGlite();
    await db.exec(SUPABASE_MINIMO);

    for (const nome of listarMigrations()) {
        if (antesDe) await antesDe(nome, db);

        try {
            await db.exec(lerMigration(nome));
        } catch (erro) {
            throw new Error(`Falha ao aplicar ${nome}: ${erro.message}`);
        }
    }

    return db;
}

/* ----------------------------------------------------------
   Empresas de teste
   ---------------------------------------------------------- */

let sequencia = 0;

function novoUuid() {
    sequencia += 1;
    return `00000000-0000-0000-0000-${String(sequencia).padStart(12, "0")}`;
}

function novoCnpj() {
    return String(10000000000000 + sequencia * 1111).slice(0, 14);
}

// Executa SQL como um usuário logado (papel authenticated + auth.uid()).
export async function como(db, empresa, sql, parametros = []) {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [empresa.uid]);
    await db.exec("SET ROLE authenticated");

    try {
        return (await db.query(sql, parametros)).rows;
    } finally {
        await db.exec("RESET ROLE");
    }
}

// Igual a como(), mas devolve a mensagem de erro (ou null se não falhou).
export async function erroDe(db, empresa, sql, parametros = []) {
    try {
        await como(db, empresa, sql, parametros);
        return null;
    } catch (erro) {
        return erro.message;
    }
}

// Cadastra (signUp + segmentação) uma empresa com o perfil indicado.
export async function criarEmpresa(db, perfil, nome = `Empresa ${perfil} ${sequencia + 1}`) {
    const uid = novoUuid();
    const cnpj = novoCnpj();

    await db.query(
        "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)",
        [uid, `${uid}@teste.com`, JSON.stringify({ cnpj, razao_social: nome })]
    );

    const empresa = { uid, cnpj, nome };

    await como(db, empresa, "SELECT public.atualizar_segmentacao_usuario($1, 'Alimentos')", [perfil]);

    const [ids] = await como(db, empresa,
        "SELECT public.meu_id_usuario() AS id_usuario, public.meu_id_fornecedor() AS id_fornecedor");

    return { ...empresa, idUsuario: ids.id_usuario, idFornecedor: ids.id_fornecedor };
}

export async function criarProduto(db, fornecedor, dados = {}) {
    const p = { nome: "Arroz 5kg", preco: 10, minimo: 1, estoque: 100, ...dados };

    const [linha] = await como(db, fornecedor, `
        INSERT INTO public.produtos (id_fornecedor, nome_produto, preco_atacado, quantidade_minima, quantidade_estoque, categoria)
        VALUES ($1, $2, $3, $4, $5, 'Grãos')
        RETURNING id_produto`,
        [fornecedor.idFornecedor, p.nome, p.preco, p.minimo, p.estoque]);

    return linha.id_produto;
}

export async function criarPedido(db, comprador, idProduto, quantidade = 10) {
    const [linha] = await como(db, comprador, `
        INSERT INTO public.pedidos (id_usuario, id_produto, quantidade, valor_unitario)
        VALUES ($1, $2, $3, 1)
        RETURNING id_pedido`,
        [comprador.idUsuario, idProduto, quantidade]);

    return linha.id_pedido;
}

export async function mudarStatus(db, fornecedor, idPedido, status) {
    return como(db, fornecedor,
        "UPDATE public.pedidos SET status_pedido = $2 WHERE id_pedido = $1 RETURNING status_pedido",
        [idPedido, status]);
}

// Leitura sem RLS (superusuário), para conferir o estado real do banco.
export async function lerComoAdmin(db, sql, parametros = []) {
    await db.exec("RESET ROLE");
    return (await db.query(sql, parametros)).rows;
}
