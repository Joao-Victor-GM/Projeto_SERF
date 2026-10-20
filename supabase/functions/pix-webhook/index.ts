// S.E.R.F. — Edge Function: pix-webhook
//
// Recebe as notificações de pagamento do Mercado Pago (Pix real).
// Regras: ./regras.ts. Banco: confirmar_pagamento_provedor (migration 026).
//
// Deploy: supabase functions deploy pix-webhook --no-verify-jwt
// Segredos: MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET (Mercado Pago → Suas
// integrações → Webhooks → "Assinatura secreta"; evento "Pagamentos").

import { API_MP } from "../_shared/mercadopago.ts";
import { ErroDeRegra, tratarWebhook } from "./regras.ts";

Deno.serve(req => {
    const url = Deno.env.get("SUPABASE_URL")!;
    const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const tokenMp = Deno.env.get("MP_ACCESS_TOKEN") || "";

    return tratarWebhook(req, {
        segredo: Deno.env.get("MP_WEBHOOK_SECRET") || "",

        consultarPagamento: async id => {
            const resposta = await fetch(`${API_MP}/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${tokenMp}` } });
            if (!resposta.ok) throw new Error(`Mercado Pago ${resposta.status}`);
            return resposta.json();
        },

        confirmar: async (id, status, valor) => {
            const resposta = await fetch(`${url}/rest/v1/rpc/confirmar_pagamento_provedor`, {
                method: "POST",
                headers: { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" },
                body: JSON.stringify({ p_provedor_id: id, p_status: status, p_valor: valor })
            });
            const corpo = await resposta.json().catch(() => ({}));
            if (resposta.ok) return String(corpo);
            if (corpo?.code === "P0001") throw new ErroDeRegra(corpo.message);
            throw new Error(`PostgREST ${resposta.status}: ${JSON.stringify(corpo)}`);
        }
    });
});
