// S.E.R.F. — Edge Function: excluir-conta
//
// Chamada pelo Perfil (functions.invoke, com a sessão do usuário).
// Regras: ./regras.ts. Banco: anonimizar_conta (migration 025).
//
// Deploy: supabase functions deploy excluir-conta
// (com verificação de JWT, o padrão; SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY já existem nas funções)

import { ErroDeRegra, tratarExclusao } from "./regras.ts";

Deno.serve(req => {
    const url = Deno.env.get("SUPABASE_URL")!;
    const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const comoServico = { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" };

    return tratarExclusao(req, {
        usuarioDoToken: async token => {
            const resposta = await fetch(`${url}/auth/v1/user`, { headers: { apikey: servico, Authorization: `Bearer ${token}` } });
            if (!resposta.ok) return null;
            const usuario = await resposta.json();
            return usuario?.id ? { id: usuario.id } : null;
        },

        anonimizar: async uid => {
            const resposta = await fetch(`${url}/rest/v1/rpc/anonimizar_conta`, {
                method: "POST", headers: comoServico, body: JSON.stringify({ p_uid: uid })
            });
            if (resposta.ok) return;

            const erro = await resposta.json().catch(() => ({}));
            if (erro?.code === "P0001") throw new ErroDeRegra(erro.message);
            throw new Error(`PostgREST ${resposta.status}: ${JSON.stringify(erro)}`);
        },

        apagarArquivos: async uid => {
            // Storage: DELETE /object/<bucket> com a lista de caminhos
            const resposta = await fetch(`${url}/storage/v1/object/logos`, {
                method: "DELETE", headers: comoServico, body: JSON.stringify({ prefixes: [`${uid}/logo`] })
            });
            // 400/404: bucket ainda não existe (sem a migration 031)
            if (!resposta.ok && resposta.status !== 400 && resposta.status !== 404) {
                throw new Error(`Storage ${resposta.status}: ${await resposta.text()}`);
            }
        },

        apagarLogin: async uid => {
            const resposta = await fetch(`${url}/auth/v1/admin/users/${uid}`, { method: "DELETE", headers: comoServico });
            // 404: já apagado numa tentativa anterior
            if (!resposta.ok && resposta.status !== 404) throw new Error(`Auth ${resposta.status}: ${await resposta.text()}`);
        }
    });
});
