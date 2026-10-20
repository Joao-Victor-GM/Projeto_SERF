// NF-e real: Focus NFe (supabase/functions/_shared/focusnfe.ts) e as regras
// das Edge Functions nfe e nfe-webhook. Sem rede.

import { test } from "node:test";
import assert from "node:assert/strict";
import { montarNfe, lerRetorno, mensagemDeErro, autorizacaoFocus } from "../../supabase/functions/_shared/focusnfe.ts";
import { tratarNfe, ErroDeRegra } from "../../supabase/functions/nfe/regras.ts";
import { tratarWebhookNfe } from "../../supabase/functions/nfe-webhook/regras.ts";

const BASE = "https://homologacao.focusnfe.com.br";
const DADOS = {
    ref: "serf-102-1", id_pedido: 102, cfop: "6102",
    emitente: { cnpj: "12.345.678/0001-90", uf: "PR" },
    destinatario: { nome: "Mercado Bom Preço", cnpj: "98765432000110", email: "compras@mercado.com", inscricao_estadual: "110.042.490.114",
        cep: "01001-000", logradouro: "Praça da Sé", numero: "1", complemento: null, bairro: "Sé", municipio: "São Paulo", uf: "SP" },
    item: { codigo: 21, descricao: "Café Torrado 500g", ncm: "09012100", unidade: "UN", quantidade: 20, valor_unitario: "25.5", valor_total: "510" },
    pagamento: { metodo: "PIX", valor: "510" }
};
const AUTORIZADO = {
    status: "autorizado", status_sefaz: "100", mensagem_sefaz: "Autorizado o uso da NF-e", numero: "42", serie: "1",
    chave_nfe: "NFe41261012345678000190550010000000421234567890", protocolo: "141260000012345",
    caminho_danfe: "/arquivos/danfe.pdf", caminho_xml_nota_fiscal: "/arquivos/nota.xml"
};

const silenciar = async tarefa => {
    const original = console.error;
    console.error = () => {};
    try { return await tarefa(); } finally { console.error = original; }
};

/* ---------------- Focus NFe (puro) ---------------- */

test("montagem: B2B interestadual, Simples Nacional, só dígitos, Pix", () => {
    const nfe = montarNfe(DADOS, new Date("2026-10-20T15:00:00Z"));

    assert.equal(nfe.data_emissao, "2026-10-20T12:00:00-03:00");
    assert.equal(nfe.local_destino, 2, "6102 = interestadual");
    assert.equal(nfe.consumidor_final, 0);
    assert.equal(nfe.cnpj_emitente, "12345678000190");
    assert.equal(nfe.cep_destinatario, "01001000");
    assert.equal(nfe.indicador_inscricao_estadual_destinatario, 1);
    assert.equal(nfe.inscricao_estadual_destinatario, "110042490114");
    assert.equal(nfe.complemento_destinatario, undefined, "campo vazio não vai");

    const [item] = nfe.items;
    assert.deepEqual([item.cfop, item.codigo_ncm, item.icms_situacao_tributaria, item.pis_situacao_tributaria],
        ["6102", "09012100", "102", "07"]);
    assert.deepEqual([item.quantidade_comercial, item.valor_unitario_comercial, item.valor_bruto], [20, 25.5, 510]);
    assert.deepEqual(nfe.formas_pagamento, [{ indicador_pagamento: 0, forma_pagamento: "17", valor_pagamento: 510 }]);
});

test("montagem: sem IE = não contribuinte; ISENTO; a prazo", () => {
    const semIe = montarNfe({ ...DADOS, destinatario: { ...DADOS.destinatario, inscricao_estadual: null } });
    assert.equal(semIe.indicador_inscricao_estadual_destinatario, 9);
    assert.equal(semIe.inscricao_estadual_destinatario, undefined);

    const isento = montarNfe({ ...DADOS, destinatario: { ...DADOS.destinatario, inscricao_estadual: "ISENTO" } });
    assert.equal(isento.indicador_inscricao_estadual_destinatario, 2);

    const prazo = montarNfe({ ...DADOS, cfop: "5102", pagamento: { metodo: "PRAZO", valor: 510 } });
    assert.equal(prazo.local_destino, 1);
    assert.deepEqual(prazo.formas_pagamento[0], { indicador_pagamento: 1, forma_pagamento: "99", valor_pagamento: 510 });
});

