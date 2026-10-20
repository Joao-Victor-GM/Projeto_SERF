// nfe: emitir, consultar e cancelar NF-e real. Regras sem rede
// (tests/unit/nfe.test.mjs); rede em index.ts.
//
// Emitir: preparar_nfe (sessão do fornecedor: confere tudo e diz o que
// falta) → registra PROCESSANDO → envia à Focus → consulta o resultado.
//   - Focus recusou na validação: a nota vira REJEITADA com o motivo.
//   - Rede caiu no envio: fica PROCESSANDO; "consultar" resolve depois
//     (se a Focus não recebeu, vira REJEITADA e pode emitir de novo).
// Assim nunca existe nota no emissor sem registro no S.E.R.F.

import { lerRetorno, mensagemDeErro, montarNfe } from "../_shared/focusnfe.ts";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export const json = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export class ErroDeRegra extends Error {}

// Resposta da Focus: status HTTP + corpo
export interface RespostaFocus { status: number; corpo: Record<string, any> }

export interface Dependencias {
    baseFocus: string;
    usuario: (token: string) => Promise<{ id: string } | null>;
    preparar: (token: string, idPedido: number) => Promise<Record<string, any>>;
    refDoPedido: (token: string, idPedido: number) => Promise<string>;
    prepararCancelamento: (token: string, idPedido: number, justificativa: string) => Promise<string>;
    registrar: (idPedido: number, ref: string, cfop: string, uid: string) => Promise<Record<string, any>>;
    atualizar: (ref: string, retorno: ReturnType<typeof lerRetorno>) => Promise<Record<string, any>>;
    enviarFocus: (ref: string, nfe: unknown) => Promise<RespostaFocus>;
    consultarFocus: (ref: string) => Promise<RespostaFocus>;
    cancelarFocus: (ref: string, justificativa: string) => Promise<RespostaFocus>;
    agora?: () => Date;
}

const rejeitada = (mensagem: string) =>
    ({ status: "REJEITADA", numero: null, serie: null, chave: null, protocolo: null, urlDanfe: null, urlXml: null, mensagem });

// Consulta na Focus e grava o que ela disser
async function sincronizar(ref: string, deps: Dependencias) {
    const resposta = await deps.consultarFocus(ref);
    if (resposta.status === 404) {
        return deps.atualizar(ref, rejeitada("A nota não chegou ao emissor. Emita de novo."));
    }
    if (resposta.status >= 400) throw new Error(`Focus ${resposta.status}: ${mensagemDeErro(resposta.corpo)}`);
    return deps.atualizar(ref, lerRetorno(resposta.corpo, deps.baseFocus));
}

async function emitir(token: string, idPedido: number, deps: Dependencias) {
    const usuario = await deps.usuario(token);
    if (!usuario) return json(401, { erro: "Sessão expirada. Faça login novamente." });

    const dados = await deps.preparar(token, idPedido);
    await deps.registrar(idPedido, dados.ref, dados.cfop, usuario.id);

    let envio: RespostaFocus;
    try {
        envio = await deps.enviarFocus(dados.ref, montarNfe(dados, deps.agora?.() ?? new Date()));
    } catch (erro) {
        console.error("[nfe] envio:", erro);
        return json(202, { nota: null, aviso: "Enviada; aguardando o emissor. Consulte em instantes." });
    }

    if (envio.status >= 400 && envio.status < 500) {
        const nota = await deps.atualizar(dados.ref, rejeitada(mensagemDeErro(envio.corpo)));
        return json(200, { nota });
    }

    try {
        return json(200, { nota: await sincronizar(dados.ref, deps) });
    } catch (erro) {
        console.error("[nfe] consulta após envio:", erro);
        return json(202, { nota: null, aviso: "Enviada; aguardando a SEFAZ." });
    }
}

async function cancelar(token: string, idPedido: number, justificativa: string, deps: Dependencias) {
    const ref = await deps.prepararCancelamento(token, idPedido, justificativa);
    const resposta = await deps.cancelarFocus(ref, justificativa);

    if (resposta.status >= 400 || resposta.corpo?.status !== "cancelado") {
        return json(422, { erro: `A SEFAZ não cancelou: ${resposta.corpo?.mensagem_sefaz || mensagemDeErro(resposta.corpo)}` });
    }

    const retorno = lerRetorno(resposta.corpo, deps.baseFocus);
    return json(200, { nota: await deps.atualizar(ref, { ...retorno, status: "CANCELADA", mensagem: justificativa }) });
}

export async function tratarNfe(req: Request, deps: Dependencias): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json(405, { erro: "Método não permitido." });

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json(401, { erro: "Sessão expirada. Faça login novamente." });

    const corpo = await req.json().catch(() => ({}));
    const idPedido = Number(corpo?.id_pedido);
    if (!Number.isInteger(idPedido) || idPedido <= 0) return json(400, { erro: "Pedido inválido." });

    try {
        if (corpo.acao === "emitir") return await emitir(token, idPedido, deps);
        if (corpo.acao === "consultar") {
            return json(200, { nota: await sincronizar(await deps.refDoPedido(token, idPedido), deps) });
        }
        if (corpo.acao === "cancelar") return await cancelar(token, idPedido, String(corpo.justificativa || ""), deps);
        return json(400, { erro: "Ação inválida." });
    } catch (erro) {
        if (erro instanceof ErroDeRegra) return json(409, { erro: erro.message });
        console.error(`[nfe] ${corpo.acao}:`, erro);
        return json(502, { erro: "O emissor de NF-e não respondeu. Tente novamente em instantes." });
    }
}
