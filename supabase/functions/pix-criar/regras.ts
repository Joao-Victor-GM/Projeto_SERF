// pix-criar: regras sem rede (tests/unit/pix.test.mjs). Rede em index.ts.
//
// 1. Sessão do comprador → preparar_pix (migration 026) confere o pedido.
// 2. Cobrança ainda válida? Devolve a mesma (sem criar outra no provedor).
// 3. Senão cria no Mercado Pago e grava (registrar_cobranca_pix).

import { chaveDeIdempotencia, lerCobranca, montarCobrancaPix } from "../_shared/mercadopago.ts";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export const json = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export class ErroDeRegra extends Error {}

export interface Dependencias {
    urlWebhook: string;
    preparar: (token: string, idPedido: number) => Promise<Record<string, any>>;   // ErroDeRegra = mensagem ao usuário
    criarNoProvedor: (corpo: unknown, chave: string) => Promise<Record<string, any>>;
    registrar: (dados: { idPedido: number; id: string; codigo: string; qrBase64: string | null; expiraEm: string; valor: number }) => Promise<Record<string, any>>;
    agora?: () => Date;
}

export async function tratarCriarPix(req: Request, deps: Dependencias): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json(405, { erro: "Método não permitido." });

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const idPedido = Number((await req.json().catch(() => ({})))?.id_pedido);
    if (!token) return json(401, { erro: "Sessão expirada. Faça login novamente." });
    if (!Number.isInteger(idPedido) || idPedido <= 0) return json(400, { erro: "Pedido inválido." });

    let pedido: Record<string, any>;
    try {
        pedido = await deps.preparar(token, idPedido);
    } catch (erro) {
        if (erro instanceof ErroDeRegra) return json(409, { erro: erro.message });
        console.error("[pix-criar] preparar:", erro);
        return json(500, { erro: "Não foi possível gerar o Pix agora. Tente novamente." });
    }

    if (pedido.vigente) return json(200, { pagamento: pedido.vigente, reaproveitado: true });

    const agora = deps.agora?.() ?? new Date();
    let cobranca: ReturnType<typeof lerCobranca>;
    try {
        const resposta = await deps.criarNoProvedor(
            montarCobrancaPix(pedido as any, { urlWebhook: deps.urlWebhook, agora }),
            chaveDeIdempotencia(idPedido, agora));
        cobranca = lerCobranca(resposta);
    } catch (erro) {
        console.error("[pix-criar] Mercado Pago:", erro);
        return json(502, { erro: "O Mercado Pago não respondeu. Tente novamente em instantes." });
    }

    try {
        const pagamento = await deps.registrar({ idPedido, ...cobranca });
        return json(200, { pagamento, reaproveitado: false });
    } catch (erro) {
        console.error("[pix-criar] registrar:", erro);
        return json(500, { erro: "O Pix foi criado, mas não foi salvo. Tente gerar de novo." });
    }
}
