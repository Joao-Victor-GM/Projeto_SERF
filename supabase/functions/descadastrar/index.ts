// S.E.R.F. — Edge Function: descadastrar
//
// Desliga os e-mails de um usuário a partir do link assinado dos e-mails
// (cabeçalho List-Unsubscribe "um clique" e página descadastro.html).
// Regras e token: ../_shared/descadastro.ts.
//
// Deploy: supabase functions deploy descadastrar --no-verify-jwt
// Segredos: DESCADASTRO_SECRET (o MESMO usado por enviar-emails) e APP_URL.

import { tratarDescadastro } from "../_shared/descadastro.ts";

Deno.serve(req => {
    const url = Deno.env.get("SUPABASE_URL")!;
    const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    return tratarDescadastro(req, {
        segredo: Deno.env.get("DESCADASTRO_SECRET") || "",
        urlApp: Deno.env.get("APP_URL") || "",
        desligar: async uid => {
            // upsert: cria a preferência se o usuário nunca abriu o Perfil
            const resposta = await fetch(`${url}/rest/v1/preferencias_notificacao?on_conflict=auth_user_id`, {
                method: "POST",
                headers: {
                    apikey: servico,
                    Authorization: `Bearer ${servico}`,
                    "Content-Type": "application/json",
                    Prefer: "resolution=merge-duplicates,return=minimal"
                },
                body: JSON.stringify({ auth_user_id: uid, receber_email: false, atualizado_em: new Date().toISOString() })
            });
            if (!resposta.ok) throw new Error(`PostgREST ${resposta.status}: ${await resposta.text()}`);
        }
    });
});