test("retorno: autorizada (chave sem 'NFe', links completos), processando, rejeitada, cancelada", () => {
    assert.deepEqual(lerRetorno(AUTORIZADO, BASE), {
        status: "AUTORIZADA", numero: 42, serie: 1, chave: "41261012345678000190550010000000421234567890",
        protocolo: "141260000012345", urlDanfe: `${BASE}/arquivos/danfe.pdf`, urlXml: `${BASE}/arquivos/nota.xml`,
        mensagem: "Autorizado o uso da NF-e"
    });
    assert.equal(lerRetorno({ status: "processando_autorizacao" }, BASE).status, "PROCESSANDO");
    assert.equal(lerRetorno({ status: "erro_autorizacao", mensagem_sefaz: "Rejeição 778" }, BASE).mensagem, "Rejeição 778");
    assert.equal(lerRetorno({ status: "denegado" }, BASE).status, "REJEITADA");
    assert.equal(lerRetorno({ status: "cancelado" }, BASE).status, "CANCELADA");
    assert.equal(lerRetorno({ status: "algo_novo" }, BASE).status, "PROCESSANDO", "desconhecido não autoriza nada");
});

test("erros de validação da Focus viram uma frase; autenticação Basic com o token", () => {
    assert.equal(mensagemDeErro({ mensagem: "Erro de validação", erros: [{ mensagem: "CEP inválido" }, { mensagem: "NCM inexistente" }] }),
        "Erro de validação CEP inválido NCM inexistente");
    assert.equal(mensagemDeErro({}), "O emissor recusou a nota.");
    assert.equal(autorizacaoFocus("abc"), `Basic ${Buffer.from("abc:").toString("base64")}`);
});

/* ---------------- Edge Function nfe ---------------- */

function cenario(sobrescrever = {}) {
    const passos = [];
    const deps = {
        baseFocus: BASE,
        agora: () => new Date("2026-10-20T15:00:00Z"),
        usuario: async token => (token === "jwt" ? { id: "uid-fornecedor" } : null),
        preparar: async () => { passos.push("preparar"); return DADOS; },
        refDoPedido: async () => "serf-102-1",
        prepararCancelamento: async () => { passos.push("prepararCancelamento"); return "serf-102-1"; },
        registrar: async (id, ref, cfop, uid) => { passos.push(["registrar", ref, cfop, uid]); return {}; },
        atualizar: async (ref, r) => { passos.push(["atualizar", r.status, r.mensagem]); return { provedor_ref: ref, status: r.status }; },
        enviarFocus: async ref => { passos.push(["enviar", ref]); return { status: 202, corpo: { status: "processando_autorizacao" } }; },
        consultarFocus: async () => { passos.push("consultar"); return { status: 200, corpo: AUTORIZADO }; },
        cancelarFocus: async () => { passos.push("cancelarFocus"); return { status: 200, corpo: { status: "cancelado", caminho_xml_cancelamento: "/c.xml" } }; },
        ...sobrescrever
    };
    const pedir = (corpo, token = "jwt") => tratarNfe(new Request("https://x/functions/v1/nfe", {
        method: "POST", headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify(corpo)
    }), deps);
    return { pedir, passos };
}

test("emitir: registra PROCESSANDO ANTES de enviar, envia e grava o resultado da SEFAZ", async () => {
    const { pedir, passos } = cenario();
    const resposta = await pedir({ acao: "emitir", id_pedido: 102 });

    assert.equal(resposta.status, 200);
    assert.deepEqual((await resposta.json()).nota, { provedor_ref: "serf-102-1", status: "AUTORIZADA" });
    assert.deepEqual(passos, ["preparar", ["registrar", "serf-102-1", "6102", "uid-fornecedor"], ["enviar", "serf-102-1"],
        "consultar", ["atualizar", "AUTORIZADA", "Autorizado o uso da NF-e"]]);
});

