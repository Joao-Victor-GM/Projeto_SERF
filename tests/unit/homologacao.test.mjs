// Regras da homologação por CNPJ (supabase/functions/homologar-fornecedor/regras.ts).
// O Node 22.18+ executa .ts removendo os tipos: o mesmo arquivo roda no Deno.

import { test } from "node:test";
import assert from "node:assert/strict";
import { avaliarCnpj, normalizarNome, normalizarCnpj, statusDoComprador }
    from "../../supabase/functions/homologar-fornecedor/regras.ts";

const ATIVA = (razao_social) => ({ razao_social, descricao_situacao_cadastral: "ATIVA" });

test("CNPJ ativo e mesma razão social: aprovado", () => {
    assert.equal(avaliarCnpj("Distribuidora Sul Ltda", ATIVA("DISTRIBUIDORA SUL LTDA")).status, "APROVADO");
});

test("acentos, pontuação e sufixo societário não impedem a conferência", () => {
    assert.equal(avaliarCnpj("Laticínios Serra S.A.", ATIVA("LATICINIOS SERRA SA")).status, "APROVADO");
    assert.equal(avaliarCnpj("Comércio & Cia - ME", ATIVA("COMERCIO")).status, "APROVADO");
    assert.equal(normalizarNome("  Ind.  Ltda  Pães "), "IND PAES");
});

test("CNPJ ativo com nome diferente: pendente (análise manual), explicando a diferença", () => {
    const resultado = avaliarCnpj("Mercado Bom Preço", ATIVA("SUPERMERCADOS XYZ LTDA"));
    assert.equal(resultado.status, "PENDENTE");
    assert.match(resultado.motivo, /Mercado Bom Preço/);
    assert.match(resultado.motivo, /SUPERMERCADOS XYZ/);
});

test("CNPJ baixado, inapto ou inexistente: reprovado", () => {
    const baixada = avaliarCnpj("Empresa X", { razao_social: "EMPRESA X", descricao_situacao_cadastral: "BAIXADA" });
    assert.equal(baixada.status, "REPROVADO");
    assert.match(baixada.motivo, /baixada/);

    assert.equal(avaliarCnpj("Empresa X", null).status, "REPROVADO");
    assert.match(avaliarCnpj("Empresa X", null).motivo, /não encontrado/);
});

test("utilitários", () => {
    assert.equal(normalizarCnpj("12.345.678/0001-90"), "12345678000190");
    assert.equal(statusDoComprador("APROVADO"), "APROVADA");
    assert.equal(statusDoComprador("PENDENTE"), "PENDENTE_VALIDACAO");
});
