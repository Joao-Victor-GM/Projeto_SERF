// S.E.R.F. — Edge Function: nfe-webhook
//
// Gatilho da Focus NFe (evento "nfe"). Regras: ./regras.ts.
//
// Deploy: supabase functions deploy nfe-webhook --no-verify-jwt
// Segredos: FOCUS_TOKEN, FOCUS_AMBIENTE e FOCUS_WEBHOOK_TOKEN.
// Na Focus, cadastre o gatilho com a URL:
//   https://<ref-do-projeto>.supabase.co/functions/v1/nfe-webhook?token=<FOCUS_WEBHOOK_TOKEN>

import { BASES_FOCUS, autorizacaoFocus } from "../_shared/focusnfe.ts";
import { tratarWebhookNfe } from "./regras.ts";

Deno.serve(req => {
    const url = Deno.env.get("SUPABASE_URL")!;
    const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const baseFocus = Deno.env.get("FOCUS_AMBIENTE") === "PRODUCAO" ? BASES_FOCUS.PRODUCAO : BASES_FOCUS.HOMOLOGACAO;

    return tratarWebhookNfe(req, {
        token: Deno.env.get("FOCUS_WEBHOOK_TOKEN") || "",
        baseFocus,
        consultarFocus: async ref => {
            const resposta = await fetch(`${baseFocus}/v2/nfe/${encodeURIComponent(ref)}?completa=0`, {
                headers: { Authorization: autorizacaoFocus(Deno.env.get("FOCUS_TOKEN") || "") }
            });
            return { status: resposta.status, corpo: await resposta.json().catch(() => ({})) };
        },
        atualizar: async (ref, r) => {
            const resposta = await fetch(`${url}/rest/v1/rpc/atualizar_nfe_provedor`, {
                method: "POST",
                headers: { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    p_ref: ref, p_status: r.status, p_numero: r.numero, p_serie: r.serie, p_chave: r.chave,
                    p_protocolo: r.protocolo, p_url_danfe: r.urlDanfe, p_url_xml: r.urlXml, p_mensagem: r.mensagem
                })
            });
            if (!resposta.ok) throw new Error(`PostgREST ${resposta.status}: ${await resposta.text()}`);
        }
    });
});
