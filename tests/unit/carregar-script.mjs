// Executa um script clássico do front-end (sem módulos) num contexto isolado
// com um "window" mínimo, e devolve esse window.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const PASTA_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/js");

export function carregarScripts(nomes, janela = {}) {
    const contexto = vm.createContext({ window: janela, console, Intl, Date, Math, JSON, Promise });
    janela.window = janela;

    for (const nome of nomes) {
        vm.runInContext(fs.readFileSync(path.join(PASTA_JS, nome), "utf8"), contexto, { filename: nome });
    }

    return janela;
}

// Converte valores do contexto isolado (outro "realm") para comparação.
export const simples = valor => JSON.parse(JSON.stringify(valor));
