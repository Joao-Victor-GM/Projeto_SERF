-- S.E.R.F. - RLS da tabela produtos (catálogo)
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 006 (usa meu_id_fornecedor() da 003).
-- Pode ser executado mais de uma vez (idempotente).
--
-- Regras:
--   SELECT → empresas logadas veem os produtos ativos (catálogo);
--            o fornecedor também vê os próprios produtos inativos.
--   INSERT → apenas o fornecedor logado, sempre em nome próprio.
--   UPDATE → apenas o dono do produto; não pode transferi-lo a outro fornecedor.
--   DELETE → bloqueado (apagar removeria pedidos em cascata; use ativo = false).


ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;

-- Remove políticas antigas criadas manualmente, que conflitam com as regras abaixo
DO $$
DECLARE
    v_politica RECORD;
BEGIN
    FOR v_politica IN
        SELECT policyname
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'produtos'
           AND policyname NOT IN (
                'produtos_select_catalogo',
                'produtos_insert_fornecedor',
                'produtos_update_fornecedor'
           )
    LOOP
        EXECUTE format('DROP POLICY %I ON public.produtos', v_politica.policyname);
        RAISE NOTICE 'Política antiga removida de produtos: %', v_politica.policyname;
    END LOOP;
END;
$$;

DROP POLICY IF EXISTS produtos_select_catalogo ON public.produtos;
CREATE POLICY produtos_select_catalogo
    ON public.produtos
    FOR SELECT
    TO authenticated
    USING (
        ativo = TRUE
        OR id_fornecedor = public.meu_id_fornecedor()
    );

DROP POLICY IF EXISTS produtos_insert_fornecedor ON public.produtos;
CREATE POLICY produtos_insert_fornecedor
    ON public.produtos
    FOR INSERT
    TO authenticated
    WITH CHECK (id_fornecedor = public.meu_id_fornecedor());

DROP POLICY IF EXISTS produtos_update_fornecedor ON public.produtos;
CREATE POLICY produtos_update_fornecedor
    ON public.produtos
    FOR UPDATE
    TO authenticated
    USING (id_fornecedor = public.meu_id_fornecedor())
    WITH CHECK (id_fornecedor = public.meu_id_fornecedor());

-- O fornecedor edita os dados do produto, mas não o dono nem a data de cadastro.
-- (O desconto de estoque dos pedidos é feito pelo trigger, que ignora este GRANT.)
REVOKE UPDATE, DELETE ON public.produtos FROM anon, authenticated;
GRANT UPDATE (
    nome_produto,
    descricao,
    categoria,
    marca,
    preco_atacado,
    quantidade_minima,
    quantidade_estoque,
    ativo
) ON public.produtos TO authenticated;

NOTIFY pgrst, 'reload schema';
