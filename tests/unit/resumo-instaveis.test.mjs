// tests/e2e/resumo-instaveis.mjs: acha os testes instáveis no JSON do Playwright.

import { test } from "node:test";
import assert from "node:assert/strict";
import { testesInstaveis } from "../e2e/resumo-instaveis.mjs";

const resultado = (status, mensagem) => ({ status, error: mensagem ? { message: `\x1b[31m${mensagem}\x1b[39m\n  detalhe` } : undefined });

test("lista só os instáveis, com caminho do teste e o 1º erro (sem cores)", () => {
    const relatorio = {
        suites: [{
            title: "radar.spec.mjs", file: "radar.spec.mjs",
            specs: [{ title: "passa direto", file: "radar.spec.mjs", line: 3, tests: [{ status: "expected", results: [resultado("passed")] }] }],
            suites: [{
                title: "Radar",
                specs: [
                    { title: "às vezes falha", file: "radar.spec.mjs", line: 10,
                      tests: [{ status: "flaky", results: [resultado("failed", "Timeout 5000ms"), resultado("passed")] }] },
                    { title: "sempre falha", file: "radar.spec.mjs", line: 20,
                      tests: [{ status: "unexpected", results: [resultado("failed", "x"), resultado("failed", "x")] }] }
                ]
            }]
        }]
    };

    assert.deepEqual(testesInstaveis(relatorio), [
        { arquivo: "radar.spec.mjs", linha: 10, titulo: "Radar › às vezes falha", erro: "Timeout 5000ms" }
    ]);
});

test("relatório vazio: nada", () => {
    assert.deepEqual(testesInstaveis({}), []);
});