test("emitir: a Focus recusa na validação → REJEITADA com o motivo (pode emitir de novo)", async () => {
    const { pedir, passos } = cenario({
        enviarFocus: async () => ({ status: 422, corpo: { mensagem: "Erro de validação", erros: [{ mensagem: "CEP do destinatário inválido" }] } })
    });
    const corpo = await (await pedir({ acao: "emitir", id_pedido: 102 })).json();

    assert.equal(corpo.nota.status, "REJEITADA");
    assert.deepEqual(passos.at(-1), ["atualizar", "REJEITADA", "Erro de validação CEP do destinatário inválido"]);
});

test("emitir: rede caiu no envio → 202 (fica PROCESSANDO; consultar resolve depois)", async () => {
    await silenciar(async () => {
        const { pedir, passos } = cenario({ enviarFocus: async () => { throw new Error("ECONNRESET"); } });
        const resposta = await pedir({ acao: "emitir", id_pedido: 102 });
        assert.equal(resposta.status, 202);
        assert.equal(passos.filter(p => p[0] === "atualizar").length, 0);
    });
});

test("consultar: nota que nunca chegou à Focus (404) vira REJEITADA para emitir de novo", async () => {
    const { pedir, passos } = cenario({ consultarFocus: async () => ({ status: 404, corpo: {} }) });
    const corpo = await (await pedir({ acao: "consultar", id_pedido: 102 })).json();

    assert.equal(corpo.nota.status, "REJEITADA");
    assert.match(passos.at(-1)[2], /não chegou ao emissor/);
});

test("emitir com dados faltando: 409 com a lista do banco; nada é registrado nem enviado", async () => {
    const { pedir, passos } = cenario({ preparar: async () => { throw new ErroDeRegra("Faltam dados para a NF-e: NCM do produto \"Café\"."); } });
    const resposta = await pedir({ acao: "emitir", id_pedido: 102 });

    assert.equal(resposta.status, 409);
    assert.match((await resposta.json()).erro, /NCM do produto/);
    assert.deepEqual(passos, []);
});

test("cancelar: só grava CANCELADA se a SEFAZ cancelou; senão 422 com o motivo", async () => {
    const ok = cenario();
    const corpo = await (await ok.pedir({ acao: "cancelar", id_pedido: 102, justificativa: "Pedido digitado com erro" })).json();
    assert.equal(corpo.nota.status, "CANCELADA");
    assert.deepEqual(ok.passos.at(-1), ["atualizar", "CANCELADA", "Pedido digitado com erro"]);

    const recusado = cenario({ cancelarFocus: async () => ({ status: 200, corpo: { status: "erro_cancelamento", mensagem_sefaz: "Rejeição 220: prazo excedido" } }) });
    const resposta = await recusado.pedir({ acao: "cancelar", id_pedido: 102, justificativa: "Pedido digitado com erro" });
    assert.equal(resposta.status, 422);
    assert.match((await resposta.json()).erro, /Rejeição 220/);
    assert.equal(recusado.passos.filter(p => p[0] === "atualizar").length, 0);
});

test("sem sessão 401; ação ou pedido inválidos 400", async () => {
    assert.equal((await cenario().pedir({ acao: "emitir", id_pedido: 102 }, null)).status, 401);
    assert.equal((await cenario().pedir({ acao: "apagar", id_pedido: 102 })).status, 400);
    assert.equal((await cenario().pedir({ acao: "emitir", id_pedido: "x" })).status, 400);
});

/* ---------------- Edge Function nfe-webhook ---------------- */

test("webhook: token errado 401; certo → consulta na Focus e grava; outra origem ignorada", async () => {
    const gravados = [];
    const deps = {
        token: "segredo-webhook", baseFocus: BASE,
        consultarFocus: async () => ({ status: 200, corpo: AUTORIZADO }),
        atualizar: async (ref, r) => { gravados.push([ref, r.status]); }
    };
    const avisar = (token, ref = "serf-102-1") => tratarWebhookNfe(new Request(`https://x/functions/v1/nfe-webhook?token=${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref, status: "autorizado" })
    }), deps);

    assert.equal((await avisar("errado")).status, 401);
    assert.deepEqual(gravados, []);

    assert.equal((await avisar("segredo-webhook")).status, 200);
    assert.deepEqual(gravados, [["serf-102-1", "AUTORIZADA"]]);

    assert.deepEqual(await (await avisar("segredo-webhook", "loja-x-9")).json(), { ignorado: "outra origem" });
});
