// Lista os testes INSTÁVEIS (falharam e passaram na nova tentativa) da
// última execução do Playwright na CI. Sem isto, um teste instável deixa o
// job verde e ninguém vê.
//
// Uso (CI): node tests/e2e/resumo-instaveis.mjs playwright-report/resultados.json
//   - escreve uma tabela no resumo do job ($GITHUB_STEP_SUMMARY);
//   - cria um aviso (::warning) por teste, que aparece no PR;
//   - sai com código 0: instabilidade é aviso, não reprova o PR.

import fs from "node:fs";

export function testesInstaveis(relatorio) {
    const encontrados = [];

    function percorrer(suite, titulos) {
        const caminho = suite.title ? [...titulos, suite.title] : titulos;

        for (const especificacao of suite.specs || []) {
            for (const teste of especificacao.tests || []) {
                if (teste.status !== "flaky") continue;
                const falha = teste.results.find(r => r.status !== "passed");
                encontrados.push({
                    arquivo: especificacao.file,
                    linha: especificacao.line,
                    titulo: [...caminho.slice(1), especificacao.title].join(" › "),
                    erro: (falha?.error?.message || "").split("\n")[0].replace(/\x1b\[[0-9;]*m/g, "").slice(0, 200)
                });
            }
        }

        for (const filha of suite.suites || []) percorrer(filha, caminho);
    }

    for (const suite of relatorio.suites || []) percorrer(suite, []);
    return encontrados;
}

function principal(arquivo) {
    if (!fs.existsSync(arquivo)) {
        console.log(`Sem relatório em ${arquivo}.`);
        return;
    }

    const instaveis = testesInstaveis(JSON.parse(fs.readFileSync(arquivo, "utf8")));

    if (instaveis.length === 0) {
        console.log("Nenhum teste instável.");
        return;
    }

    const escapar = texto => texto.replace(/\|/g, "\\|");
    const tabela = [
        `### ⚠️ ${instaveis.length} teste(s) instável(is)`,
        "",
        "Falharam na 1ª tentativa e passaram na 2ª. O rastro (trace) está no artefato **playwright-report**.",
        "",
        "| Teste | Arquivo | 1º erro |",
        "|---|---|---|",
        ...instaveis.map(t => `| ${escapar(t.titulo)} | \`${t.arquivo}:${t.linha}\` | ${escapar(t.erro)} |`)
    ].join("\n");

    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${tabela}\n`);
    console.log(tabela);

    for (const t of instaveis) {
        console.log(`::warning file=tests/e2e/${t.arquivo},line=${t.linha},title=Teste instável::${t.titulo} — ${t.erro}`);
    }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
    principal(process.argv[2] || "playwright-report/resultados.json");
}
