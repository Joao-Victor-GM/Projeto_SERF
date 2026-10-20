// S.E.R.F. — Edge Function: nfe   (emitir | consultar | cancelar)
//
// NF-e REAL pela Focus NFe. Só com configuracao_nfe.modo = 'REAL' (027).
// Regras: ./regras.ts. Corpo: { acao, id_pedido, justificativa? }
//
// Deploy: supabase functions deploy nfe
// Segredos: FOCUS_TOKEN e FOCUS_AMBIENTE (HOMOLOGACAO | PRODUCAO; padrão HOMOLOGACAO)

import { BASES_FOCUS, autorizacaoFocus } from "../_shared/focusnfe.ts";
import { ErroDeRegra, tratarNfe } from "./regras.ts";

Deno.serve(req => {
    const url = Deno.env.get("SUPABASE_URL")!;
    const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonima = Deno.env.get("SUPABASE_ANON_KEY")!;
    const baseFocus = Deno.env.get("FOCUS_AMBIENTE") === "PRODUCAO" ? BASES_FOCUS.PRODUCAO : BASES_FOCUS.HOMOLOGACAO;
    const focus = { Authorization: autorizacaoFocus(Deno.env.get("FOCUS_TOKEN") || ""), "Content-Type": "application/json" };

    // RPC com a sessão do usuário (as regras de quem-pode-o-quê ficam no banco)
    async function rpcComoUsuario(token: string, nome: string, argumentos: unknown) {
        const resposta = await fetch(`${url}/rest/v1/rpc/${nome}`, {
            method: "POST",
            headers: { apikey: anonima, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(argumentos)
        });
        const corpo = await resposta.json().catch(() => ({}));
        if (resposta.ok) return corpo;
        if (corpo?.code === "P0001") throw new ErroDeRegra(corpo.message);
        throw new Error(`PostgREST ${resposta.status}: ${JSON.stringify(corpo)}`);
    }

    async function rpcComoServico(nome: string, argumentos: unknown) {
        const resposta = await fetch(`${url}/rest/v1/rpc/${nome}`, {
            method: "POST",
            headers: { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" },
            body: JSON.stringify(argumentos)
        });
        const corpo = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(`PostgREST ${resposta.status}: ${JSON.stringify(corpo)}`);
        return Array.isArray(corpo) ? corpo[0] : corpo;
    }

    async function chamarFocus(caminho: string, opcoes: RequestInit = {}) {
        const resposta = await fetch(`${baseFocus}${caminho}`, { ...opcoes, headers: focus });
        return { status: resposta.status, corpo: await resposta.json().catch(() => ({})) };
    }

    return tratarNfe(req, {
        baseFocus,
        usuario: async token => {
            const resposta = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonima, Authorization: `Bearer ${token}` } });
            const usuario = resposta.ok ? await resposta.json() : null;
            return usuario?.id ? { id: usuario.id } : null;
        },
        preparar: (token, idPedido) => rpcComoUsuario(token, "preparar_nfe", { p_id_pedido: idPedido }),
        refDoPedido: (token, idPedido) => rpcComoUsuario(token, "nfe_ref_do_pedido", { p_id_pedido: idPedido }),
        prepararCancelamento: (token, idPedido, justificativa) =>
            rpcComoUsuario(token, "preparar_cancelamento_nfe", { p_id_pedido: idPedido, p_motivo: justificativa }),
        registrar: (idPedido, ref, cfop, uid) =>
            rpcComoServico("registrar_nfe_enviada", { p_id_pedido: idPedido, p_ref: ref, p_cfop: cfop, p_emitida_por: uid }),
        atualizar: (ref, r) => rpcComoServico("atualizar_nfe_provedor", {
            p_ref: ref, p_status: r.status, p_numero: r.numero, p_serie: r.serie, p_chave: r.chave,
            p_protocolo: r.protocolo, p_url_danfe: r.urlDanfe, p_url_xml: r.urlXml, p_mensagem: r.mensagem
        }),
        enviarFocus: (ref, nfe) => chamarFocus(`/v2/nfe?ref=${encodeURIComponent(ref)}`, { method: "POST", body: JSON.stringify(nfe) }),
        consultarFocus: ref => chamarFocus(`/v2/nfe/${encodeURIComponent(ref)}?completa=0`),
        cancelarFocus: (ref, justificativa) =>
            chamarFocus(`/v2/nfe/${encodeURIComponent(ref)}`, { method: "DELETE", body: JSON.stringify({ justificativa }) })
    });
});
