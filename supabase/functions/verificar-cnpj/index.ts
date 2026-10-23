// S.E.R.F. — Edge Function: verificar-cnpj
//
// Envia o código de posse do CNPJ (migration 029). Regras: ./regras.ts.
// A confirmação do código é a RPC confirmar_identidade (o navegador chama).
//
// Deploy: supabase functions deploy verificar-cnpj
// No modo REAL o e-mail sai pela fila (notificacoes_email) — precisa da
// função enviar-emails configurada (docs/arquitetura.md → E-mails).

import { ErroDeRegra, tratarEnvio } from "./regras.ts";

Deno.serve(req => {
    const url = Deno.env.get("SUPABASE_URL")!;
    const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const comoServico = { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" };

    const rest = async (caminho: string, init: RequestInit = {}) => {
        const resposta = await fetch(`${url}/rest/v1/${caminho}`, { ...init, headers: { ...comoServico, ...(init.headers || {}) } });
        const corpo = await resposta.json().catch(() => null);
        if (!resposta.ok) {
            if (corpo?.code === "P0001") throw new ErroDeRegra(corpo.message);
            throw new Error(`PostgREST ${resposta.status}: ${JSON.stringify(corpo)}`);
        }
        return corpo;
    };

    return tratarEnvio(req, {
        modo: async () => {
            const [linha] = await rest("configuracao_identidade?select=modo");
            return linha?.modo === "REAL" ? "REAL" : "DEMONSTRACAO";
        },
        usuario: async token => {
            const resposta = await fetch(`${url}/auth/v1/user`, { headers: { apikey: servico, Authorization: `Bearer ${token}` } });
            const usuario = resposta.ok ? await resposta.json() : null;
            return usuario?.id ? { id: usuario.id, email: usuario.email } : null;
        },
        identidade: async uid => {
            const [linha] = await rest(`identidade_empresas?auth_user_id=eq.${uid}&select=cnpj,verificada_em`);
            return linha ?? null;
        },
        receita: async cnpj => {
            const resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
            if (!resposta.ok) return resposta.status === 404 ? { email: null, razao_social: "" } : null;
            const dados = await resposta.json();
            return { email: dados.email ? String(dados.email).trim().toLowerCase() : null, razao_social: dados.razao_social || "" };
        },
        registrar: async (uid, hash, mascarado) => {
            await rest("rpc/registrar_codigo_identidade", {
                method: "POST", body: JSON.stringify({ p_uid: uid, p_codigo_hash: hash, p_email_mascarado: mascarado })
            });
        },
        enfileirar: async (uid, destino, dados) => {
            await rest("notificacoes_email", {
                method: "POST",
                headers: { Prefer: "return=minimal" },
                body: JSON.stringify({ auth_user_id: uid, email: destino, tipo: "VERIFICACAO_CNPJ", dados,
                                       chave: `verificacao-${uid}-${Date.now()}` })
            });
        }
    });
});
