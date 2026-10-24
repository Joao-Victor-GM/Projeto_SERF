// Supabase falso para os testes de interface: nenhuma requisição chega ao
// projeto real. Intercepta Auth, PostgREST (REST/RPC) e Realtime (WebSocket).
//
// As tabelas são arrays de linhas já no formato que a API devolveria
// (incluindo os JOINs aninhados). O mock aplica apenas filtros "eq." de
// colunas de primeiro nível; select/order/limit são ignorados.

const URL_SUPABASE = "https://rparlqdgcwzoanpqqeof.supabase.co";
const CHAVE_SESSAO = "sb-rparlqdgcwzoanpqqeof-auth-token";

function base64url(objeto) {
    return Buffer.from(JSON.stringify(objeto)).toString("base64url");
}

function sessaoFalsa(usuario) {
    const expiraEm = Math.floor(Date.now() / 1000) + 3600;
    const token = [
        base64url({ alg: "HS256", typ: "JWT" }),
        base64url({ sub: usuario.id, email: usuario.email, role: "authenticated", exp: expiraEm }),
        "assinatura-falsa"
    ].join(".");

    return {
        access_token: token,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: expiraEm,
        refresh_token: "refresh-falso",
        user: {
            id: usuario.id,
            aud: "authenticated",
            role: "authenticated",
            email: usuario.email,
            user_metadata: usuario.metadados || {},
            app_metadata: {}
        }
    };
}

