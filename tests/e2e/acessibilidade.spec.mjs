// Acessibilidade (WCAG 2.1 AA, verificada pelo axe-core) e layout no
// celular: nenhuma página pode ter violação nem rolagem horizontal.
// Pega regressões de contraste, rótulos, ARIA e foco antes do deploy.

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { simularSupabase } from "./supabase-falso.mjs";
import { EMPRESA, criarTabelas } from "./dados.mjs";

const PAGINAS = [
    "public/index.html",
    "public/login-cadastro.html",
    "public/segmentacao.html",
    "public/redefinir-senha.html",
    "app/home.html",
    "app/catalogo.html",
    "app/cotacoes.html",
    "app/empresas.html",
    "app/relatorios.html",
    "app/alertas.html",
    "app/perfil.html"
];

const TELAS = [["computador", 1366], ["celular", 390]];

for (const pagina of PAGINAS) {
    for (const [tela, largura] of TELAS) {
        test(`${pagina} (${tela})`, async ({ page }) => {
            const logada = pagina.startsWith("app/") || pagina.includes("segmentacao");
            await page.setViewportSize({ width: largura, height: 850 });
            await simularSupabase(page, { usuario: logada ? EMPRESA : null, tabelas: criarTabelas() });
            await page.goto(`/pages/${pagina}`);
            await page.waitForLoadState("networkidle");

            const { violations } = await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
                .analyze();
            const resumo = violations.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")}`);
            expect(resumo).toEqual([]);

            const rolagemHorizontal = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(rolagemHorizontal).toBeLessThanOrEqual(0);
        });
    }
}
