-- S.E.R.F. - Pagamentos (SIMULADOS) dos pedidos
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 008.
-- Pode ser executado mais de uma vez (idempotente).
--
-- IMPORTANTE: nenhum dinheiro circula. Pix, boleto e cartão são simulados
-- para o projeto acadêmico; não há gateway nem dados reais de cartão
-- (só os 4 últimos dígitos e a bandeira chegam ao banco).
--
-- Fluxo:
--   1. Pedido PENDENTE → fornecedor CONFIRMA → pagamento liberado ao comprador.
--   2. Comprador escolhe: PIX | BOLETO | CARTAO | PRAZO (28/30/60 dias).
--      - PRAZO precisa da aprovação do fornecedor (análise de crédito).
--   3. Pagamento confirmado (simulação) → status PAGO.
--   4. O fornecedor só consegue marcar ENVIADO com pagamento PAGO
--      ou com o prazo aprovado.
--   5. Pedido CANCELADO → pagamento ESTORNADO (se pago) ou CANCELADO.
--
-- Segurança: o navegador NÃO grava na tabela pagamentos. Toda mudança
-- passa pelas funções abaixo (SECURITY DEFINER), que validam quem é o
-- comprador/fornecedor e a etapa do pedido.


-- ==========================================================
-- 1. TABELA PAGAMENTOS (um pagamento por pedido)
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.pagamentos (
    id_pagamento BIGINT GENERATED ALWAYS AS IDENTITY,
    id_pedido BIGINT NOT NULL,
    metodo VARCHAR(10) NOT NULL,
    status VARCHAR(25) NOT NULL DEFAULT 'AGUARDANDO_PAGAMENTO',
    valor NUMERIC(12,2) NOT NULL,
    parcelas SMALLINT NOT NULL DEFAULT 1,
    prazo_dias SMALLINT,
    vencimento TIMESTAMPTZ,
    codigo_pix TEXT,
    linha_digitavel VARCHAR(60),
    cartao_bandeira VARCHAR(20),
    cartao_final CHAR(4),
    transacao_id VARCHAR(40),
    motivo_recusa VARCHAR(200),
    data_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_atualizacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_pagamento TIMESTAMPTZ,

    CONSTRAINT pk_pagamentos PRIMARY KEY (id_pagamento),
    CONSTRAINT uq_pagamentos_pedido UNIQUE (id_pedido),

    CONSTRAINT fk_pagamentos_pedidos
        FOREIGN KEY (id_pedido)
        REFERENCES public.pedidos (id_pedido)
        ON DELETE CASCADE,

    CONSTRAINT ck_pagamentos_metodo
        CHECK (metodo IN ('PIX', 'BOLETO', 'CARTAO', 'PRAZO')),

    CONSTRAINT ck_pagamentos_status
        CHECK (status IN (
            'AGUARDANDO_APROVACAO',   -- prazo em análise pelo fornecedor
            'AGUARDANDO_PAGAMENTO',   -- cobrança gerada (vencida se vencimento < agora)
            'PAGO',
            'RECUSADO',               -- prazo recusado pelo fornecedor
            'CANCELADO',
            'ESTORNADO'
        )),

    CONSTRAINT ck_pagamentos_valor CHECK (valor > 0),
    CONSTRAINT ck_pagamentos_parcelas CHECK (parcelas BETWEEN 1 AND 12),
    CONSTRAINT ck_pagamentos_prazo CHECK (prazo_dias IS NULL OR prazo_dias IN (28, 30, 60)),
    CONSTRAINT ck_pagamentos_cartao_final CHECK (cartao_final IS NULL OR cartao_final ~ '^[0-9]{4}$')
);

ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pagamentos_select_participantes ON public.pagamentos;
CREATE POLICY pagamentos_select_participantes
    ON public.pagamentos
    FOR SELECT
    TO authenticated
    USING (public.participa_do_pedido(id_pedido));

-- Nenhuma escrita direta: só pelas funções abaixo
REVOKE INSERT, UPDATE, DELETE ON public.pagamentos FROM anon, authenticated;


-- ==========================================================
-- 2. AUXILIARES
-- ==========================================================

-- Pagamento que libera o envio: pago, ou prazo aprovado pelo fornecedor.
CREATE OR REPLACE FUNCTION public.pagamento_libera_envio(p_id_pedido BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.pagamentos
         WHERE id_pedido = p_id_pedido
           AND (
                status = 'PAGO'
                OR (metodo = 'PRAZO' AND status = 'AGUARDANDO_PAGAMENTO')
           )
    );
$$;

