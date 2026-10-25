// Logo da empresa (migration 031): cada empresa só aponta para o próprio
// arquivo no bucket "logos"; as views públicas mostram o logo e continuam
// só leitura.

import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBanco, como, erroDe, criarEmpresa, lerComoAdmin } from "./banco.mjs";

const URL_LOGO = uid => `https://rparlqdgcwzoanpqqeof.supabase.co/storage/v1/object/public/logos/${uid}/logo?v=1761400000000`;

test("a empresa grava o próprio logo e ele aparece nas views públicas", async () => {
    const db = await criarBanco();
    const fornecedor = await criarEmpresa(db, "Fornecedor");
    const comprador = await criarEmpresa(db, "Comprador");

    await como(db, fornecedor, "UPDATE fornecedores SET logo_url = $1 WHERE id_fornecedor = $2", [URL_LOGO(fornecedor.uid), fornecedor.idFornecedor]);
    await como(db, comprador, "UPDATE usuarios SET logo_url = $1 WHERE id_usuario = $2", [URL_LOGO(comprador.uid), comprador.idUsuario]);

    const [publico] = await como(db, comprador, "SELECT logo_url FROM fornecedores_publicos WHERE id_fornecedor = $1", [fornecedor.idFornecedor]);
    const [vitrine] = await como(db, comprador, "SELECT logo_url FROM fornecedores_vitrine WHERE id_fornecedor = $1", [fornecedor.idFornecedor]);
    assert.equal(publico.logo_url, URL_LOGO(fornecedor.uid));
    assert.equal(vitrine.logo_url, URL_LOGO(fornecedor.uid));

    // Remover o logo
    await como(db, fornecedor, "UPDATE fornecedores SET logo_url = NULL WHERE id_fornecedor = $1", [fornecedor.idFornecedor]);
});

test("não dá para usar o logo de outra empresa nem imagem de fora", async () => {
    const db = await criarBanco();
    const golpista = await criarEmpresa(db, "Fornecedor");
    const vitima = await criarEmpresa(db, "Fornecedor");
    const gravar = url => erroDe(db, golpista, "UPDATE fornecedores SET logo_url = $1 WHERE id_fornecedor = $2", [url, golpista.idFornecedor]);

    assert.match(await gravar(URL_LOGO(vitima.uid)), /ck_fornecedores_logo_url/);
    assert.match(await gravar(`https://site-falso.com/storage/v1/object/public/logos/${golpista.uid}/logo`), /ck_fornecedores_logo_url/);
    assert.match(await gravar(`https://x.supabase.co/storage/v1/object/public/logos/${golpista.uid}/logo?v=1");background:url(x`), /ck_fornecedores_logo_url/);
});

test("não dá para trocar o logo do cadastro de outra empresa", async () => {
    const db = await criarBanco();
    const golpista = await criarEmpresa(db, "Fornecedor");
    const vitima = await criarEmpresa(db, "Fornecedor");

    // O RLS esconde a linha da outra empresa: o UPDATE não altera nada
    await como(db, golpista, "UPDATE fornecedores SET logo_url = NULL WHERE id_fornecedor = $1", [vitima.idFornecedor]);
    await lerComoAdmin(db, "UPDATE fornecedores SET logo_url = $1 WHERE id_fornecedor = $2", [URL_LOGO(vitima.uid), vitima.idFornecedor]);
    await como(db, golpista, "UPDATE fornecedores SET logo_url = NULL WHERE id_fornecedor = $1", [vitima.idFornecedor]);

    const [linha] = await lerComoAdmin(db, "SELECT logo_url FROM fornecedores WHERE id_fornecedor = $1", [vitima.idFornecedor]);
    assert.equal(linha.logo_url, URL_LOGO(vitima.uid));
});

test("a coluna nova não abre escrita em outras colunas", async () => {
    const db = await criarBanco();
    const fornecedor = await criarEmpresa(db, "Fornecedor");
    assert.match(await erroDe(db, fornecedor, "UPDATE fornecedores SET status_cadastro = 'APROVADO' WHERE id_fornecedor = $1", [fornecedor.idFornecedor]),
        /permission denied|permissão negada/i);
});
