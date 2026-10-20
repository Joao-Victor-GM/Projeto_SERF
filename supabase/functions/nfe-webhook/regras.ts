// nfe-webhook: a Focus avisa que uma NF-e mudou (gatilho "nfe").
// Regras sem rede (tests/unit/nfe.test.mjs); rede em index.ts.
//
// 1. Token secreto na URL (?token=...), conferido em tempo constante.
// 2. O corpo só diz QUAL nota (ref); o estado é CONSULTADO na Focus.
// 3. Grava pelo atualizar_nfe_provedor (idempotente).

import { lerRetorno } from "../_shared/focusnfe.ts";

const json = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

function iguais(a: string, b: string): boolean {
    if (!a || a.length !== b.length) return false;
    let diferenca = 0;
    for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diferenca === 0;
}

export interface Dependencias {
    token: string;
    baseFocus: string;
    consultarFocus: (ref: string) => Promise<{ status: number; corpo: Record<string, any> }>;
    atualizar: (ref: string, retorno: ReturnType<typeof lerRetorno>) => Promise<unknown>;
}

export async function tratarWebhookNfe(req: Request, deps: Dependencias): Promise<Response> {
    if (req.method !== "POST") return json(405, { erro: "Método não permitido." });
    if (!iguais(new URL(req.url).searchParams.get("token") || "", deps.token)) return json(401, { erro: "Token inválido." });

    const ref = String((await req.json().catch(() => ({})))?.ref || "");
    if (!ref.startsWith("serf-")) return json(200, { ignorado: "outra origem" });

    try {
        const resposta = await deps.consultarFocus(ref);
        if (resposta.status >= 400) throw new Error(`Focus ${resposta.status}`);
        await deps.atualizar(ref, lerRetorno(resposta.corpo, deps.baseFocus));
        return json(200, { ok: true });
    } catch (erro) {
        console.error("[nfe-webhook]", erro);
        return json(500, { erro: "Falha temporária; a Focus tentará de novo." });
    }
}
