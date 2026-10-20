// Exclusão de conta (LGPD, art. 18, VI): regras sem rede, testadas em
// tests/unit/excluir-conta.test.mjs. A rede fica em index.ts.
//
// 1. Quem pede é o próprio usuário (JWT da sessão, conferido no Auth).
// 2. Confirmação digitada ("EXCLUIR"): nada é apagado por um clique só.
// 3. anonimizar_conta (migration 025): recusa se houver pedido em
//    andamento; senão apaga os dados pessoais e corta o vínculo.
// 4. Apaga o login. Se falhar aqui, a conta já está anonimizada e sem
//    vínculo: repetir o pedido termina o serviço (idempotente).

export const CONFIRMACAO = "EXCLUIR";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export const json = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Erro de regra do banco (P0001): a mensagem é para o usuário
export class ErroDeRegra extends Error {}

export interface Dependencias {
    usuarioDoToken: (token: string) => Promise<{ id: string } | null>;
    anonimizar: (uid: string) => Promise<void>;
    apagarLogin: (uid: string) => Promise<void>;
}

export async function tratarExclusao(req: Request, deps: Dependencias): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json(405, { erro: "Método não permitido." });

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const usuario = token ? await deps.usuarioDoToken(token) : null;
    if (!usuario) return json(401, { erro: "Sessão expirada. Faça login novamente." });

    const corpo = await req.json().catch(() => ({}));
    if (String(corpo?.confirmacao || "").trim().toUpperCase() !== CONFIRMACAO) {
        return json(400, { erro: `Digite ${CONFIRMACAO} para confirmar.` });
    }

    try {
        await deps.anonimizar(usuario.id);
    } catch (erro) {
        if (erro instanceof ErroDeRegra) return json(409, { erro: erro.message });
        console.error("[excluir-conta] anonimizar:", erro);
        return json(500, { erro: "Não foi possível excluir a conta agora. Tente novamente." });
    }

    try {
        await deps.apagarLogin(usuario.id);
    } catch (erro) {
        console.error("[excluir-conta] apagar login:", erro);
        return json(500, { erro: "Seus dados foram removidos, mas o login não. Tente de novo para concluir." });
    }

    return json(200, { ok: true });
}
