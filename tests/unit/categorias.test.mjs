// Uma lista só de segmentos: SERFUtils.CATEGORIAS_PRODUTO é a fonte; os
// <select id="prodCategoria"> do HTML precisam ter exatamente as mesmas
// opções, senão o filtro do Radar e o cadastro de produto divergem.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { carregarScripts, simples } from "./carregar-script.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const { SERFUtils } = carregarScripts(["utils.js"], { obterSupabase: () => ({}) });
const CATEGORIAS = simples(SERFUtils.CATEGORIAS_PRODUTO);

function opcoesDoSelect(pagina) {
    const html = fs.readFileSync(path.join(RAIZ, "frontend/pages/app", pagina), "utf8");
    const select = /<select id="prodCategoria"[^>]*>([\s\S]*?)<\/select>/.exec(html);
    assert.ok(select, `${pagina}: #prodCategoria não encontrado`);
    return [...select[1].matchAll(/<option value="([^"]+)">/g)].map(m => m[1]);
}

test("lista central de segmentos (imutável, sem repetição)", () => {
    assert.ok(CATEGORIAS.includes("Alimentos & Bebidas"));
    assert.ok(CATEGORIAS.includes("Metalurgia & Usinagem"));
    assert.equal(new Set(CATEGORIAS).size, CATEGORIAS.length);
    assert.ok(Object.isFrozen(SERFUtils.CATEGORIAS_PRODUTO));
});

for (const pagina of ["home.html", "catalogo.html"]) {
    test(`${pagina}: o cadastro de produto oferece exatamente os segmentos do radar`, () => {
        assert.deepEqual(opcoesDoSelect(pagina), CATEGORIAS);
    });
}

test("segmentacao.html e perfil.html oferecem todos os segmentos da lista oficial (CNAE 2.0 + Outros)", () => {
    const segHtml = fs.readFileSync(path.join(RAIZ, "frontend/pages/public/segmentacao.html"), "utf8");
    const nichosOnboarding = [...segHtml.matchAll(/data-nicho="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(nichosOnboarding, CATEGORIAS);

    const perfilHtml = fs.readFileSync(path.join(RAIZ, "frontend/pages/app/perfil.html"), "utf8");
    const selectPerfil = /<select id="cadNicho"[^>]*>([\s\S]*?)<\/select>/.exec(perfilHtml);
    assert.ok(selectPerfil, "perfil.html: #cadNicho não encontrado");
    const nichosPerfil = [...selectPerfil[1].matchAll(/<option value="([^"]+)">/g)].map(m => m[1]);
    assert.deepEqual(nichosPerfil, CATEGORIAS);
});

test("sugerirNichoPorCnae mapeia divisões CNAE 2.0 para os setores oficiais ou Outros", () => {
    const sugerir = (...args) => simples(SERFUtils.sugerirNichoPorCnae(...args));
    assert.deepEqual(sugerir(2599399), { nicho: "Metalurgia & Usinagem", outroTexto: "" });
    assert.deepEqual(sugerir("22.29-3-01", "Artefatos plásticos"), { nicho: "Química & Plásticos", outroTexto: "" });
    assert.deepEqual(sugerir("22.22-6-00", "Embalagens de material plástico"), { nicho: "Embalagens & Logística", outroTexto: "" });
    assert.deepEqual(sugerir("20.62-2-00", "Produtos de limpeza"), { nicho: "Saúde & Higiene Profissional", outroTexto: "" });
    assert.deepEqual(sugerir("27.10-4-01"), { nicho: "Elétrica & Automação", outroTexto: "" });
    assert.deepEqual(sugerir("93.13-1-00", "Atividades de condicionamento físico"), {
        nicho: "Outros",
        outroTexto: "Atividades de condicionamento físico"
    });
    assert.equal(sugerir(""), null);
});

test("rastro do radar (oportunidades.css) decai atrás do giro horário (transparent no início até brilho em 360deg)", () => {
    const css = fs.readFileSync(path.join(RAIZ, "frontend/css/oportunidades.css"), "utf8");
    const bloco = /\.rop-varredura\s*\{([\s\S]*?)\}/.exec(css);
    assert.ok(bloco, ".rop-varredura não encontrada");
    assert.match(bloco[1], /transparent\s+0deg/);
    assert.match(bloco[1], /360deg/);
});
