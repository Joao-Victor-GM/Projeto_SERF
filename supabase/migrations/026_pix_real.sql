-- S.E.R.F. - Pix REAL (Mercado Pago), desligado por padrão
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 025.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Modo de pagamento (uma linha só, alterada só pelo SQL Editor):
--   SIMULADO (padrão) → tudo como na 009: nenhum dinheiro circula.
--   REAL              → Pix pelo Mercado Pago; boleto/cartão simulados e
--                       a "confirmação simulada" ficam bloqueados.
--     UPDATE public.configuracao_pagamentos SET modo = 'REAL';
--
-- Fluxo REAL (Edge Functions pix-criar e pix-webhook):
--   1. Comprador pede o Pix → pix-criar confere o pedido (preparar_pix, com
--      a sessão dele), cria a cobrança no Mercado Pago e grava o QR Code
--      (registrar_cobranca_pix, só servidor).
--   2. O banco do comprador paga → o Mercado Pago chama pix-webhook
--      (assinatura conferida) → a função CONSULTA o pagamento na API do
--      Mercado Pago (não confia no corpo da notificação) →
--      confirmar_pagamento_provedor (só servidor) marca PAGO.
--   3. Segunda camada: no modo REAL, um pagamento só vira PAGO por esse
--      caminho (trigger pagamentos_exigir_provedor).
--
-- O faturamento a prazo continua: o fornecedor aprova e, até o vencimento,
-- o comprador paga a fatura pelo mesmo Pix.


-- ==========================================================
-- 1. MODO DE PAGAMENTO
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.configuracao_pagamentos (
    id BOOLEAN NOT NULL DEFAULT TRUE,
    modo VARCHAR(10) NOT NULL DEFAULT 'SIMULADO',
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_configuracao_pagamentos PRIMARY KEY (id),
    CONSTRAINT ck_configuracao_pagamentos_unica CHECK (id),
    CONSTRAINT ck_configuracao_pagamentos_modo CHECK (modo IN ('SIMULADO', 'REAL'))
);

INSERT INTO public.configuracao_pagamentos (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.configuracao_pagamentos ENABLE ROW LEVEL SECURITY;

-- A tela precisa saber o modo (mostra Pix real ou o simulador)
DROP POLICY IF EXISTS configuracao_pagamentos_select ON public.configuracao_pagamentos;
CREATE POLICY configuracao_pagamentos_select ON public.configuracao_pagamentos
    FOR SELECT TO authenticated USING (TRUE);

REVOKE INSERT, UPDATE, DELETE ON public.configuracao_pagamentos FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.pagamentos_modo()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT modo FROM public.configuracao_pagamentos LIMIT 1), 'SIMULADO');
$$;


-- ==========================================================
-- 2. DADOS DA COBRANÇA NO PROVEDOR
-- ==========================================================

ALTER TABLE public.pagamentos ADD COLUMN IF NOT EXISTS provedor VARCHAR(20) NOT NULL DEFAULT 'SIMULADO';
ALTER TABLE public.pagamentos ADD COLUMN IF NOT EXISTS provedor_pagamento_id VARCHAR(40);
ALTER TABLE public.pagamentos ADD COLUMN IF NOT EXISTS qr_code_base64 TEXT;
-- Validade do QR Code (30 min). Separada de "vencimento": na fatura a prazo,
-- vencimento é o da fatura (dias), e o Pix para pagá-la expira antes.
ALTER TABLE public.pagamentos ADD COLUMN IF NOT EXISTS pix_expira_em TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pagamentos_provedor') THEN
        ALTER TABLE public.pagamentos ADD CONSTRAINT ck_pagamentos_provedor CHECK (provedor IN ('SIMULADO', 'MERCADO_PAGO'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pagamentos_provedor_id
    ON public.pagamentos (provedor_pagamento_id) WHERE provedor_pagamento_id IS NOT NULL;


-- ==========================================================
-- 3. MODO REAL: SÓ O PROVEDOR CONFIRMA (segunda camada)
-- confirmar_pagamento_provedor liga a marca serf.confirmacao_provedor
-- (só na própria transação) antes de gravar PAGO.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.pagamentos_exigir_provedor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.pagamentos_modo() <> 'REAL' THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'PAGO'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'PAGO')
       AND COALESCE(current_setting('serf.confirmacao_provedor', TRUE), '') <> 'sim' THEN
        RAISE EXCEPTION 'Pagamento real: a confirmação vem do banco, pelo Mercado Pago.';
    END IF;

    -- Cobrança nova que não é do provedor: só a fatura a prazo (sem dinheiro ainda)
    IF NEW.status = 'AGUARDANDO_PAGAMENTO'
       AND NEW.provedor = 'SIMULADO'
       AND NEW.metodo <> 'PRAZO'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.metodo IS DISTINCT FROM NEW.metodo
            OR OLD.codigo_pix IS DISTINCT FROM NEW.codigo_pix OR OLD.linha_digitavel IS DISTINCT FROM NEW.linha_digitavel) THEN
        RAISE EXCEPTION 'Pagamento real ativo: pague pelo Pix (Mercado Pago).';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pagamentos_exigir_provedor ON public.pagamentos;