-- Código "copia e cola" no formato visual do Pix (SIMULADO, sem valor real)
CREATE OR REPLACE FUNCTION public.gerar_pix_simulado(p_valor NUMERIC, p_id_pedido BIGINT)
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
    SELECT '00020126580014BR.GOV.BCB.PIX0136' || gen_random_uuid()::TEXT
        || '52040000530398654' || lpad(length(to_char(p_valor, 'FM9999999990.00'))::TEXT, 2, '0')
        || to_char(p_valor, 'FM9999999990.00')
        || '5802BR5913SERF SIMULADO6011SANTO ANDRE62'
        || lpad((length('SERF' || p_id_pedido) + 4)::TEXT, 2, '0') || '05'
        || lpad(length('SERF' || p_id_pedido)::TEXT, 2, '0') || 'SERF' || p_id_pedido
        || '6304' || upper(substr(md5(random()::TEXT), 1, 4));
$$;

-- Linha digitável com 47 dígitos no formato de boleto (SIMULADA)
CREATE OR REPLACE FUNCTION public.gerar_linha_boleto_simulada(p_valor NUMERIC, p_vencimento TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    v_aleatorio TEXT := '';
    v_fator TEXT := lpad(((p_vencimento::DATE - DATE '1997-10-07') % 10000)::TEXT, 4, '0');
    v_valor TEXT := lpad((round(p_valor * 100))::BIGINT::TEXT, 10, '0');
BEGIN
    WHILE length(v_aleatorio) < 29 LOOP
        v_aleatorio := v_aleatorio || floor(random() * 10)::INT::TEXT;
    END LOOP;

    -- 00190.xxxxx xxxxx.xxxxxx xxxxx.xxxxxx D FFFFVVVVVVVVVV
    RETURN '00190.' || substr(v_aleatorio, 1, 5) || ' '
        || substr(v_aleatorio, 6, 5) || '.' || substr(v_aleatorio, 11, 6) || ' '
        || substr(v_aleatorio, 17, 5) || '.' || substr(v_aleatorio, 22, 6) || ' '
        || substr(v_aleatorio, 28, 1) || ' '
        || v_fator || v_valor;
END;
$$;


-- ==========================================================
-- 3. COMPRADOR: GERAR COBRANÇA
-- ==========================================================

CREATE OR REPLACE FUNCTION public.iniciar_pagamento(
    p_id_pedido BIGINT,
    p_metodo TEXT,
    p_parcelas INT DEFAULT 1,
    p_prazo_dias INT DEFAULT NULL
)
RETURNS public.pagamentos
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido     public.pedidos%ROWTYPE;
    v_pagamento  public.pagamentos%ROWTYPE;
    v_status     TEXT;
    v_vencimento TIMESTAMPTZ;
    v_pix        TEXT;
    v_boleto     TEXT;
    v_parcelas   INT := 1;
    v_prazo      INT := NULL;
BEGIN
    SELECT * INTO v_pedido FROM public.pedidos WHERE id_pedido = p_id_pedido;

    IF NOT FOUND OR v_pedido.id_usuario IS DISTINCT FROM public.meu_id_usuario() THEN
        RAISE EXCEPTION 'Pedido não encontrado para a sua empresa.';
    END IF;

    IF v_pedido.status_pedido NOT IN ('CONFIRMADO', 'EM_SEPARACAO') THEN
        RAISE EXCEPTION 'O pagamento fica disponível depois que o fornecedor confirma o pedido.';
    END IF;

    SELECT * INTO v_pagamento FROM public.pagamentos WHERE id_pedido = p_id_pedido FOR UPDATE;

    IF FOUND AND v_pagamento.status = 'PAGO' THEN
        RAISE EXCEPTION 'Este pedido já está pago.';
    END IF;

    IF FOUND AND v_pagamento.status = 'AGUARDANDO_APROVACAO' THEN
        RAISE EXCEPTION 'O pedido de pagamento a prazo ainda está em análise pelo fornecedor.';
    END IF;

    p_metodo := upper(p_metodo);

    IF p_metodo NOT IN ('PIX', 'BOLETO', 'CARTAO', 'PRAZO') THEN
        RAISE EXCEPTION 'Forma de pagamento inválida.';
    END IF;

    v_status := 'AGUARDANDO_PAGAMENTO';

    IF p_metodo = 'PIX' THEN
        v_vencimento := NOW() + INTERVAL '30 minutes';
        v_pix := public.gerar_pix_simulado(v_pedido.valor_total, v_pedido.id_pedido);

    ELSIF p_metodo = 'BOLETO' THEN
        v_vencimento := date_trunc('day', NOW()) + INTERVAL '3 days 23 hours 59 minutes';
        v_boleto := public.gerar_linha_boleto_simulada(v_pedido.valor_total, v_vencimento);

    ELSIF p_metodo = 'CARTAO' THEN
        IF p_parcelas IS NULL OR p_parcelas NOT BETWEEN 1 AND 12 THEN
            RAISE EXCEPTION 'Parcelamento inválido (1 a 12 vezes).';
        END IF;
        v_parcelas := p_parcelas;
        v_vencimento := NOW() + INTERVAL '15 minutes';

    ELSE -- PRAZO
        IF p_prazo_dias IS NULL OR p_prazo_dias NOT IN (28, 30, 60) THEN
            RAISE EXCEPTION 'Prazo inválido (28, 30 ou 60 dias).';
        END IF;
        v_prazo := p_prazo_dias;
        v_status := 'AGUARDANDO_APROVACAO';
        v_vencimento := NULL; -- definido na aprovação
    END IF;

    INSERT INTO public.pagamentos AS pg (
        id_pedido, metodo, status, valor, parcelas, prazo_dias, vencimento,
        codigo_pix, linha_digitavel, cartao_bandeira, cartao_final,
        transacao_id, motivo_recusa, data_atualizacao, data_pagamento
    )
    VALUES (
        v_pedido.id_pedido, p_metodo, v_status, v_pedido.valor_total, v_parcelas, v_prazo, v_vencimento,
        v_pix, v_boleto, NULL, NULL,
        NULL, NULL, NOW(), NULL
    )
    ON CONFLICT (id_pedido) DO UPDATE SET
        metodo = EXCLUDED.metodo,
        status = EXCLUDED.status,
        valor = EXCLUDED.valor,
        parcelas = EXCLUDED.parcelas,
        prazo_dias = EXCLUDED.prazo_dias,
        vencimento = EXCLUDED.vencimento,
        codigo_pix = EXCLUDED.codigo_pix,
        linha_digitavel = EXCLUDED.linha_digitavel,
        cartao_bandeira = NULL,
        cartao_final = NULL,
        transacao_id = NULL,
        motivo_recusa = NULL,
        data_atualizacao = NOW(),
        data_pagamento = NULL
    RETURNING pg.* INTO v_pagamento;

    RETURN v_pagamento;
END;
$$;


-- ==========================================================
-- 4. COMPRADOR: CONFIRMAR PAGAMENTO (simulação do gateway)
-- Cartões de teste: final 0002 = recusado; qualquer outro = aprovado.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.confirmar_pagamento_simulado(
    p_id_pedido BIGINT,
    p_cartao_final TEXT DEFAULT NULL,
    p_cartao_bandeira TEXT DEFAULT NULL
)
RETURNS public.pagamentos
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido    public.pedidos%ROWTYPE;
    v_pagamento public.pagamentos%ROWTYPE;
BEGIN
    SELECT * INTO v_pedido FROM public.pedidos WHERE id_pedido = p_id_pedido;

    IF NOT FOUND OR v_pedido.id_usuario IS DISTINCT FROM public.meu_id_usuario() THEN
        RAISE EXCEPTION 'Pedido não encontrado para a sua empresa.';
    END IF;

    IF v_pedido.status_pedido = 'CANCELADO' THEN
        RAISE EXCEPTION 'Pedido cancelado: não é possível pagar.';
    END IF;

    SELECT * INTO v_pagamento FROM public.pagamentos WHERE id_pedido = p_id_pedido FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Escolha a forma de pagamento antes de confirmar.';
    END IF;

    IF v_pagamento.status = 'PAGO' THEN
        RAISE EXCEPTION 'Este pedido já está pago.';
    END IF;

    IF v_pagamento.status <> 'AGUARDANDO_PAGAMENTO' THEN
        RAISE EXCEPTION 'Este pagamento não está aguardando confirmação.';
    END IF;

    IF v_pagamento.vencimento IS NOT NULL AND v_pagamento.vencimento < NOW() THEN
        RAISE EXCEPTION 'Esta cobrança venceu. Gere uma nova para continuar.';
    END IF;

    IF v_pagamento.metodo = 'CARTAO' THEN
        IF p_cartao_final IS NULL OR p_cartao_final !~ '^[0-9]{4}$' THEN
            RAISE EXCEPTION 'Dados do cartão incompletos.';
        END IF;

        IF p_cartao_final = '0002' THEN
            RAISE EXCEPTION 'Pagamento recusado pelo emissor do cartão (cartão de teste de recusa).';
        END IF;
    END IF;

    UPDATE public.pagamentos
       SET status = 'PAGO',
           data_pagamento = NOW(),
           data_atualizacao = NOW(),
           transacao_id = 'SERF-' || upper(substr(md5(random()::TEXT || clock_timestamp()::TEXT), 1, 12)),
           cartao_final = CASE WHEN metodo = 'CARTAO' THEN p_cartao_final END,
           cartao_bandeira = CASE WHEN metodo = 'CARTAO' THEN left(p_cartao_bandeira, 20) END
     WHERE id_pagamento = v_pagamento.id_pagamento
     RETURNING * INTO v_pagamento;

    RETURN v_pagamento;
END;
$$;


-- ==========================================================
-- 5. FORNECEDOR: APROVAR OU RECUSAR PAGAMENTO A PRAZO
-- ==========================================================

CREATE OR REPLACE FUNCTION public.responder_pagamento_prazo(
    p_id_pedido BIGINT,
    p_aprovar BOOLEAN,
    p_motivo TEXT DEFAULT NULL
)
RETURNS public.pagamentos
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido    public.pedidos%ROWTYPE;
    v_pagamento public.pagamentos%ROWTYPE;
BEGIN
    SELECT * INTO v_pedido FROM public.pedidos WHERE id_pedido = p_id_pedido;

    IF NOT FOUND OR public.fornecedor_do_produto(v_pedido.id_produto) IS DISTINCT FROM public.meu_id_fornecedor() THEN
        RAISE EXCEPTION 'Pedido não encontrado para a sua empresa.';
    END IF;

    SELECT * INTO v_pagamento FROM public.pagamentos WHERE id_pedido = p_id_pedido FOR UPDATE;

    IF NOT FOUND OR v_pagamento.status <> 'AGUARDANDO_APROVACAO' THEN
        RAISE EXCEPTION 'Não há pedido de pagamento a prazo aguardando análise.';
    END IF;

    UPDATE public.pagamentos
       SET status = CASE WHEN p_aprovar THEN 'AGUARDANDO_PAGAMENTO' ELSE 'RECUSADO' END,
           vencimento = CASE WHEN p_aprovar THEN date_trunc('day', NOW()) + (prazo_dias || ' days')::INTERVAL + INTERVAL '23 hours 59 minutes' END,
           motivo_recusa = CASE WHEN p_aprovar THEN NULL ELSE left(COALESCE(NULLIF(btrim(p_motivo), ''), 'Crédito não aprovado pelo fornecedor.'), 200) END,
           data_atualizacao = NOW()
     WHERE id_pagamento = v_pagamento.id_pagamento
     RETURNING * INTO v_pagamento;

    RETURN v_pagamento;
END;
$$;

REVOKE ALL ON FUNCTION public.iniciar_pagamento(BIGINT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirmar_pagamento_simulado(BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.responder_pagamento_prazo(BIGINT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iniciar_pagamento(BIGINT, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_pagamento_simulado(BIGINT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.responder_pagamento_prazo(BIGINT, BOOLEAN, TEXT) TO authenticated;


-- ==========================================================
-- 6. REGRAS NO PEDIDO
-- ==========================================================

-- Envio só com pagamento confirmado ou prazo aprovado (BEFORE UPDATE)
CREATE OR REPLACE FUNCTION public.pedidos_exigir_pagamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status_pedido = 'ENVIADO'
       AND OLD.status_pedido IS DISTINCT FROM 'ENVIADO'
       AND NOT public.pagamento_libera_envio(NEW.id_pedido) THEN
        RAISE EXCEPTION 'O envio é liberado após o pagamento do comprador (ou a aprovação do prazo).';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_pagamento ON public.pedidos;
CREATE TRIGGER trg_pedidos_pagamento
    BEFORE UPDATE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.pedidos_exigir_pagamento();

-- Pedido cancelado: estorna o que foi pago, cancela o resto (AFTER UPDATE)
CREATE OR REPLACE FUNCTION public.pedidos_estornar_pagamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status_pedido = 'CANCELADO' AND OLD.status_pedido IS DISTINCT FROM 'CANCELADO' THEN
        UPDATE public.pagamentos
           SET status = CASE WHEN status = 'PAGO' THEN 'ESTORNADO' ELSE 'CANCELADO' END,
               data_atualizacao = NOW()
         WHERE id_pedido = NEW.id_pedido
           AND status IN ('AGUARDANDO_APROVACAO', 'AGUARDANDO_PAGAMENTO', 'PAGO');
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_estorno ON public.pedidos;
CREATE TRIGGER trg_pedidos_estorno
    AFTER UPDATE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.pedidos_estornar_pagamento();


-- ==========================================================
-- 7. TEMPO REAL
-- ==========================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'pagamentos'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pagamentos;
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
