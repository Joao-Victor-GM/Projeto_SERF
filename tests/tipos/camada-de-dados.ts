// Testes de TIPO (rodam no `npm run tipos:checar`, não executam nada).
// Cada @ts-expect-error é um erro que a checagem PRECISA continuar pegando:
// se um dia ela deixar passar, o tsc falha com "Unused '@ts-expect-error'".

import type { Cliente } from "../../frontend/types/globais";

declare const cliente: Cliente;

export async function exemplos() {
    // Certo: tabela, colunas e RPC existem nas migrations
    await cliente.from("cotacoes").select("id_cotacao, titulo").eq("status", "ABERTA");
    await cliente.from("produtos").update({ ncm: "10063021", ativo: false }).eq("id_produto", 1);
    await cliente.rpc("aceitar_proposta", { p_id_proposta: 1 });
    await cliente.rpc("publicar_cotacao", { p_titulo: "Chapa", p_categoria: "Outros", p_quantidade: 10 });

    // @ts-expect-error tabela que não existe
    await cliente.from("cotacao").select("*");

    // @ts-expect-error coluna que não existe num UPDATE
    await cliente.from("produtos").update({ preco: 10 }).eq("id_produto", 1);

    // @ts-expect-error coluna gerada pelo banco não vai num UPDATE
    await cliente.from("produtos").update({ id_produto: 2 }).eq("id_produto", 1);

    // @ts-expect-error RPC que não existe
    await cliente.rpc("aceitar_cotacao", { p_id: 1 });

    // @ts-expect-error argumento com nome errado
    await cliente.rpc("aceitar_proposta", { id_proposta: 1 });

    // @ts-expect-error tipo errado no argumento
    await cliente.rpc("aceitar_proposta", { p_id_proposta: "1" });

    // O resultado da RPC vem tipado
    const { data } = await cliente.rpc("publicar_cotacao", { p_titulo: "Chapa", p_categoria: "Outros", p_quantidade: 10 });
    // @ts-expect-error a cotação não tem "nome"
    data?.nome;
}
