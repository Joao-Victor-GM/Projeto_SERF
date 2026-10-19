// Regras da homologação por CNPJ: funções puras (sem rede, sem banco).
// Testadas em tests/unit/homologacao.test.mjs (Node remove os tipos).

export type Status = "APROVADO" | "PENDENTE" | "REPROVADO";

export interface DadosReceita {
    razao_social?: string;
    descricao_situacao_cadastral?: string;
}

export interface Avaliacao {
    status: Status;
    motivo: string;
}

export function normalizarCnpj(cnpj: string): string {
    return String(cnpj || "").replace(/\D/g, "");
}

// Sufixos societários e pontuação não contam na comparação de nomes
const SUFIXOS = /\b(LTDA|LIMITADA|S\s?A|S\s?\/\s?A|ME|EPP|EIRELI|MEI|SLU|CIA|COMPANHIA)\b/g;

export function normalizarNome(nome: string): string {
    return String(nome || "")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toUpperCase()
        .replace(/[.\-/,&]/g, " ")
        .replace(SUFIXOS, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// receita = null: CNPJ não encontrado na Receita
export function avaliarCnpj(razaoSocialCadastrada: string, receita: DadosReceita | null): Avaliacao {
    if (!receita) {
        return { status: "REPROVADO", motivo: "CNPJ não encontrado na Receita Federal." };
    }

    const situacao = String(receita.descricao_situacao_cadastral || "").toUpperCase();
    if (situacao !== "ATIVA") {
        return {
            status: "REPROVADO",
            motivo: `Situação na Receita Federal: ${situacao ? situacao.toLowerCase() : "desconhecida"}. Só CNPJs ativos são homologados.`
        };
    }

    if (normalizarNome(razaoSocialCadastrada) === normalizarNome(receita.razao_social || "")) {
        return { status: "APROVADO", motivo: "CNPJ ativo e razão social conferida na Receita Federal." };
    }

    return {
        status: "PENDENTE",
        motivo: `CNPJ ativo, mas a razão social cadastrada ("${razaoSocialCadastrada}") é diferente da Receita ` +
            `("${receita.razao_social}"). Corrija o cadastro ou aguarde a análise da equipe S.E.R.F.`
    };
}

// Status de fornecedor → status equivalente na tabela de compradores (usuarios)
export function statusDoComprador(status: Status): string {
    return { APROVADO: "APROVADA", REPROVADO: "REPROVADA", PENDENTE: "PENDENTE_VALIDACAO" }[status];
}
