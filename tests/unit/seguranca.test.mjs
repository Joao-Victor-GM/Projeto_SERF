// Verificações estáticas de segurança do front-end (sem navegador):
// CSP igual em todas as páginas e no _headers, cabeçalhos obrigatórios,
// scripts de CDN com integridade (SRI) e nada de script inline.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend");
// Só as páginas versionadas (o que vai para o ar), não cópias soltas na pasta
const paginas = execSync("git ls-files -- pages", { cwd: FRONT, encoding: "utf8" })
    .split(/\r?\n/).filter(f => f.endsWith(".html"));
const ler = arquivo => fs.readFileSync(path.join(FRONT, arquivo), "utf8");

const cspDaMeta = html => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
const cabecalhos = ler("_headers");
const cspDoHost = /^\s+Content-Security-Policy: (.+)$/m.exec(cabecalhos)[1];

test("toda página tem a MESMA CSP em <meta>, e o _headers é ela + o que a meta não suporta", () => {
    const politicas = new Set(paginas.map(p => cspDaMeta(ler(p))));
    assert.equal(politicas.has(undefined), false, "página sem CSP");
    assert.equal(politicas.size, 1, "páginas com CSP diferentes");

    const [meta] = politicas;
    assert.equal(cspDoHost, `${meta}; frame-ancestors 'none'; upgrade-insecure-requests`);
});

test("CSP rígida: script só do site e dos CDNs fixados; sem eval nem inline", () => {
    const script = /script-src ([^;]+)/.exec(cspDoHost)[1];
    assert.equal(script, "'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com");
    assert.doesNotMatch(cspDoHost, /'unsafe-eval'/);
    assert.match(cspDoHost, /object-src 'none'/);
    assert.match(cspDoHost, /base-uri 'self'/);
});

test("cabeçalhos obrigatórios no _headers", () => {
    for (const cabecalho of ["Strict-Transport-Security: max-age=31536000", "X-Content-Type-Options: nosniff",
        "X-Frame-Options: DENY", "Referrer-Policy:", "Permissions-Policy:"]) {
        assert.ok(cabecalhos.includes(cabecalho), cabecalho);
    }
});

test("nenhum script inline nem handler on*= no HTML", () => {
    for (const pagina of paginas) {
        const html = ler(pagina);
        assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${pagina}: <script> inline`);
        assert.doesNotMatch(html, /\son[a-z]+="/, `${pagina}: handler inline`);
    }
});

test("todo script de CDN tem integridade (SRI) e versão fixa", () => {
    for (const pagina of paginas) {
        for (const [tag] of ler(pagina).matchAll(/<script src="https:\/\/[^"]+"[^>]*>/g)) {
            assert.match(tag, /integrity="sha384-[A-Za-z0-9+/=]{64}"/, `${pagina}: ${tag}`);
            assert.match(tag, /crossorigin="anonymous"/, `${pagina}: ${tag}`);
            assert.match(tag, /@\d+\.\d+\.\d+\/|\/\d+\.\d+\.\d+\//, `${pagina}: versão não fixada`);
        }
    }
});

test("CSP sem estilo inline: style-src não tem 'unsafe-inline'", () => {
    const estilo = /style-src ([^;]+)/.exec(cspDoHost)[1];
    assert.doesNotMatch(estilo, /'unsafe-inline'/);
});

test("nenhum atributo style= nas páginas nem no HTML montado pelo JS (use classe ou data-css)", () => {
    // Inclui arquivos novos ainda não versionados (mas não os ignorados)
    const arquivos = execSync("git ls-files --cached --others --exclude-standard -- pages js", { cwd: FRONT, encoding: "utf8" })
        .split(/\r?\n/).filter(f => /\.(html|js)$/.test(f) && fs.existsSync(path.join(FRONT, f)));
    for (const arquivo of arquivos) {
        assert.doesNotMatch(ler(arquivo), /(?<![\w-])style=["']/, `${arquivo}: atributo style (bloqueado pela CSP)`);
        assert.doesNotMatch(ler(arquivo), /setAttribute\(\s*["']style["']/, `${arquivo}: setAttribute("style") é bloqueado pela CSP`);
    }
});

test("todo CSS de CDN tem integridade (SRI) e versão fixa", () => {
    for (const pagina of paginas) {
        for (const [tag] of ler(pagina).matchAll(/<link rel="stylesheet" href="https:\/\/cdn[^"]+"[^>]*>/g)) {
            assert.match(tag, /integrity="sha384-[A-Za-z0-9+/=]{64}"/, `${pagina}: ${tag}`);
            assert.match(tag, /@\d+\.\d+\.\d+\//, `${pagina}: versão não fixada`);
        }
    }
});

test("links que abrem outra aba usam rel=noopener", () => {
    const fontes = [...paginas.map(ler), ...fs.readdirSync(path.join(FRONT, "js"), { recursive: true })
        .filter(f => String(f).endsWith(".js")).map(f => ler(path.join("js", String(f))))];
    for (const fonte of fontes) {
        for (const [link] of fonte.matchAll(/<a [^>]*target="_blank"[^>]*>/g)) assert.match(link, /rel="noopener/, link);
    }
});
