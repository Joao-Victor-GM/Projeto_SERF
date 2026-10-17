-- S.E.R.F. - RLS do chat (mensagens_pedidos) e edição segura do perfil
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 005.
-- Pode ser executado mais de uma vez (idempotente).
--
-- O que este script faz:
--   1. Chat: só as duas empresas do pedido leem e escrevem nele.
--   2. Chat: o destinatário marca as mensagens como lidas (UPDATE só em "lida").
--   3. Perfil: cada empresa edita apenas campos não sensíveis do cadastro
--      (CNPJ, razão social e e-mail ficam bloqueados).


-- ==========================================================
-- 1. QUEM PARTICIPA DE UM PEDIDO
-- Comprador do pedido ou fornecedor do produto.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.participa_do_pedido(p_id_pedido BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.pedidos p
         WHERE p.id_pedido = p_id_pedido
           AND (
                p.id_usuario = public.meu_id_usuario()
                OR public.fornecedor_do_produto(p.id_produto) = public.meu_id_fornecedor()
           )
    );
$$;


-- ==========================================================
-- 2. RLS DA TABELA MENSAGENS_PEDIDOS
-- As políticas criadas manualmente ("SELECT e INSERT liberados") deixavam
-- qualquer usuário ler as conversas de todos os pedidos. Elas são
-- removidas aqui e substituídas pelas políticas por participante.
-- ==========================================================

ALTER TABLE public.mensagens_pedidos ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    v_politica RECORD;
BEGIN
    FOR v_politica IN
        SELECT policyname
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'mensagens_pedidos'
           AND policyname NOT IN (
                'mensagens_select_participantes',
                'mensagens_insert_participante',
                'mensagens_update_lida_destinatario'
           )
    LOOP
        EXECUTE format('DROP POLICY %I ON public.mensagens_pedidos', v_politica.policyname);
        RAISE NOTICE 'Política antiga removida de mensagens_pedidos: %', v_politica.policyname;
    END LOOP;
END;
$$;

DROP POLICY IF EXISTS mensagens_select_participantes ON public.mensagens_pedidos;
CREATE POLICY mensagens_select_participantes
    ON public.mensagens_pedidos
    FOR SELECT
    TO authenticated
    USING (public.participa_do_pedido(id_pedido));

-- Envio: participante do pedido, sempre em nome próprio
DROP POLICY IF EXISTS mensagens_insert_participante ON public.mensagens_pedidos;
CREATE POLICY mensagens_insert_participante
    ON public.mensagens_pedidos
    FOR INSERT
    TO authenticated
    WITH CHECK (
        id_remetente = auth.uid()
        AND lida = FALSE
        AND public.participa_do_pedido(id_pedido)
    );

-- Leitura confirmada: só quem RECEBEU a mensagem, e só para TRUE
DROP POLICY IF EXISTS mensagens_update_lida_destinatario ON public.mensagens_pedidos;
CREATE POLICY mensagens_update_lida_destinatario
    ON public.mensagens_pedidos
    FOR UPDATE
    TO authenticated
    USING (
        id_remetente <> auth.uid()
        AND public.participa_do_pedido(id_pedido)
    )
    WITH CHECK (
        lida = TRUE
        AND id_remetente <> auth.uid()
    );

-- O UPDATE alcança apenas a coluna "lida" (texto e remetente ficam imutáveis)
REVOKE UPDATE, DELETE ON public.mensagens_pedidos FROM anon, authenticated;
GRANT UPDATE (lida) ON public.mensagens_pedidos TO authenticated;


-- ==========================================================
-- 3. EDIÇÃO DO PERFIL: SÓ CAMPOS NÃO SENSÍVEIS
-- O RLS da 004 já limita o UPDATE ao próprio cadastro; aqui limitamos
-- as colunas. A segmentação usa RPC (SECURITY DEFINER) e não é afetada.
-- ==========================================================

REVOKE UPDATE ON public.usuarios FROM anon, authenticated;
GRANT UPDATE (nome_responsavel, telefone, nicho) ON public.usuarios TO authenticated;

REVOKE UPDATE ON public.fornecedores FROM anon, authenticated;
GRANT UPDATE (nome_fantasia, telefone, cidade, estado, nicho) ON public.fornecedores TO authenticated;
