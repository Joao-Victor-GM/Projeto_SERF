-- S.E.R.F. - Desempenho do RLS, índices e limpeza de políticas antigas
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 011.
-- Pode ser executado mais de uma vez (idempotente).
--
-- O que este script faz:
--   1. Índices nas chaves estrangeiras usadas por RLS, JOINs e relatórios
--      (o PostgreSQL NÃO cria índice automático em FK).
--   2. Remove políticas criadas manualmente no painel em pedidos, usuarios
--      e fornecedores (somadas com OR, elas anulavam as regras da 003/004/005).
--   3. Reescreve as políticas de leitura sem chamar função LINHA A LINHA:
--      a lista de pedidos/produtos da empresa é calculada uma vez por
--      consulta (subconsulta não correlacionada → hashed SubPlan).
--   4. Produtos: o comprador continua vendo produtos dos seus pedidos
--      mesmo depois que o fornecedor os desativa.
--   5. Bloqueia que uma empresa "Ambos" compre o próprio produto.
--
-- Nenhuma regra de acesso fica mais permissiva: os mesmos participantes
-- continuam vendo as mesmas linhas. As funções antigas (participa_do_pedido,
-- fornecedor_do_produto) são mantidas para as RPCs e checagens de INSERT.


-- ==========================================================
-- 1. ÍNDICES
-- ==========================================================

-- Pedidos do comprador, em ordem de data (Home, Relatórios, Perfil)
CREATE INDEX IF NOT EXISTS idx_pedidos_usuario_data
    ON public.pedidos (id_usuario, data_pedido DESC);

-- Pedidos dos produtos de um fornecedor (RLS, vitrine, relatórios)
CREATE INDEX IF NOT EXISTS idx_pedidos_produto
    ON public.pedidos (id_produto);

-- Produtos de um fornecedor (RLS, "Meus Produtos", vitrine)
CREATE INDEX IF NOT EXISTS idx_produtos_fornecedor
    ON public.produtos (id_fornecedor);

-- Catálogo: produtos ativos, mais recentes primeiro
CREATE INDEX IF NOT EXISTS idx_produtos_ativos_recentes
    ON public.produtos (id_produto DESC)
    WHERE ativo;

-- Cascata ao remover um fornecedor
CREATE INDEX IF NOT EXISTS idx_favoritos_fornecedor
    ON public.favoritos_fornecedores (id_fornecedor);


-- ==========================================================
-- 2. CONJUNTOS DA EMPRESA LOGADA
-- SECURITY DEFINER: leem as tabelas sem passar pelo RLS delas,
-- evitando recursão (pedidos ↔ produtos ↔ usuarios).
-- ==========================================================

-- Produtos cadastrados pela empresa logada (papel de fornecedor)
CREATE OR REPLACE FUNCTION public.ids_meus_produtos()
RETURNS SETOF BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT pr.id_produto
      FROM public.produtos pr
     WHERE pr.id_fornecedor = public.meu_id_fornecedor();
$$;

-- Pedidos em que a empresa logada participa (comprador OU fornecedor)
CREATE OR REPLACE FUNCTION public.ids_meus_pedidos()
RETURNS SETOF BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT pe.id_pedido
      FROM public.pedidos pe
     WHERE pe.id_usuario = public.meu_id_usuario()
    UNION
    SELECT pe.id_pedido
      FROM public.pedidos pe
      JOIN public.produtos pr ON pr.id_produto = pe.id_produto
     WHERE pr.id_fornecedor = public.meu_id_fornecedor();
$$;

-- Compradores que fizeram pedidos dos produtos da empresa logada
CREATE OR REPLACE FUNCTION public.ids_meus_compradores()
RETURNS SETOF BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT pe.id_usuario
      FROM public.pedidos pe
      JOIN public.produtos pr ON pr.id_produto = pe.id_produto
     WHERE pr.id_fornecedor = public.meu_id_fornecedor();
$$;

-- Produtos que a empresa logada já comprou
CREATE OR REPLACE FUNCTION public.ids_produtos_comprados()
RETURNS SETOF BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT pe.id_produto
      FROM public.pedidos pe
     WHERE pe.id_usuario = public.meu_id_usuario();
$$;

REVOKE ALL ON FUNCTION public.ids_meus_produtos()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ids_meus_pedidos()       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ids_meus_compradores()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ids_produtos_comprados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ids_meus_produtos()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.ids_meus_pedidos()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.ids_meus_compradores()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.ids_produtos_comprados() TO authenticated;


-- ==========================================================
-- 3. LIMPEZA DE POLÍTICAS ANTIGAS
-- Mesmo padrão da 006/007: mantém só as políticas oficiais.
-- ==========================================================

DO $$
DECLARE
    v_politica RECORD;
BEGIN
    FOR v_politica IN
        SELECT tablename, policyname
          FROM pg_policies
         WHERE schemaname = 'public'
           AND (
                (tablename = 'pedidos' AND policyname NOT IN (
                    'pedidos_select_participantes',
                    'pedidos_insert_comprador',
                    'pedidos_update_fornecedor'))
             OR (tablename = 'usuarios' AND policyname NOT IN (
                    'usuarios_select_proprio',
                    'usuarios_select_compradores_dos_meus_pedidos',
                    'usuarios_update_proprio'))
             OR (tablename = 'fornecedores' AND policyname NOT IN (
                    'fornecedores_select_proprio',
                    'fornecedores_update_proprio'))
           )
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', v_politica.policyname, v_politica.tablename);
        RAISE NOTICE 'Política antiga removida de %: %', v_politica.tablename, v_politica.policyname;
    END LOOP;
