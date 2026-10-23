// S.E.R.F. — Edge Function: homologar-fornecedor
//
// Verifica o CNPJ da empresa logada na Receita Federal (BrasilAPI) e grava
// o resultado: fornecedores.status_cadastro (+ motivo e data) e
// usuarios.status_cadastro. Quem chama é o próprio usuário (JWT); a
// gravação usa a chave de serviço porque o navegador NÃO tem permissão
// nessas colunas (migration 006/019) — ninguém se homologa sozinho.
//
// Deploy:  supabase functions deploy homologar-fornecedor
// Segredos: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem nas funções.

import { avaliarCnpj, normalizarCnpj, statusDoComprador } from "./regras.ts";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const responder = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return responder(405, { erro: "Use POST." });

    const url = Deno.env.get("SUPABASE_URL");
    const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const autorizacao = req.headers.get("Authorization");

    if (!url || !servico) return responder(500, { erro: "Função sem configuração do Supabase." });
    if (!autorizacao) return responder(401, { erro: "Entre na sua conta para verificar o CNPJ." });

    // 1. Quem está pedindo (valida o JWT no Auth)
    const respostaUsuario = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: autorizacao, apikey: servico } });
    if (!respostaUsuario.ok) return responder(401, { erro: "Sessão expirada. Entre novamente." });
    const { id: uid } = await respostaUsuario.json();

    const rest = (caminho: string, init: RequestInit = {}) => fetch(`${url}/rest/v1/${caminho}`, {
        ...init,
        headers: {
            apikey: servico,
            Authorization: `Bearer ${servico}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
            ...(init.headers || {})
        }
    });

    // 2. Cadastro da empresa (fornecedor e/ou comprador)
    const [fornecedor] = await (await rest(`fornecedores?auth_user_id=eq.${uid}&select=id_fornecedor,cnpj,razao_social,homologacao_em`)).json();

    // Limite: uma consulta à Receita a cada 2 minutos por empresa (a BrasilAPI
    // é gratuita e bloqueia quem abusa — inclusive o S.E.R.F. inteiro)
    const ultima = fornecedor?.homologacao_em ? new Date(fornecedor.homologacao_em).getTime() : 0;
    if (Date.now() - ultima < 2 * 60 * 1000) {
        return responder(429, { erro: "Você acabou de verificar. Aguarde 2 minutos para consultar a Receita de novo." });
    }
    const [comprador] = await (await rest(`usuarios?auth_user_id=eq.${uid}&select=id_usuario,cnpj,nome_empresa`)).json();

    const cnpj = normalizarCnpj(fornecedor?.cnpj || comprador?.cnpj);
    const razaoSocial = fornecedor?.razao_social || comprador?.nome_empresa;
    if (!cnpj || !razaoSocial) return responder(404, { erro: "Empresa sem cadastro: conclua a segmentação primeiro." });

    // 3. Receita Federal (BrasilAPI)
    const respostaReceita = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    if (respostaReceita.status >= 500 || respostaReceita.status === 429) {
        return responder(503, { erro: "A consulta à Receita Federal está indisponível agora. Tente de novo em alguns minutos." });
    }
    const receita = respostaReceita.ok ? await respostaReceita.json() : null;

    const avaliacao = avaliarCnpj(razaoSocial, receita);

    // 4. Grava o resultado
    if (fornecedor) {
        await rest(`fornecedores?id_fornecedor=eq.${fornecedor.id_fornecedor}`, {
            method: "PATCH",
            body: JSON.stringify({
                status_cadastro: avaliacao.status,
                homologacao_motivo: avaliacao.motivo.slice(0, 300),
                homologacao_em: new Date().toISOString()
            })
        });
    }

    if (comprador) {
        await rest(`usuarios?id_usuario=eq.${comprador.id_usuario}`, {
            method: "PATCH",
            body: JSON.stringify({ status_cadastro: statusDoComprador(avaliacao.status) })
        });
    }

    return responder(200, avaliacao);
});
