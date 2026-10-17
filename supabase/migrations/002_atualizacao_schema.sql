-- S.E.R.F. - Atualização do schema: o que existe no banco real e faltava na 001
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 001_estrutura_inicial.sql e ANTES da 003.
-- Pode ser executado mais de uma vez (idempotente): no banco atual, só
-- aplica a correção do item 4; num banco novo, recria a estrutura completa.
--
-- Levantado em 16/10/2026 consultando o banco em produção.
-- Tipos de texto sem tamanho conhecido foram registrados como VARCHAR(100).


-- ==========================================================
-- 1. TABELA USUARIOS
-- ==========================================================

-- Nicho de atuação escolhido na segmentação
ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS nicho VARCHAR(100);

-- Coluna legada: duplica auth_user_id e não é usada pelo sistema.
-- Mantida apenas para refletir o banco real; candidata a remoção.
ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS auth_id UUID;


-- ==========================================================
-- 2. TABELA FORNECEDORES
-- ==========================================================

ALTER TABLE public.fornecedores
    ADD COLUMN IF NOT EXISTS nicho VARCHAR(100);


-- ==========================================================
-- 3. TABELA MENSAGENS_PEDIDOS (chat B2B do pedido)
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.mensagens_pedidos (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    id_pedido BIGINT NOT NULL,            -- Pedido ao qual a conversa pertence
    id_remetente UUID NOT NULL,           -- Usuário do Supabase Auth que enviou
    texto TEXT NOT NULL,
    lida BOOLEAN NOT NULL DEFAULT FALSE,
    data_envio TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_mensagens_pedidos PRIMARY KEY (id),

    CONSTRAINT fk_mensagens_pedidos_pedidos
        FOREIGN KEY (id_pedido)
        REFERENCES public.pedidos (id_pedido)
        ON DELETE CASCADE,

    CONSTRAINT fk_mensagens_pedidos_remetente
        FOREIGN KEY (id_remetente)
        REFERENCES auth.users (id)
        ON DELETE CASCADE,

    CONSTRAINT ck_mensagens_pedidos_texto
        CHECK (char_length(btrim(texto)) BETWEEN 1 AND 1000)
);


-- ==========================================================
-- 4. CORREÇÃO: mensagens_pedidos.id_pedido criado como UUID
-- No banco real a coluna nasceu como UUID, mas pedidos.id_pedido é
-- BIGINT: nenhuma mensagem conseguia ser gravada nem vinculada a um
-- pedido. Converte para BIGINT e cria a chave estrangeira.
-- Linhas antigas com UUID não apontam para nenhum pedido e são removidas.
-- ==========================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'mensagens_pedidos'
           AND column_name = 'id_pedido'
           AND data_type = 'uuid'
    ) THEN
        ALTER TABLE public.mensagens_pedidos ALTER COLUMN id_pedido DROP NOT NULL;
        ALTER TABLE public.mensagens_pedidos ALTER COLUMN id_pedido TYPE BIGINT USING NULL;
        DELETE FROM public.mensagens_pedidos WHERE id_pedido IS NULL;
        ALTER TABLE public.mensagens_pedidos ALTER COLUMN id_pedido SET NOT NULL;

        RAISE NOTICE 'mensagens_pedidos.id_pedido convertido de UUID para BIGINT.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'fk_mensagens_pedidos_pedidos'
    ) THEN
        ALTER TABLE public.mensagens_pedidos
            ADD CONSTRAINT fk_mensagens_pedidos_pedidos
            FOREIGN KEY (id_pedido)
            REFERENCES public.pedidos (id_pedido)
            ON DELETE CASCADE;
    END IF;
END;
$$;

-- Histórico do chat é sempre lido por pedido, em ordem de envio
CREATE INDEX IF NOT EXISTS idx_mensagens_pedidos_pedido_data
    ON public.mensagens_pedidos (id_pedido, data_envio);


-- ==========================================================
-- 5. REALTIME DO CHAT
-- ==========================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'mensagens_pedidos'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.mensagens_pedidos;
    END IF;
END;
$$;
