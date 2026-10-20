// Focus NFe (API v2) — NF-e modelo 55. Funções puras: montam o envio e
// leem o retorno. A rede fica nas Edge Functions nfe e nfe-webhook.
// Testes: tests/unit/nfe.test.mjs.
//
// Homologação: https://homologacao.focusnfe.com.br  ·  Produção: https://api.focusnfe.com.br
// Autenticação: HTTP Basic com o token como usuário e senha vazia.
// O certificado A1 e os dados do emitente ficam cadastrados no painel da Focus.
//
// Tributação montada aqui: Simples Nacional (CSOSN 102, PIS/COFINS 07).
// Confira com o contador e valide em HOMOLOGAÇÃO antes de produção.

export const BASES_FOCUS = {
    HOMOLOGACAO: "https://homologacao.focusnfe.com.br",
    PRODUCAO: "https://api.focusnfe.com.br"
};

export const autorizacaoFocus = (token: string) => `Basic ${btoa(`${token}:`)}`;

const apenasDigitos = (valor: unknown) => String(valor ?? "").replace(/\D/g, "");
const dinheiro = (valor: unknown) => Number(Number(valor).toFixed(2));

function dataComFuso(data: Date): string {
    return new Date(data.getTime() - 3 * 3600000).toISOString().replace(/\.\d{3}Z$/, "-03:00");
}

// IE: número = contribuinte (1); ISENTO (2); sem IE = não contribuinte (9)
function indicadorIe(ie: string | null) {
    if (!ie) return { indicador: 9 };
    if (ie.toUpperCase() === "ISENTO") return { indicador: 2 };
    return { indicador: 1, ie: apenasDigitos(ie) };
}

export function montarNfe(d: Record<string, any>, agora = new Date()) {
    const dest = d.destinatario;
    const item = d.item;
    const ie = indicadorIe(dest.inscricao_estadual);
    const pix = d.pagamento?.metodo === "PIX";
    const aPrazo = d.pagamento?.metodo === "PRAZO";

    return {
        natureza_operacao: "Venda de mercadoria",
        data_emissao: dataComFuso(agora),
        tipo_documento: 1,
        local_destino: String(d.cfop).startsWith("5") ? 1 : 2,
        finalidade_emissao: 1,
        consumidor_final: 0,
        presenca_comprador: 2,
        cnpj_emitente: apenasDigitos(d.emitente.cnpj),

        nome_destinatario: dest.nome,
        cnpj_destinatario: apenasDigitos(dest.cnpj),
        indicador_inscricao_estadual_destinatario: ie.indicador,
        ...(ie.ie && { inscricao_estadual_destinatario: ie.ie }),
        logradouro_destinatario: dest.logradouro,
        numero_destinatario: dest.numero,
        ...(dest.complemento && { complemento_destinatario: dest.complemento }),
        bairro_destinatario: dest.bairro,
        municipio_destinatario: dest.municipio,
        uf_destinatario: dest.uf,
        cep_destinatario: apenasDigitos(dest.cep),
        ...(dest.email && { email_destinatario: dest.email }),

        modalidade_frete: 9,

        items: [{
            numero_item: 1,
            codigo_produto: String(item.codigo),
            descricao: item.descricao,
            cfop: String(d.cfop),
            codigo_ncm: item.ncm,
            unidade_comercial: item.unidade,
            quantidade_comercial: Number(item.quantidade),
            valor_unitario_comercial: dinheiro(item.valor_unitario),
            valor_bruto: dinheiro(item.valor_total),
            unidade_tributavel: item.unidade,
            quantidade_tributavel: Number(item.quantidade),
            valor_unitario_tributavel: dinheiro(item.valor_unitario),
            icms_origem: 0,
            icms_situacao_tributaria: "102",
            pis_situacao_tributaria: "07",
            cofins_situacao_tributaria: "07"
        }],

        formas_pagamento: [{
            indicador_pagamento: aPrazo ? 1 : 0,
            forma_pagamento: pix ? "17" : "99",
            valor_pagamento: dinheiro(d.pagamento?.valor ?? item.valor_total)
        }]
    };
}

const STATUS: Record<string, string> = {
    autorizado: "AUTORIZADA",
    processando_autorizacao: "PROCESSANDO",
    erro_autorizacao: "REJEITADA",
    denegado: "REJEITADA",
    cancelado: "CANCELADA"
};

// Retorno de GET /v2/nfe/REF (e do webhook / do DELETE de cancelamento)
export function lerRetorno(r: Record<string, any>, base: string) {
    const url = (caminho: unknown) => (caminho ? `${base}${caminho}` : null);
    return {
        status: STATUS[r?.status] ?? "PROCESSANDO",
        numero: r?.numero ? Number(r.numero) : null,
        serie: r?.serie ? Number(r.serie) : null,
        chave: r?.chave_nfe ? String(r.chave_nfe).replace(/^NFe/, "") : null,
        protocolo: r?.protocolo ? String(r.protocolo) : (r?.status === "autorizado" ? String(r?.status_sefaz ?? "100") : null),
        urlDanfe: url(r?.caminho_danfe),
        urlXml: url(r?.caminho_xml_nota_fiscal ?? r?.caminho_xml_cancelamento),
        mensagem: r?.mensagem_sefaz ? String(r.mensagem_sefaz) : null
    };
}

// Erros de validação da Focus (4xx): { mensagem, erros: [{ mensagem, campo }] }
export function mensagemDeErro(corpo: Record<string, any>): string {
    const detalhes = (corpo?.erros || []).map((e: any) => e?.mensagem).filter(Boolean);
    return [corpo?.mensagem, ...detalhes].filter(Boolean).join(" ") || "O emissor recusou a nota.";
}
