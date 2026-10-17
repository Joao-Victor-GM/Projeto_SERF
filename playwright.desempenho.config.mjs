// Benchmarks (npm run test:desempenho). Separado dos testes do CI porque
// mede tempo, que varia por máquina.
import base from "./playwright.config.mjs";

export default {
    ...base,
    testDir: "tests/desempenho",
    testMatch: "**/*.desempenho.mjs",
    retries: 0,
    workers: 1,
    reporter: "list"
};
