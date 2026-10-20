import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "tests/e2e",
    timeout: 30000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
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