// Condição PostgREST "op.valor" (eq, gte, lte, in) sobre uma coluna.
// Operadores desconhecidos não filtram (null = ignorar).
function atende(linha, coluna, expressao) {
    const m = /^(eq|gte|lte|in|ilike)\.(.*)$/.exec(expressao);
    if (!m) return null;

    const [, operador, bruto] = m;
    const valor = bruto.replace(/^"(.*)"$/, "$1");
    const atual = linha[coluna];

    if (atual === undefined || atual === null) return false;
    if (operador === "ilike") {
        // % e * são curingas do LIKE no PostgREST; o resto é texto literal
        const padrao = valor.split(/[%*]/).map(parte => parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
        return new RegExp(`^${padrao}$`, "i").test(String(atual));
    }
    if (operador === "eq") return String(atual) === valor;
    if (operador === "gte") return String(atual) >= valor;
    if (operador === "lte") return String(atual) <= valor;
    // in.(a,"b, c") → itens podem vir entre aspas (valores com vírgula/parênteses)
    const itens = partesDoOr(bruto).map(item => item.replace(/^"(.*)"$/, "$1"));
    return itens.includes(String(atual));
}

// "or=(a.gte.x,b.in.(1,2))" → ["a.gte.x", "b.in.(1,2)"] (respeita parênteses)
function partesDoOr(texto) {
    const partes = [];
    let nivel = 0, atual = "";

    for (const c of texto.replace(/^\((.*)\)$/, "$1")) {
        if (c === "(") nivel += 1;
        if (c === ")") nivel -= 1;
        if (c === "," && nivel === 0) { partes.push(atual); atual = ""; continue; }
        atual += c;
    }

    return atual ? [...partes, atual] : partes;
}

function aplicarFiltros(linhas, parametros) {
    let resultado = linhas;

    for (const [coluna, valor] of parametros) {
        if (["select", "order", "limit", "offset", "and", "on_conflict", "columns"].includes(coluna)) continue;

        if (coluna === "or") {
            const condicoes = partesDoOr(valor).map(parte => {
                const ponto = parte.indexOf(".");
                return [parte.slice(0, ponto), parte.slice(ponto + 1)];
            });
            resultado = resultado.filter(linha =>
                condicoes.some(([c, expr]) => atende(linha, c, expr) !== false));
            continue;
        }

        resultado = resultado.filter(linha => atende(linha, coluna, valor) !== false);
    }

    return resultado;
}

// "order=col1.desc.nullslast,col2.asc" do PostgREST. Ordena a lista
// devolvida (os dados da tabela simulada não mudam). Nulos ao final.
function ordenar(linhas, parametros) {
    const ordem = parametros.filter(([chave]) => chave === "order").map(([, valor]) => valor).join(",");
    if (!ordem) return linhas;

    const criterios = ordem.split(",").filter(Boolean).map(parte => {
        const [coluna, ...opcoes] = parte.split(".");
        return { coluna, desc: opcoes.includes("desc") };
    });

    return [...linhas].sort((a, b) => {
        for (const { coluna, desc } of criterios) {
            const va = a[coluna], vb = b[coluna];
            if (va === vb) continue;
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            const comparacao = typeof va === "number" && typeof vb === "number"
                ? va - vb
                : String(va).localeCompare(String(vb), "pt-BR");
            if (comparacao !== 0) return desc ? -comparacao : comparacao;
        }
        return 0;
    });
}

// opcoes: { usuario: {id, email}, tabelas: {nome: linhas}, rpc: {nome: (args) => resposta},
//           falhas: {tabela: "mensagem"} (responde erro 400 nessa tabela) }
// Retorna { chamadas, errosDaPagina } para as asserções.
// funcoes: { nome: (corpo, tabelas) => resposta } — Edge Functions (/functions/v1/nome);
//          lançar um erro com .status responde com esse status e { erro: mensagem }
// login: { email, senha, usuario } → POST /auth/v1/token aceita só essa
// combinação (devolve a sessão de "usuario"); qualquer outra é recusada.
export async function simularSupabase(page, { usuario, tabelas = {}, rpc = {}, falhas = {}, funcoes = {}, login = null }) {
    const chamadas = [];
    const errosDaPagina = [];

    page.on("pageerror", erro => errosDaPagina.push(`pageerror: ${erro.message}`));
    page.on("console", mensagem => {
        if (mensagem.type() === "error") errosDaPagina.push(`console: ${mensagem.text()}`);
    });

    if (usuario) {
        const sessao = sessaoFalsa(usuario);
        await page.addInitScript(([chave, valor]) => {
            window.localStorage.setItem(chave, valor);
        }, [CHAVE_SESSAO, JSON.stringify(sessao)]);
    }

    // Realtime: aceita a conexão e não envia nada (os canais ficam sem eventos)
    await page.routeWebSocket(/supabase\.co\/realtime/, () => {});

    await page.route(`${URL_SUPABASE}/**`, async rota => {
        const requisicao = rota.request();
        const url = new URL(requisicao.url());
        const metodo = requisicao.method();
        const corpo = requisicao.postData() ? JSON.parse(requisicao.postData()) : null;

        if (metodo === "OPTIONS") {
            return rota.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
        }

        const responder = (status, dados) => rota.fulfill({
            status,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*", "content-range": "0-0/*" },
            body: dados === undefined ? "" : JSON.stringify(dados)
        });

        if (url.pathname.startsWith("/auth/v1/")) {
            chamadas.push({ tipo: "auth", caminho: url.pathname, metodo });
            if (url.pathname.endsWith("/logout")) return responder(204);
            if (url.pathname.endsWith("/token") && url.searchParams.get("grant_type") === "password") {
                const certo = login && corpo?.email === login.email && corpo?.password === login.senha;
                return certo
                    ? responder(200, sessaoFalsa(login.usuario))
                    : responder(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
            }
            return responder(200, usuario ? sessaoFalsa(usuario).user : {});
        }

        const funcaoMatch = /^\/functions\/v1\/([\w-]+)/.exec(url.pathname);
        if (funcaoMatch) {
            const nome = funcaoMatch[1];
            chamadas.push({ tipo: "funcao", nome, corpo });
            if (!funcoes[nome]) return responder(404, { erro: `Função ${nome} não simulada` });
            try {
                return responder(200, await funcoes[nome](corpo, tabelas));
            } catch (erro) {
                return responder(erro.status || 500, { erro: erro.message });
            }
        }

        const rpcMatch = /^\/rest\/v1\/rpc\/(\w+)/.exec(url.pathname);
        if (rpcMatch) {
            const nome = rpcMatch[1];
            chamadas.push({ tipo: "rpc", nome, corpo });

            if (!rpc[nome]) return responder(404, { message: `RPC ${nome} não simulada` });

            try {
                return responder(200, await rpc[nome](corpo, tabelas));
            } catch (erro) {
                return responder(400, { message: erro.message, code: erro.code || "P0001" });
            }
        }

        const tabelaMatch = /^\/rest\/v1\/(\w+)/.exec(url.pathname);
        if (tabelaMatch) {
            const tabela = tabelaMatch[1];
            const parametros = [...url.searchParams.entries()];
            const linhas = tabelas[tabela] || [];
            const filtradas = ordenar(aplicarFiltros(linhas, parametros), parametros);

            chamadas.push({ tipo: "rest", tabela, metodo, parametros, corpo });

            if (falhas[tabela]) return responder(400, { message: falhas[tabela], code: "42P01" });

            const querObjeto = (requisicao.headers()["accept"] || "").includes("vnd.pgrst.object");

            if (metodo === "GET" || metodo === "HEAD") {
                if (querObjeto) {
                    return filtradas.length === 1
                        ? responder(200, filtradas[0])
                        : responder(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
                }
                return responder(200, filtradas);
            }

            if (metodo === "POST") {
                const novas = (Array.isArray(corpo) ? corpo : [corpo]).map((linha, i) => ({ id: `novo-${Date.now()}-${i}`, ...linha }));
                tabelas[tabela] = [...linhas, ...novas];
                return responder(201, querObjeto ? novas[0] : novas);
            }

            if (metodo === "PATCH") {
                filtradas.forEach(linha => Object.assign(linha, corpo));
                return responder(200, querObjeto ? filtradas[0] ?? null : filtradas);
            }

            if (metodo === "DELETE") {
                tabelas[tabela] = linhas.filter(linha => !filtradas.includes(linha));
                return responder(200, filtradas);
            }
        }

        return responder(404, { message: "Rota do Supabase não simulada" });
    });

    return { chamadas, errosDaPagina };
}

// Erros de console que não indicam defeito do S.E.R.F.
export function errosRelevantes(erros) {
    return erros.filter(texto =>
        !/WebSocket|realtime|favicon|ERR_|net::|Failed to load resource/i.test(texto));
}
