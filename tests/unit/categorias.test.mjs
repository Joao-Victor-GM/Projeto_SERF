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
