// Gera frontend/types/banco.d.ts a partir das MIGRATIONS (não de um banco
// remoto): sobe o mesmo Postgres em memória dos testes, aplica tudo e lê o
// catálogo. Formato = o de `supabase gen types typescript`, então o
// SupabaseClient<Database> do supabase-js entende tabelas, views e RPCs.
//
//   npm run tipos            → regrava o arquivo
//   npm run tipos -- --checar → falha se o arquivo estiver desatualizado (CI)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { criarBanco } from "../tests/banco/banco.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = path.join(RAIZ, "frontend", "types", "banco.d.ts");

// Tipo Postgres → TypeScript (o mesmo mapeamento do gerador do Supabase)
function tipoTs(udt) {
    const base = udt.replace(/^_/, "");
    const escalar = {
        bool: "boolean",
        int2: "number", int4: "number", int8: "number", float4: "number", float8: "number", numeric: "number",
        json: "Json", jsonb: "Json",
        text: "string", varchar: "string", bpchar: "string", uuid: "string", date: "string",
        timestamp: "string", timestamptz: "string", time: "string", interval: "string"
    }[base] ?? "unknown";
    return udt.startsWith("_") ? `${escalar}[]` : escalar;
}

const chave = nome => (/^[a-z_][a-z0-9_]*$/.test(nome) ? nome : JSON.stringify(nome));

async function gerar() {
    const db = await criarBanco();

    const colunas = (await db.query(`
        SELECT c.table_name, c.column_name, c.udt_name, c.is_nullable = 'YES' AS anulavel,
               (c.column_default IS NOT NULL OR c.is_identity = 'YES' OR c.is_generated = 'ALWAYS') AS tem_padrao,
               c.is_generated = 'ALWAYS' OR c.identity_generation = 'ALWAYS' AS gerada,
               t.table_type
          FROM information_schema.columns c
          JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public'
         ORDER BY c.table_name, c.ordinal_position`)).rows;

    const funcoes = (await db.query(`
        SELECT p.proname AS nome,
               COALESCE(p.proargnames, ARRAY[]::text[]) AS nomes,
               ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) AS t) AS tipos_args,
               p.pronargdefaults AS com_padrao,
               format_type(p.prorettype, NULL) AS retorno,
               p.proretset AS conjunto,
               (SELECT typtype FROM pg_type WHERE oid = p.prorettype) AS tipo_retorno
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prokind = 'f'
           AND format_type(p.prorettype, NULL) <> 'trigger'
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         ORDER BY p.proname`)).rows;

    const tabelas = new Map();
    for (const c of colunas) {
        if (!tabelas.has(c.table_name)) tabelas.set(c.table_name, { view: c.table_type === "VIEW", colunas: [] });
        tabelas.get(c.table_name).colunas.push(c);
    }

    const pgParaTs = formato => tipoTs({
        "integer": "int4", "bigint": "int8", "smallint": "int2", "numeric": "numeric", "boolean": "bool",
        "text": "text", "character varying": "varchar", "character": "bpchar", "uuid": "uuid", "jsonb": "jsonb", "json": "json",
        "timestamp with time zone": "timestamptz", "date": "date", "text[]": "_text", "void": "void"
    }[formato] ?? formato);

    const linhas = [];
    const escrever = (nivel, texto) => linhas.push(`${"    ".repeat(nivel)}${texto}`);

    linhas.push("// GERADO por scripts/gerar-tipos.mjs a partir de supabase/migrations.");
    linhas.push("// Não edite à mão: rode `npm run tipos` depois de criar uma migration.");
    linhas.push("");
    linhas.push("export type Json = string | number | boolean | null | { [chave: string]: Json | undefined } | Json[];");
    linhas.push("");
    linhas.push("export interface Database {");
    escrever(1, "public: {");

    for (const [secao, filtro] of [["Tables", t => !t.view], ["Views", t => t.view]]) {
        escrever(2, `${secao}: {`);
        for (const [nome, tabela] of tabelas) {
            if (!filtro(tabela)) continue;
            escrever(3, `${chave(nome)}: {`);

            escrever(4, "Row: {");
            for (const c of tabela.colunas) escrever(5, `${chave(c.column_name)}: ${tipoTs(c.udt_name)}${c.anulavel ? " | null" : ""};`);
            escrever(4, "};");

            if (!tabela.view) {
                escrever(4, "Insert: {");
                for (const c of tabela.colunas) {
                    if (c.gerada) continue;
                    const opcional = c.anulavel || c.tem_padrao;
                    escrever(5, `${chave(c.column_name)}${opcional ? "?" : ""}: ${tipoTs(c.udt_name)}${c.anulavel ? " | null" : ""};`);
                }
                escrever(4, "};");
                escrever(4, "Update: {");
                for (const c of tabela.colunas) {
                    if (c.gerada) continue;
                    escrever(5, `${chave(c.column_name)}?: ${tipoTs(c.udt_name)}${c.anulavel ? " | null" : ""};`);
                }
                escrever(4, "};");
            }
            escrever(4, "Relationships: [];");
            escrever(3, "};");
        }
        escrever(2, "};");
    }

    escrever(2, "Functions: {");
    const porNome = new Map();
    for (const f of funcoes) if (!porNome.has(f.nome)) porNome.set(f.nome, f);
    for (const [nome, f] of porNome) {
        escrever(3, `${chave(nome)}: {`);
        const obrigatorios = f.tipos_args.length - f.com_padrao;
        const args = f.tipos_args.map((tipo, i) => `${chave(f.nomes[i] || `arg${i}`)}${i >= obrigatorios ? "?" : ""}: ${pgParaTs(tipo)}`);
        escrever(4, `Args: ${args.length ? `{ ${args.join("; ")} }` : "Record<PropertyKey, never>"};`);

        let retorno;
        if (f.tipo_retorno === "c") {
            const tabela = tabelas.get(f.retorno.replace(/^public\./, ""));
            retorno = tabela ? `Database["public"]["Tables"][${JSON.stringify(f.retorno.replace(/^public\./, ""))}]["Row"]` : "Json";
        } else {
            retorno = f.retorno === "record" ? "Json" : pgParaTs(f.retorno) === "unknown" ? "Json" : pgParaTs(f.retorno);
        }
        escrever(4, `Returns: ${retorno}${f.conjunto ? "[]" : ""};`);
        escrever(3, "};");
    }
    escrever(2, "};");
    escrever(2, "Enums: Record<string, never>;");
    escrever(2, "CompositeTypes: Record<string, never>;");
    escrever(1, "};");
    linhas.push("}");
    linhas.push("");

    await db.close();
    return linhas.join("\n");
}

const conteudo = await gerar();

if (process.argv.includes("--checar")) {
    const atual = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, "utf8").replace(/\r\n/g, "\n") : "";
    if (atual !== conteudo) {
        console.error("frontend/types/banco.d.ts está desatualizado. Rode: npm run tipos");
        process.exit(1);
    }
    console.log("Tipos do banco em dia.");
} else {
    fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
    fs.writeFileSync(DESTINO, conteudo);
    console.log(`Gerado ${path.relative(RAIZ, DESTINO)}`);
}
