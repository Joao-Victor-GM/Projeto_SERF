import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "tests/e2e",
    timeout: 30000,
    retries: process.env.CI ? 1 : 0,
    // CI: 1 nova tentativa; quem falha e depois passa é "instável" e vira
    // aviso no PR (tests/e2e/resumo-instaveis.mjs lê o resultados.json)
    reporter: process.env.CI
        ? [["github"], ["html", { open: "never" }], ["json", { outputFile: "playwright-report/resultados.json" }]]
        : "list",
    use: {
        baseURL: "http://localhost:4173",
        trace: "retain-on-failure",
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo"
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
        command: "node tests/e2e/servidor.mjs",
        url: "http://localhost:4173/pages/public/",
        reuseExistingServer: !process.env.CI
    }
});
