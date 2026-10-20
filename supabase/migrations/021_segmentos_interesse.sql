-- S.E.R.F. - Segmentos de interesse (filtro do Radar de Oportunidades)
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 020.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Cada usuário escolhe os segmentos (categorias de produto) que quer
-- acompanhar, ex.: só "Alimentos & Bebidas" ou só "Metalurgia & Usinagem".
--   - O Radar da Home mostra só oportunidades desses segmentos (o filtro
--     é aplicado no servidor, na consulta à view oportunidades).
--   - Quando um fornecedor cadastra (ou reativa) um produto de um segmento
--     acompanhado, os compradores interessados recebem um e-mail (fila da
--     020): no máximo 1 por segmento por dia, com os produtos agrupados.
-- Sem nenhum segmento escolhido, nada muda: o radar mostra tudo.


-- ==========================================================
-- 1. SEGMENTOS DE INTERESSE (cada usuário vê e altera só os seus)
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.segmentos_interesse (
    auth_user_id UUID NOT NULL DEFAULT auth.uid(),
    categoria VARCHAR(100) NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_segmentos_interesse PRIMARY KEY (auth_user_id, categoria),
    CONSTRAINT fk_segmentos_auth FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT ck_segmentos_categoria CHECK (char_length(btrim(categoria)) BETWEEN 1 AND 100)
);

-- Produto novo → quem acompanha esta categoria
CREATE INDEX IF NOT EXISTS idx_segmentos_categoria ON public.segmentos_interesse (categoria);

ALTER TABLE public.segmentos_interesse ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS segmentos_select_proprio ON public.segmentos_interesse;
CREATE POLICY segmentos_select_proprio ON public.segmentos_interesse
    FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS segmentos_insert_proprio ON public.segmentos_interesse;
CREATE POLICY segmentos_insert_proprio ON public.segmentos_interesse
    FOR INSERT TO authenticated WITH CHECK (auth_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS segmentos_delete_proprio ON public.segmentos_interesse;
CREATE POLICY segmentos_delete_proprio ON public.segmentos_interesse
    FOR DELETE TO authenticated USING (auth_user_id = (SELECT auth.uid()));

REVOKE UPDATE ON public.segmentos_interesse FROM anon, authenticated;


-- ==========================================================
-- 2. RPC definir_segmentos: troca a seleção numa transação só
-- SECURITY INVOKER: passa pelo RLS como o próprio usuário.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.definir_segmentos(p_categorias TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_limpas TEXT[];
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sessão expirada. Faça login novamente.';
    END IF;

    SELECT COALESCE(array_agg(DISTINCT btrim(c)), ARRAY[]::TEXT[])
      INTO v_limpas
      FROM unnest(COALESCE(p_categorias, ARRAY[]::TEXT[])) AS c
     WHERE NULLIF(btrim(c), '') IS NOT NULL;

    IF array_length(v_limpas, 1) > 20 THEN
        RAISE EXCEPTION 'Escolha no máximo 20 segmentos.';
    END IF;

    DELETE FROM public.segmentos_interesse
     WHERE auth_user_id = v_uid
       AND NOT (categoria = ANY (v_limpas));

    INSERT INTO public.segmentos_interesse (auth_user_id, categoria)
    SELECT v_uid, c FROM unnest(v_limpas) AS c
    ON CONFLICT (auth_user_id, categoria) DO NOTHING;

    RETURN v_limpas;
END;
$$;

REVOKE ALL ON FUNCTION public.definir_segmentos(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_segmentos(TEXT[]) TO authenticated;


-- ==========================================================
-- 3. E-MAIL: PRODUTO NOVO NO SEGMENTO ACOMPANHADO
-- ==========================================================

ALTER TABLE public.notificacoes_email DROP CONSTRAINT IF EXISTS ck_notificacoes_tipo;
ALTER TABLE public.notificacoes_email ADD CONSTRAINT ck_notificacoes_tipo CHECK (tipo IN (
    'PEDIDO_RECEBIDO', 'STATUS_PEDIDO', 'PEDIDO_CANCELADO',
    'MENSAGEM_NOVA', 'PAGAMENTO_CONFIRMADO', 'PRAZO_SOLICITADO',
    'NOVO_PRODUTO_SEGMENTO'
));

CREATE OR REPLACE FUNCTION public.produtos_notificar_segmento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_dono       UUID;
    v_fornecedor TEXT;
    v_item       JSONB;
    v_interessado RECORD;
BEGIN
    -- Só produto que acabou de ficar disponível: novo ativo, ou reativado
    IF NOT NEW.ativo
       OR NEW.categoria IS NULL
       OR NEW.quantidade_estoque < NEW.quantidade_minima
       OR (TG_OP = 'UPDATE' AND OLD.ativo) THEN
        RETURN NULL;
    END IF;

    BEGIN
        SELECT f.auth_user_id, COALESCE(f.nome_fantasia, f.razao_social)
          INTO v_dono, v_fornecedor
          FROM public.fornecedores f
         WHERE f.id_fornecedor = NEW.id_fornecedor;

        v_item := jsonb_build_object(
            'id_produto', NEW.id_produto,
            'produto', NEW.nome_produto,
            'fornecedor', v_fornecedor,
            'preco', NEW.preco_atacado,
            'quantidade_minima', NEW.quantidade_minima);

        -- Compradores (não o próprio fornecedor) que acompanham a categoria
        FOR v_interessado IN
            SELECT s.auth_user_id
              FROM public.segmentos_interesse s
             WHERE s.categoria = NEW.categoria
               AND s.auth_user_id IS DISTINCT FROM v_dono
               AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.auth_user_id = s.auth_user_id)
        LOOP
            -- 1 e-mail por segmento por dia; produtos do mesmo dia entram no mesmo e-mail
            PERFORM public.enfileirar_email(
                v_interessado.auth_user_id,
                'NOVO_PRODUTO_SEGMENTO',
                jsonb_build_object('categoria', NEW.categoria, 'itens', jsonb_build_array(v_item)),
                'segmento-' || v_interessado.auth_user_id || '-' || md5(NEW.categoria) || '-' ||
                    to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'));
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[SERF] Aviso de segmento do produto % não enfileirado: %', NEW.id_produto, SQLERRM;
    END;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_produtos_segmento ON public.produtos;
CREATE TRIGGER trg_produtos_segmento
    AFTER INSERT OR UPDATE OF ativo ON public.produtos
    FOR EACH ROW
    EXECUTE FUNCTION public.produtos_notificar_segmento();

NOTIFY pgrst, 'reload schema';
