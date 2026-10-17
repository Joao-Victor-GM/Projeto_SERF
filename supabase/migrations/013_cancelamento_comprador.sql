-- S.E.R.F. - Cancelamento do pedido pelo COMPRADOR
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 012.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Regras:
--   PENDENTE                  → o comprador cancela (motivo opcional);
--   CONFIRMADO / EM_SEPARACAO → cancela se ainda NÃO foi pago e NÃO tem
--                               NF-e autorizada (motivo obrigatório);
--   ENVIADO em diante         → não pode mais cancelar.
--
-- O comprador continua SEM permissão de UPDATE em pedidos: o cancelamento
-- passa por esta função, que valida a empresa e a etapa. Os triggers que já
-- existem fazem o resto: data_cancelamento (008), devolução do estoque (005),
-- cancelamento do pagamento (009), da NF (010) e o histórico (008).


-- ==========================================================
-- 1. MOTIVO DO CANCELAMENTO
-- Gravado apenas pela função (o GRANT de UPDATE do navegador continua
-- restrito a status_pedido).
-- ==========================================================

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(300);


-- ==========================================================
-- 2. RPC: cancelar_pedido_comprador
-- ==========================================================

CREATE OR REPLACE FUNCTION public.cancelar_pedido_comprador(p_id_pedido BIGINT, p_motivo TEXT DEFAULT NULL)
RETURNS public.pedidos
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido public.pedidos%ROWTYPE;
    v_motivo TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
    -- Trava a linha: evita corrida com o fornecedor confirmando/enviando
    SELECT * INTO v_pedido
      FROM public.pedidos
     WHERE id_pedido = p_id_pedido
       FOR UPDATE;

    IF NOT FOUND OR v_pedido.id_usuario IS DISTINCT FROM public.meu_id_usuario() THEN
        RAISE EXCEPTION 'Pedido não encontrado para a sua empresa.';
    END IF;

    IF v_pedido.status_pedido NOT IN ('PENDENTE', 'CONFIRMADO', 'EM_SEPARACAO') THEN
        RAISE EXCEPTION 'Este pedido não pode mais ser cancelado (status: %).', v_pedido.status_pedido;
    END IF;

    IF v_motivo IS NOT NULL AND char_length(v_motivo) > 300 THEN
        RAISE EXCEPTION 'O motivo deve ter no máximo 300 caracteres.';
    END IF;

    IF v_pedido.status_pedido <> 'PENDENTE' THEN
        IF v_motivo IS NULL OR char_length(v_motivo) < 10 THEN
            RAISE EXCEPTION 'Informe o motivo do cancelamento (mínimo de 10 caracteres): o fornecedor já confirmou o pedido.';
        END IF;

        IF EXISTS (SELECT 1 FROM public.pagamentos WHERE id_pedido = p_id_pedido AND status = 'PAGO') THEN
            RAISE EXCEPTION 'O pedido já foi pago: peça o cancelamento ao fornecedor pelo chat.';
        END IF;

        IF EXISTS (SELECT 1 FROM public.notas_fiscais WHERE id_pedido = p_id_pedido AND status = 'AUTORIZADA') THEN
            RAISE EXCEPTION 'O fornecedor já emitiu a NF-e: peça o cancelamento pelo chat.';
        END IF;
    END IF;

    UPDATE public.pedidos
       SET status_pedido = 'CANCELADO',
           motivo_cancelamento = v_motivo
     WHERE id_pedido = p_id_pedido
    RETURNING * INTO v_pedido;

    RETURN v_pedido;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_pedido_comprador(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido_comprador(BIGINT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
