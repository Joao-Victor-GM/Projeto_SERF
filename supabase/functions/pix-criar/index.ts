// S.E.R.F. — Edge Function: pix-criar
//
// Gera (ou reaproveita) a cobrança Pix REAL de um pedido no Mercado Pago.
// Só funciona com configuracao_pagamentos.modo = 'REAL' (migration 026).
// Regras: ./regras.ts.
//
// Deploy: supabase functions deploy pix-criar
// Segredos: MP_ACCESS_TOKEN (credencial de produção ou de teste do Mercado Pago)

import { API_MP } from "../_shared/mercadopago.ts";
import { ErroDeRegra, tratarCriarPix } from "./regras.ts";

Deno.serve(req => {
    const url = Deno.env.get("SUPABASE_URL")!;
    const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonima = Deno.env.get("SUPABASE_ANON_KEY")!;
    const tokenMp = Deno.env.get("MP_ACCESS_TOKEN") || "";

    return tratarCriarPix(req, {
        urlWebhook: `${url}/functions/v1/pix-webhook`,

        // Com a sessão do comprador: o RLS/SECURITY DEFINER confere de quem é o pedido
        preparar: async (token, idPedido) => {
            const resposta = await fetch(`${url}/rest/v1/rpc/preparar_pix`, {
                method: "POST",
                headers: { apikey: anonima, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ p_id_pedido: idPedido })
            });
            const corpo = await resposta.json().catch(() => ({}));
            if (resposta.ok) return corpo;
            if (corpo?.code === "P0001") throw new ErroDeRegra(corpo.message);
            if (resposta.status === 401) throw new ErroDeRegra("Sessão expirada. Faça login novamente.");
            throw new Error(`PostgREST ${resposta.status}: ${JSON.stringify(corpo)}`);
        },

        criarNoProvedor: async (corpo, chave) => {
            if (!tokenMp) throw new Error("MP_ACCESS_TOKEN não configurado.");
            const resposta = await fetch(API_MP, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenMp}`, "Content-Type": "application/json", "X-Idempotency-Key": chave },
                body: JSON.stringify(corpo)
            });
            const dados = await resposta.json().catch(() => ({}));
            if (!resposta.ok) throw new Error(`Mercado Pago ${resposta.status}: ${JSON.stringify(dados).slice(0, 300)}`);
            return dados;
        },

        registrar: async ({ idPedido, id, codigo, qrBase64, expiraEm, valor }) => {
            const resposta = await fetch(`${url}/rest/v1/rpc/registrar_cobranca_pix`, {
                method: "POST",
                headers: { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    p_id_pedido: idPedido, p_provedor_id: id, p_codigo: codigo,
                    p_qr_base64: qrBase64, p_expira_em: expiraEm, p_valor: valor
                })
            });
            const corpo = await resposta.json().catch(() => ({}));
            if (!resposta.ok) throw new Error(`PostgREST ${resposta.status}: ${JSON.stringify(corpo)}`);
            return Array.isArray(corpo) ? corpo[0] : corpo;
        }
    });
});
