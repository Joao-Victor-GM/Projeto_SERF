// S.E.R.F. — Edge Function: enviar-emails
//
// Esvazia a fila notificacoes_email (migration 020): reserva até 50 e-mails
// (reservar_emails, sem duplicar entre execuções), monta cada um (modelos.ts),
// envia pelo Resend e marca como enviado. Falhas contam tentativa (até 5).
//
// Chamada por agendamento (pg_cron + pg_net), a cada minuto, com o
// cabeçalho x-cron-secret. Deploy: supabase functions deploy enviar-emails --no-verify-jwt
// Segredos (supabase secrets set ...):
//   CRON_SECRET     segredo compartilhado com o agendamento
//   RESEND_API_KEY  chave da API do Resend (https://resend.com)
//   EMAIL_REMETENTE ex.: "S.E.R.F. <avisos@seudominio.com.br>"
//   APP_URL         endereço público do front-end (ex.: https://usuario.github.io/SERF-PROJETO-ACEX)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem nas funções.

import { montarEmail } from "./modelos.ts";

const json = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
    const segredo = Deno.env.get("CRON_SECRET");
    if (!segredo || req.headers.get("x-cron-secret") !== segredo) {
        return json(401, { erro: "Não autorizado." });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const remetente = Deno.env.get("EMAIL_REMETENTE");
    const urlApp = Deno.env.get("APP_URL") || "";

    if (!resendKey || !remetente) return json(500, { erro: "Configure RESEND_API_KEY e EMAIL_REMETENTE." });

    const cabecalhos = { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" };

    // 1. Reserva (nenhuma outra execução pega os mesmos)
    const reserva = await fetch(`${url}/rest/v1/rpc/reservar_emails`, {
        method: "POST", headers: cabecalhos, body: JSON.stringify({ p_limite: 50 })
    });
    if (!reserva.ok) return json(502, { erro: "Falha ao reservar e-mails", detalhe: await reserva.text() });

    const pendentes: Array<Record<string, any>> = await reserva.json();
    let enviados = 0;
    let falhas = 0;

    // 2. Envia um a um (o volume por minuto é pequeno)
    for (const n of pendentes) {
        const email = montarEmail(n.tipo, n.dados, urlApp);
        let atualizacao: Record<string, unknown>;

        try {
            const resposta = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ from: remetente, to: [n.email], subject: email.assunto, html: email.html, text: email.texto })
            });

            if (!resposta.ok) throw new Error(`Resend ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);

            atualizacao = { enviada_em: new Date().toISOString(), ultimo_erro: null };
            enviados += 1;
        } catch (erro) {
            atualizacao = { tentativas: (n.tentativas || 0) + 1, reservada_em: null, ultimo_erro: String(erro).slice(0, 500) };
            falhas += 1;
        }

        await fetch(`${url}/rest/v1/notificacoes_email?id=eq.${n.id}`, {
            method: "PATCH", headers: { ...cabecalhos, Prefer: "return=minimal" }, body: JSON.stringify(atualizacao)
        });
    }

    return json(200, { reservados: pendentes.length, enviados, falhas });
});
