-- S.E.R.F. - Login seguro por CNPJ e RLS das tabelas de empresas
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 002_pedidos_fluxo_rls.sql (usa as funções
-- meu_id_fornecedor() e fornecedor_do_produto() criadas nela).
--
-- O que este script faz:
--   1. Função RPC obter_email_por_cnpj: o login deixa de ler as tabelas.
--   2. RLS em usuarios: cada empresa lê/edita apenas o próprio cadastro
--      (o fornecedor também lê o nome dos compradores dos seus pedidos).
--   3. RLS em fornecedores: leitura só para usuários logados (catálogo);
--      escrita apenas no próprio cadastro.
--
-- Pode ser executado mais de uma vez (idempotente).
-- ATENÇÃO: políticas antigas com outros nomes (ex.: "Enable read access
-- for all users") continuam valendo e são combinadas com OR.
-- Remova-as em Authentication → Policies, senão os dados seguem expostos.


-- ==========================================================
-- 1. LOGIN POR CNPJ
-- Devolve somente o e-mail; nenhuma outra coluna é exposta.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.obter_email_por_cnpj(p_cnpj TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT email
    FROM (
        SELECT email, 1 AS ordem
          FROM public.usuarios
         WHERE cnpj = regexp_replace(p_cnpj, '\D', '', 'g')
        UNION ALL
        SELECT email, 2 AS ordem
          FROM public.fornecedores
         WHERE cnpj = regexp_replace(p_cnpj, '\D', '', 'g')
    ) AS encontrados
    ORDER BY ordem
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.obter_email_por_cnpj(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obter_email_por_cnpj(TEXT) TO anon, authenticated;


-- ==========================================================
-- 2. RLS DA TABELA USUARIOS (compradores)
-- ==========================================================

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuarios_select_proprio ON public.usuarios;
CREATE POLICY usuarios_select_proprio
    ON public.usuarios
    FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid());

-- O fornecedor vê o nome dos compradores que fizeram pedidos dos seus produtos
DROP POLICY IF EXISTS usuarios_select_compradores_dos_meus_pedidos ON public.usuarios;
CREATE POLICY usuarios_select_compradores_dos_meus_pedidos
    ON public.usuarios
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.pedidos p
             WHERE p.id_usuario = usuarios.id_usuario
               AND public.fornecedor_do_produto(p.id_produto) = public.meu_id_fornecedor()
        )
    );

-- Cadastro (app-v2.js) e segmentação (segmentacao.html)
DROP POLICY IF EXISTS usuarios_insert_proprio ON public.usuarios;
CREATE POLICY usuarios_insert_proprio
    ON public.usuarios
    FOR INSERT
    TO authenticated
    WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS usuarios_update_proprio ON public.usuarios;
CREATE POLICY usuarios_update_proprio
    ON public.usuarios
    FOR UPDATE
    TO authenticated
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS usuarios_delete_proprio ON public.usuarios;
CREATE POLICY usuarios_delete_proprio
    ON public.usuarios
    FOR DELETE
    TO authenticated
    USING (auth_user_id = auth.uid());


-- ==========================================================
-- 3. RLS DA TABELA FORNECEDORES
-- ==========================================================

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;

-- Catálogo B2B: empresas logadas veem os fornecedores
DROP POLICY IF EXISTS fornecedores_select_autenticados ON public.fornecedores;
CREATE POLICY fornecedores_select_autenticados
    ON public.fornecedores
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS fornecedores_insert_proprio ON public.fornecedores;
CREATE POLICY fornecedores_insert_proprio
    ON public.fornecedores
    FOR INSERT
    TO authenticated
    WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS fornecedores_update_proprio ON public.fornecedores;
CREATE POLICY fornecedores_update_proprio
    ON public.fornecedores
    FOR UPDATE
    TO authenticated
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid());
