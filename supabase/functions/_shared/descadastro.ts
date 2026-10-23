// Descadastro de e-mails em um clique (RFC 8058), sem login.
//
// O link leva um token assinado: "<auth_user_id>.<HMAC-SHA256>". Só quem tem o
// segredo DESCADASTRO_SECRET gera um token válido; o token só serve para
// DESLIGAR os e-mails daquele usuário (religar exige login, no Perfil).
//
// Usado por enviar-emails (gera o link) e por descadastrar (recebe o clique).
// Funções puras + Web Crypto: rodam no Deno e no Node (tests/unit/descadastro.test.mjs).

const codificador = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
    let binario = "";
    for (const b of new Uint8Array(bytes)) binario += String.fromCharCode(b);
    return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function assinatura(uid: string, segredo: string): Promise<string> {
    const chave = await crypto.subtle.importKey(
        "raw", codificador.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return base64url(await crypto.subtle.sign("HMAC", chave, codificador.encode(`descadastro:${uid}`)));
}

// Comparação em tempo constante (não revela quantos caracteres acertou)
function iguais(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diferenca = 0;
    for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diferenca === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function gerarToken(uid: string, segredo: string): Promise<string> {
    return `${uid}.${await assinatura(uid, segredo)}`;
}

// Devolve o auth_user_id do token, ou null se inválido/adulterado
export async function lerToken(token: unknown, segredo: string): Promise<string | null> {
    if (typeof token !== "string" || !segredo) return null;
    const [uid, assinado, ...resto] = token.split(".");
    if (resto.length || !uid || !assinado || !UUID.test(uid)) return null;
    return iguais(assinado, await assinatura(uid, segredo)) ? uid : null;
}

export function linksDeDescadastro(token: string, urlApp: string, urlSupabase: string) {
    const t = encodeURIComponent(token);
    return {
        // Página que pede confirmação (link no corpo do e-mail)
        pagina: `${urlApp.replace(/\/$/, "")}/pages/public/descadastro.html?t=${t}`,
        // POST direto (cabeçalho List-Unsubscribe: o Gmail/Yahoo chamam sozinhos)
        umClique: `${urlSupabase.replace(/\/$/, "")}/functions/v1/descadastrar?t=${t}`
    };
}

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const json = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

interface Opcoes {
    segredo: string;
    urlApp: string;
    desligar: (uid: string) => Promise<void>;
}

// GET  ?t=...  → leva à página de confirmação (pré-visualizações de link
//                não podem descadastrar ninguém sozinhas)
// POST ?t=...  → descadastra (one-click do provedor: corpo "List-Unsubscribe=One-Click")
// POST {t}     → descadastra (página de confirmação, via functions.invoke)
export async function tratarDescadastro(req: Request, { segredo, urlApp, desligar }: Opcoes): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    let token = url.searchParams.get("t");

    if (req.method === "GET") {
        if (!token) return json(400, { erro: "Link incompleto." });
        const destino = `${urlApp.replace(/\/$/, "")}/pages/public/descadastro.html?t=${encodeURIComponent(token)}`;
        return new Response(null, { status: 303, headers: { ...CORS, Location: destino } });
    }

    if (req.method !== "POST") return json(405, { erro: "Método não permitido." });

    if (!token && (req.headers.get("content-type") || "").includes("application/json")) {
        token = (await req.json().catch(() => ({})))?.t ?? null;
    }

    const uid = await lerToken(token, segredo);
    if (!uid) return json(400, { erro: "Link de descadastro inválido." });

    try {
        await desligar(uid);
    } catch (erro) {
        console.error("[descadastrar]", erro);
        return json(500, { erro: "Não foi possível concluir agora. Tente novamente." });
    }

    return json(200, { ok: true });
}