CREATE TRIGGER trg_pagamentos_exigir_provedor
    BEFORE INSERT OR UPDATE ON public.pagamentos
    FOR EACH ROW
    EXECUTE FUNCTION public.pagamentos_exigir_provedor();

-- iniciar_pagamento (009) regrava a linha em ON CONFLICT sem tocar em
-- "provedor": uma cobrança simulada herdaria o rótulo MERCADO_PAGO. Este
-- trigger devolve a linha a SIMULADO sempre que o código/forma mudar fora
-- de registrar_cobranca_pix; no modo REAL o trigger seguinte então barra.
CREATE OR REPLACE FUNCTION public.pagamentos_provedor_coerente()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.provedor = 'MERCADO_PAGO'
       AND COALESCE(current_setting('serf.cobranca_provedor', TRUE), '') <> 'sim'
       AND (OLD.codigo_pix IS DISTINCT FROM NEW.codigo_pix OR OLD.metodo IS DISTINCT FROM NEW.metodo) THEN
        NEW.provedor := 'SIMULADO';
        NEW.provedor_pagamento_id := NULL;
        NEW.qr_code_base64 := NULL;
    END IF;
    RETURN NEW;
END;
$$;

-- Nome em ordem alfabética ANTES de trg_pagamentos_exigir_provedor:
-- normaliza primeiro, depois a regra do modo REAL avalia a linha final.
DROP TRIGGER IF EXISTS trg_pagamentos_coerencia_provedor ON public.pagamentos;
CREATE TRIGGER trg_pagamentos_coerencia_provedor
    BEFORE UPDATE ON public.pagamentos
    FOR EACH ROW
    EXECUTE FUNCTION public.pagamentos_provedor_coerente();


