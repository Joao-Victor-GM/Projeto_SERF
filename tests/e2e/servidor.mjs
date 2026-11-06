// Servidor estático do front-end para os testes (e para abrir localmente):
//   npm run servidor  →  http://localhost:4173/pages/public/

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend");
const PORTA = Number(process.env.PORTA || 4173);

const TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json"
};

http.createServer((req, res) => {
    const caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let arquivo = path.normalize(path.join(RAIZ, caminho));

    // Pasta → index.html, como qualquer hospedagem estática
    if (arquivo.startsWith(RAIZ) && fs.existsSync(arquivo) && fs.statSync(arquivo).isDirectory()) {
        arquivo = path.join(arquivo, "index.html");
    }

    if (!arquivo.startsWith(RAIZ) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
        res.writeHead(404).end("Não encontrado");
        return;
    }

    res.writeHead(200, {
        "Content-Type": TIPOS[path.extname(arquivo)] || "application/octet-stream",
        "Cache-Control": "no-cache"
    });
    fs.createReadStream(arquivo).pipe(res);
}).listen(PORTA, () => console.log(`S.E.R.F. em http://localhost:${PORTA}/pages/public/`));
