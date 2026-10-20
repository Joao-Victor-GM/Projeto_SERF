// pix-webhook: regras sem rede (tests/unit/pix.test.mjs). Rede em index.ts.
//
// O Mercado Pago avisa "o pagamento X mudou". A função:
//   1. confere a assinatura (x-signature) — sem ela, 401;
//   2. CONSULTA o pagamento X na API (o corpo da notificação não vale nada);
//   3. entrega status e valor ao banco (confirmar_pagamento_provedor).
// Resposta 200 encerra as tentativas do Mercado Pago; 5xx faz ele tentar
// de novo (só para falhas temporárias).

import { assinaturaValida, lerPagamento } from "../_shared/mercadopago.ts";

export class ErroDeRegra extends Error {}

const json = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

export interface Dependencias {
    segredo: string;
    consultarPagamento: (id: string) => Promise<Record<string, any>>;
    confirmar: (id: string, status: string, valor: number) => Promise<string>;
}

export async function tratarWebhook(req: Request, deps: Dependencias): Promise<Response> {
    if (req.method !== "POST") return json(405, { erro: "Método não permitido." });

    const url = new URL(req.url);
    const corpo = await req.json().catch(() => ({}));
    const tipo = url.searchParams.get("type") || corpo?.type || "";
    const idDado = String(url.searchParams.get("data.id") || corpo?.data?.id || "");

    const valida = await assinaturaValida({
        assinatura: req.headers.get("x-signature"),
        idRequisicao: req.headers.get("x-request-id"),
        idDado,
        segredo: deps.segredo
    });
    if (!valida) return json(401, { erro: "Assinatura inválida." });

    if (tipo !== "payment") return json(200, { ignorado: tipo || "sem tipo" });

    let pagamento: ReturnType<typeof lerPagamento>;
    try {
        pagamento = lerPagamento(await deps.consultarPagamento(idDado));
    } catch (erro) {
        console.error("[pix-webhook] consulta:", erro);
        return json(502, { erro: "Consulta ao Mercado Pago falhou." });
    }

    // Só cobranças do S.E.R.F. (external_reference serf-pedido-N)
    if (!pagamento.referencia.startsWith("serf-pedido-")) return json(200, { ignorado: "outra origem" });

    try {
        const resultado = await deps.confirmar(pagamento.id, pagamento.status, pagamento.valor);
        return json(200, { resultado });
    } catch (erro) {
        if (erro instanceof ErroDeRegra) {
            // Ex.: valor divergente — repetir não resolve: registra e encerra
            console.error("[pix-webhook] regra:", erro.message);
            return json(200, { resultado: "recusado", motivo: erro.message });
        }
        console.error("[pix-webhook] banco:", erro);
        return json(500, { erro: "Falha ao registrar; o Mercado Pago tentará de novo." });
    }
}
