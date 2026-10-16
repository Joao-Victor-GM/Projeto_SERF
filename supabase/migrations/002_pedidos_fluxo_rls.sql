-- S.E.R.F. - Fluxo de pedidos: criação pelo comprador e status pelo fornecedor
-- Banco utilizado: PostgreSQL/Supabase
--
-- O que este script faz:
--   1. Funções auxiliares que identificam a empresa logada (auth.uid()).
--   2. RLS na tabela pedidos:
--        SELECT  → comprador do pedido ou fornecedor do produto;
--        INSERT  → apenas o próprio comprador, sempre como PENDENTE;
--        UPDATE  → apenas o fornecedor do produto.
--   3. Permissão de UPDATE somente na coluna status_pedido
--      (o fornecedor não consegue alterar quantidade, preço etc.).
--   4. Trigger que valida a criação (preço, quantidade mínima, estoque)
--      e as transições de status.
--
-- Pode ser executado mais de uma vez (idempotente).
-- ATENÇÃO: políticas antigas em pedidos com outros nomes continuam valendo
-- e são combinadas com OR. Revise em Authentication → Policies e remova
-- as políticas permissivas (ex.: "Enable update for all users").


-- ==========================================================
-- 1. FUNÇÕES AUXILIARES
-- SECURITY DEFINER: consultam as tabelas sem depender do RLS
-- delas, evitando recursão e bloqueios dentro das políticas.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.meu_id_usuario()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id_usuario
    FROM public.usuarios
    WHERE auth_user_id = auth.uid()
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.meu_id_fornecedor()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id_fornecedor
    FROM public.fornecedores
    WHERE auth_user_id = auth.uid()
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fornecedor_do_produto(p_id_produto BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id_fornecedor
    FROM public.produtos
    WHERE id_produto = p_id_produto;
$$;


-- ==========================================================
-- 2. RLS DA TABELA PEDIDOS
-- ==========================================================

ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

-- Leitura: as duas empresas envolvidas no pedido
DROP POLICY IF EXISTS pedidos_select_participantes ON public.pedidos;
CREATE POLICY pedidos_select_participantes
    ON public.pedidos
    FOR SELECT
    TO authenticated
    USING (
        id_usuario = public.meu_id_usuario()
        OR public.fornecedor_do_produto(id_produto) = public.meu_id_fornecedor()
    );

-- Criação: somente em nome da própria empresa compradora, como PENDENTE
DROP POLICY IF EXISTS pedidos_insert_comprador ON public.pedidos;
CREATE POLICY pedidos_insert_comprador
    ON public.pedidos
    FOR INSERT
    TO authenticated
    WITH CHECK (
        id_usuario = public.meu_id_usuario()
        AND status_pedido = 'PENDENTE'
    );

-- Atualização de status: somente o fornecedor do produto
DROP POLICY IF EXISTS pedidos_update_fornecedor ON public.pedidos;
CREATE POLICY pedidos_update_fornecedor
    ON public.pedidos
    FOR UPDATE
    TO authenticated
    USING (
        public.fornecedor_do_produto(id_produto) = public.meu_id_fornecedor()
    )
    WITH CHECK (
        public.fornecedor_do_produto(id_produto) = public.meu_id_fornecedor()
    );

-- Sem política de DELETE: ninguém apaga pedidos pelo front-end.


-- ==========================================================
-- 3. UPDATE APENAS NA COLUNA DE STATUS
-- O RLS controla QUAIS linhas; o GRANT controla QUAIS colunas.
-- ==========================================================

REVOKE UPDATE ON public.pedidos FROM anon, authenticated;
GRANT UPDATE (status_pedido) ON public.pedidos TO authenticated;


-- ==========================================================
-- 4. VALIDAÇÕES NO BANCO (TRIGGER)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.pedidos_validar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_produto     RECORD;
    v_permitidos  TEXT[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT preco_atacado, quantidade_minima, quantidade_estoque, ativo
          INTO v_produto
          FROM public.produtos
         WHERE id_produto = NEW.id_produto;

        IF NOT FOUND OR NOT v_produto.ativo THEN
            RAISE EXCEPTION 'Produto indisponível para pedidos.';
        END IF;

        IF NEW.quantidade < v_produto.quantidade_minima THEN
            RAISE EXCEPTION 'A quantidade mínima para este produto é % unidades.',
                v_produto.quantidade_minima;
        END IF;

        IF NEW.quantidade > v_produto.quantidade_estoque THEN
            RAISE EXCEPTION 'Estoque insuficiente: % unidades disponíveis.',
                v_produto.quantidade_estoque;
        END IF;

        -- O preço vem sempre do cadastro do produto, nunca do navegador.
        NEW.valor_unitario := v_produto.preco_atacado;
        NEW.status_pedido  := 'PENDENTE';
        NEW.data_pedido    := NOW();

        RETURN NEW;
    END IF;

    -- UPDATE: valida a transição de status
    IF NEW.status_pedido IS DISTINCT FROM OLD.status_pedido THEN
        v_permitidos := CASE OLD.status_pedido
            WHEN 'PENDENTE'     THEN ARRAY['CONFIRMADO', 'CANCELADO']
            WHEN 'CONFIRMADO'   THEN ARRAY['EM_SEPARACAO', 'ENVIADO', 'CANCELADO']
            WHEN 'EM_SEPARACAO' THEN ARRAY['ENVIADO', 'CANCELADO']
            WHEN 'ENVIADO'      THEN ARRAY['ENTREGUE']
            ELSE ARRAY[]::TEXT[]  -- ENTREGUE e CANCELADO são finais
        END;

        IF NOT (NEW.status_pedido = ANY (v_permitidos)) THEN
            RAISE EXCEPTION 'Transição de status inválida: % → %.',
                OLD.status_pedido, NEW.status_pedido;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_validar ON public.pedidos;
CREATE TRIGGER trg_pedidos_validar
    BEFORE INSERT OR UPDATE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.pedidos_validar();
