// Carrega a camada de dados do front-end (js/utils.js, js/pedidos.js e
// js/dados/*.js) no Node, ligada a um cliente Supabase qualquer. Assim os
// testes rodam as MESMAS consultas que o site faz, sem copiar strings.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/js");

// Ordem das páginas: base antes dos repositórios
const ARQUIVOS = [
    "utils.js",
    "pedidos.js",
    "dados/base.js",
    ...fs.readdirSync(path.join(JS, "dados")).filter(f => f.endsWith(".repositorio.js")).sort().map(f => `dados/${f}`)
];

export function carregarDados(cliente) {
    const janela = { obterSupabase: () => cliente, console };
    janela.window = janela;
    const contexto = vm.createContext(janela);

    for (const arquivo of ARQUIVOS) {
        vm.runInContext(fs.readFileSync(path.join(JS, arquivo), "utf8"), contexto, { filename: arquivo });
    }
    return { dados: janela.SERFDados, pedidos: janela.SERFPedidos, utils: janela.SERFUtils };
}

export { ARQUIVOS };