-- ==========================================================
-- 4. pix-criar: o que cobrar (com a sessão do COMPRADOR)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.preparar_pix(p_id_pedido BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido    public.pedidos%ROWTYPE;
    v_pagamento public.pagamentos%ROWTYPE;
    v_comprador public.usuarios%ROWTYPE;
    v_produto   TEXT;
BEGIN
    IF public.pagamentos_modo() <> 'REAL' THEN
        RAISE EXCEPTION 'O Pix real não está ativo (ambiente simulado).';
    END IF;

    SELECT * INTO v_pedido FROM public.pedidos WHERE id_pedido = p_id_pedido;

    IF NOT FOUND OR v_pedido.id_usuario IS DISTINCT FROM public.meu_id_usuario() THEN
        RAISE EXCEPTION 'Pedido não encontrado para a sua empresa.';
    END IF;

    SELECT * INTO v_pagamento FROM public.pagamentos WHERE id_pedido = p_id_pedido;

    IF FOUND AND v_pagamento.status = 'PAGO' THEN
        RAISE EXCEPTION 'Este pedido já está pago.';
    END IF;

    IF FOUND AND v_pagamento.status = 'AGUARDANDO_APROVACAO' THEN
        RAISE EXCEPTION 'O pedido de pagamento a prazo ainda está em análise pelo fornecedor.';
    END IF;

    -- Fatura a prazo aprovada pode ser paga a qualquer momento antes do vencimento
    IF NOT (v_pedido.status_pedido IN ('CONFIRMADO', 'EM_SEPARACAO')
            OR (FOUND AND v_pagamento.metodo = 'PRAZO' AND v_pagamento.status = 'AGUARDANDO_PAGAMENTO'
                AND v_pedido.status_pedido IN ('ENVIADO', 'ENTREGUE'))) THEN
        RAISE EXCEPTION 'O pagamento fica disponível depois que o fornecedor confirma o pedido.';
    END IF;

    SELECT * INTO v_comprador FROM public.usuarios WHERE id_usuario = v_pedido.id_usuario;
    SELECT nome_produto INTO v_produto FROM public.produtos WHERE id_produto = v_pedido.id_produto;

    RETURN jsonb_build_object(
        'id_pedido', v_pedido.id_pedido,
        'valor', v_pedido.valor_total,
        'descricao', left(format('S.E.R.F. pedido #%s: %s un. de %s', v_pedido.id_pedido, v_pedido.quantidade, v_produto), 200),
        'email', v_comprador.email,
        'cnpj', v_comprador.cnpj,
        'nome', v_comprador.nome_empresa,
        -- Cobrança ainda válida: reaproveita (não cria outra no provedor)
        'vigente', CASE
            WHEN FOUND AND v_pagamento.provedor = 'MERCADO_PAGO' AND v_pagamento.status = 'AGUARDANDO_PAGAMENTO'
                 AND v_pagamento.pix_expira_em > NOW() + INTERVAL '2 minutes'
            THEN to_jsonb(v_pagamento)
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.preparar_pix(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preparar_pix(BIGINT) TO authenticated;


-- ==========================================================
-- 5. pix-criar: grava a cobrança criada (só servidor)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.registrar_cobranca_pix(
    p_id_pedido BIGINT,
    p_provedor_id TEXT,
    p_codigo TEXT,
    p_qr_base64 TEXT,
    p_expira_em TIMESTAMPTZ,
    p_valor NUMERIC
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

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido % não encontrado.', p_id_pedido;
    END IF;

    IF p_valor IS DISTINCT FROM v_pedido.valor_total THEN
        RAISE EXCEPTION 'Valor da cobrança (%) diferente do pedido (%).', p_valor, v_pedido.valor_total;
    END IF;

    PERFORM set_config('serf.cobranca_provedor', 'sim', TRUE);

    INSERT INTO public.pagamentos AS pg (id_pedido, metodo, status, valor, vencimento, codigo_pix,
                                         provedor, provedor_pagamento_id, qr_code_base64, pix_expira_em, data_atualizacao)
    VALUES (p_id_pedido, 'PIX', 'AGUARDANDO_PAGAMENTO', v_pedido.valor_total, p_expira_em, p_codigo,
            'MERCADO_PAGO', p_provedor_id, p_qr_base64, p_expira_em, NOW())
    ON CONFLICT (id_pedido) DO UPDATE SET
        -- Fatura a prazo continua "a prazo" (só ganha o Pix para pagar)
        metodo = CASE WHEN pg.metodo = 'PRAZO' AND pg.status = 'AGUARDANDO_PAGAMENTO' THEN 'PRAZO' ELSE 'PIX' END,
        status = 'AGUARDANDO_PAGAMENTO',
        valor = EXCLUDED.valor,
        vencimento = CASE WHEN pg.metodo = 'PRAZO' AND pg.status = 'AGUARDANDO_PAGAMENTO' THEN pg.vencimento ELSE EXCLUDED.vencimento END,
        codigo_pix = EXCLUDED.codigo_pix,
        linha_digitavel = NULL,
        provedor = 'MERCADO_PAGO',
        provedor_pagamento_id = EXCLUDED.provedor_pagamento_id,
        qr_code_base64 = EXCLUDED.qr_code_base64,
        pix_expira_em = EXCLUDED.pix_expira_em,
        motivo_recusa = NULL,
        data_atualizacao = NOW()
     WHERE pg.status <> 'PAGO'
    RETURNING pg.* INTO v_pagamento;

    IF v_pagamento.id_pagamento IS NULL THEN
        RAISE EXCEPTION 'Este pedido já está pago.';
    END IF;

    RETURN v_pagamento;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_cobranca_pix(BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, NUMERIC) FROM PUBLIC, anon, authenticated;


-- ==========================================================
-- 6. pix-webhook: resultado CONSULTADO no provedor (só servidor)
-- Idempotente: notificações repetidas não mudam nada.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.confirmar_pagamento_provedor(
    p_provedor_id TEXT,
    p_status TEXT,
    p_valor NUMERIC
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pagamento public.pagamentos%ROWTYPE;
BEGIN
    SELECT * INTO v_pagamento FROM public.pagamentos
     WHERE provedor = 'MERCADO_PAGO' AND provedor_pagamento_id = p_provedor_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'desconhecido';            -- cobrança antiga/substituída: ignora
    END IF;

    IF v_pagamento.status = 'PAGO' THEN
        RETURN 'ja_pago';
    END IF;

    IF p_status = 'approved' THEN
        IF p_valor IS DISTINCT FROM v_pagamento.valor THEN
            RAISE EXCEPTION 'Valor pago (%) diferente do cobrado (%) no pagamento %.', p_valor, v_pagamento.valor, p_provedor_id;
        END IF;

        IF v_pagamento.status NOT IN ('AGUARDANDO_PAGAMENTO') THEN
            -- Ex.: pedido cancelado antes de o Pix compensar: registra para estorno manual
            UPDATE public.pagamentos
               SET motivo_recusa = left('Pix aprovado após o cancelamento: estornar pelo Mercado Pago.', 200),
                   data_atualizacao = NOW()
             WHERE id_pagamento = v_pagamento.id_pagamento;
            RETURN 'aprovado_apos_cancelamento';
        END IF;

        PERFORM set_config('serf.confirmacao_provedor', 'sim', TRUE);

        UPDATE public.pagamentos
           SET status = 'PAGO',
               data_pagamento = NOW(),
               data_atualizacao = NOW(),
               transacao_id = left('MP-' || p_provedor_id, 40)
         WHERE id_pagamento = v_pagamento.id_pagamento;
        RETURN 'pago';
    END IF;

    IF p_status IN ('rejected', 'cancelled', 'expired') AND v_pagamento.status = 'AGUARDANDO_PAGAMENTO' THEN
        -- Cobrança morta: o comprador gera outra (fatura a prazo continua a prazo)
        UPDATE public.pagamentos
           SET pix_expira_em = NOW(),
               -- Pix avulso: a cobrança venceu; fatura a prazo: só o QR Code
               vencimento = CASE WHEN metodo = 'PRAZO' THEN vencimento ELSE LEAST(COALESCE(vencimento, NOW()), NOW()) END,
               qr_code_base64 = NULL,
               data_atualizacao = NOW()
         WHERE id_pagamento = v_pagamento.id_pagamento;
        RETURN 'encerrado';
    END IF;

    RETURN 'sem_mudanca';                 -- pending / in_process
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_pagamento_provedor(TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