END;
$$;


-- ==========================================================
-- 4. POLÍTICAS REESCRITAS (mesmas regras, sem função por linha)
-- (SELECT f()) é avaliado uma vez por consulta (initPlan).
-- ==========================================================

-- PEDIDOS
DROP POLICY IF EXISTS pedidos_select_participantes ON public.pedidos;
CREATE POLICY pedidos_select_participantes
    ON public.pedidos
    FOR SELECT
    TO authenticated
    USING (
        id_usuario = (SELECT public.meu_id_usuario())
        OR id_produto IN (SELECT public.ids_meus_produtos())
    );

DROP POLICY IF EXISTS pedidos_insert_comprador ON public.pedidos;
CREATE POLICY pedidos_insert_comprador
    ON public.pedidos
    FOR INSERT
    TO authenticated
    WITH CHECK (
        id_usuario = (SELECT public.meu_id_usuario())
        AND status_pedido = 'PENDENTE'
    );

DROP POLICY IF EXISTS pedidos_update_fornecedor ON public.pedidos;
CREATE POLICY pedidos_update_fornecedor
    ON public.pedidos
    FOR UPDATE
    TO authenticated
    USING (id_produto IN (SELECT public.ids_meus_produtos()))
    WITH CHECK (id_produto IN (SELECT public.ids_meus_produtos()));

-- USUARIOS: nome dos compradores dos meus pedidos
DROP POLICY IF EXISTS usuarios_select_compradores_dos_meus_pedidos ON public.usuarios;
CREATE POLICY usuarios_select_compradores_dos_meus_pedidos
    ON public.usuarios
    FOR SELECT
    TO authenticated
    USING (id_usuario IN (SELECT public.ids_meus_compradores()));

-- PRODUTOS: catálogo + meus produtos + produtos que já comprei
DROP POLICY IF EXISTS produtos_select_catalogo ON public.produtos;
CREATE POLICY produtos_select_catalogo
    ON public.produtos
    FOR SELECT
    TO authenticated
    USING (
        ativo = TRUE
        OR id_fornecedor = (SELECT public.meu_id_fornecedor())
        OR id_produto IN (SELECT public.ids_produtos_comprados())
    );

-- TABELAS FILHAS DO PEDIDO (chat, histórico, pagamento, NF-e)
DROP POLICY IF EXISTS mensagens_select_participantes ON public.mensagens_pedidos;
CREATE POLICY mensagens_select_participantes
    ON public.mensagens_pedidos
    FOR SELECT
    TO authenticated
    USING (id_pedido IN (SELECT public.ids_meus_pedidos()));

DROP POLICY IF EXISTS mensagens_update_lida_destinatario ON public.mensagens_pedidos;
CREATE POLICY mensagens_update_lida_destinatario
    ON public.mensagens_pedidos
    FOR UPDATE
    TO authenticated
    USING (
        id_remetente <> (SELECT auth.uid())
        AND id_pedido IN (SELECT public.ids_meus_pedidos())
    )
    WITH CHECK (
        lida = TRUE
        AND id_remetente <> (SELECT auth.uid())
    );

DROP POLICY IF EXISTS historico_select_participantes ON public.pedidos_historico_status;
CREATE POLICY historico_select_participantes
    ON public.pedidos_historico_status
    FOR SELECT
    TO authenticated
    USING (id_pedido IN (SELECT public.ids_meus_pedidos()));

DROP POLICY IF EXISTS pagamentos_select_participantes ON public.pagamentos;
CREATE POLICY pagamentos_select_participantes
    ON public.pagamentos
    FOR SELECT
    TO authenticated
    USING (id_pedido IN (SELECT public.ids_meus_pedidos()));

DROP POLICY IF EXISTS notas_select_participantes ON public.notas_fiscais;
CREATE POLICY notas_select_participantes
    ON public.notas_fiscais
    FOR SELECT
    TO authenticated
    USING (id_pedido IN (SELECT public.ids_meus_pedidos()));


-- ==========================================================
-- 5. UMA EMPRESA NÃO COMPRA O PRÓPRIO PRODUTO
-- Trigger separado (em vez de reescrever pedidos_validar pela 3ª vez).
-- Nome em ordem alfabética ANTES de trg_pedidos_datas/validar:
-- recusa o pedido antes de qualquer outra regra.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.pedidos_bloquear_autocompra()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM public.produtos pr
          JOIN public.fornecedores f ON f.id_fornecedor = pr.id_fornecedor
          JOIN public.usuarios u     ON u.id_usuario = NEW.id_usuario
         WHERE pr.id_produto = NEW.id_produto
           AND f.auth_user_id = u.auth_user_id
    ) THEN
        RAISE EXCEPTION 'Sua empresa não pode comprar um produto do próprio catálogo.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_autocompra ON public.pedidos;
CREATE TRIGGER trg_pedidos_autocompra
    BEFORE INSERT ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.pedidos_bloquear_autocompra();

NOTIFY pgrst, 'reload schema';
