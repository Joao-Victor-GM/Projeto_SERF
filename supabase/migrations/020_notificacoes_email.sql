-- S.E.R.F. - Notificações por e-mail (fila no banco + Edge Function)
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 019.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Padrão "outbox": triggers ENFILEIRAM o e-mail na mesma transação do evento
-- (pedido, status, mensagem, pagamento). A Edge Function enviar-emails,
-- chamada por agendamento, reserva, envia e marca como enviado.
--   - Falha ao enfileirar NUNCA desfaz o evento de negócio (só um WARNING).
--   - chave única evita duplicados; compras do carrinho viram 1 e-mail por
--     fornecedor; chat: no máximo 1 e-mail a cada 30 min por conversa.
--   - Cada empresa pode desligar os e-mails (preferencias_notificacao).
-- Agendamento e segredos: ver docs/arquitetura.md → "E-mails".


-- ==========================================================
-- 1. PREFERÊNCIAS (cada usuário edita só a própria)
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.preferencias_notificacao (
    auth_user_id UUID NOT NULL DEFAULT auth.uid(),
    receber_email BOOLEAN NOT NULL DEFAULT TRUE,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_preferencias_notificacao PRIMARY KEY (auth_user_id),
    CONSTRAINT fk_preferencias_auth FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.preferencias_notificacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS preferencias_select_proprio ON public.preferencias_notificacao;
CREATE POLICY preferencias_select_proprio ON public.preferencias_notificacao
    FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS preferencias_insert_proprio ON public.preferencias_notificacao;
CREATE POLICY preferencias_insert_proprio ON public.preferencias_notificacao
    FOR INSERT TO authenticated WITH CHECK (auth_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS preferencias_update_proprio ON public.preferencias_notificacao;
CREATE POLICY preferencias_update_proprio ON public.preferencias_notificacao
    FOR UPDATE TO authenticated
    USING (auth_user_id = (SELECT auth.uid()))
    WITH CHECK (auth_user_id = (SELECT auth.uid()));

REVOKE DELETE ON public.preferencias_notificacao FROM anon, authenticated;


-- ==========================================================
-- 2. FILA DE E-MAILS (só o servidor lê e escreve)
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.notificacoes_email (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    auth_user_id UUID NOT NULL,
    email TEXT NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    dados JSONB NOT NULL DEFAULT '{}'::JSONB,
    chave TEXT NOT NULL,
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reservada_em TIMESTAMPTZ,
    enviada_em TIMESTAMPTZ,
    tentativas SMALLINT NOT NULL DEFAULT 0,
    ultimo_erro TEXT,

    CONSTRAINT pk_notificacoes_email PRIMARY KEY (id),
    CONSTRAINT uq_notificacoes_email_chave UNIQUE (chave),
    CONSTRAINT fk_notificacoes_auth FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT ck_notificacoes_tipo CHECK (tipo IN (
        'PEDIDO_RECEBIDO', 'STATUS_PEDIDO', 'PEDIDO_CANCELADO',
        'MENSAGEM_NOVA', 'PAGAMENTO_CONFIRMADO', 'PRAZO_SOLICITADO'
    ))
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_pendentes
    ON public.notificacoes_email (criada_em)
    WHERE enviada_em IS NULL;

ALTER TABLE public.notificacoes_email ENABLE ROW LEVEL SECURITY;
-- Sem políticas: nenhum usuário lê a fila (ela contém e-mails de terceiros)
REVOKE ALL ON public.notificacoes_email FROM anon, authenticated;


-- ==========================================================
-- 3. ENFILEIRAR (respeita a preferência; dedupe pela chave)
-- itens (carrinho): e-mail ainda não enviado com a mesma chave
-- ganha os itens novos em vez de virar outro e-mail.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.enfileirar_email(p_auth_user_id UUID, p_tipo TEXT, p_dados JSONB, p_chave TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT;
BEGIN
    IF p_auth_user_id IS NULL THEN RETURN; END IF;

    IF EXISTS (SELECT 1 FROM public.preferencias_notificacao
                WHERE auth_user_id = p_auth_user_id AND NOT receber_email) THEN
        RETURN;
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = p_auth_user_id;
    IF v_email IS NULL THEN RETURN; END IF;

    INSERT INTO public.notificacoes_email AS n (auth_user_id, email, tipo, dados, chave)
    VALUES (p_auth_user_id, v_email, p_tipo, p_dados, p_chave)
    ON CONFLICT (chave) DO UPDATE
        SET dados = jsonb_set(n.dados, '{itens}',
                              COALESCE(n.dados -> 'itens', '[]'::JSONB) || COALESCE(EXCLUDED.dados -> 'itens', '[]'::JSONB))
        WHERE n.enviada_em IS NULL AND EXCLUDED.dados ? 'itens';
END;
$$;

REVOKE ALL ON FUNCTION public.enfileirar_email(UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;


-- ==========================================================
-- 4. TRIGGERS (AFTER: o evento já aconteceu)
-- ==========================================================

-- Dono do produto (auth uid do fornecedor)
CREATE OR REPLACE FUNCTION public.uid_fornecedor_do_produto(p_id_produto BIGINT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT f.auth_user_id FROM public.produtos p JOIN public.fornecedores f ON f.id_fornecedor = p.id_fornecedor
     WHERE p.id_produto = p_id_produto;
$$;
REVOKE ALL ON FUNCTION public.uid_fornecedor_do_produto(BIGINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pedidos_notificar_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_produto     TEXT;
    v_comprador   TEXT;
    v_uid_forn    UUID;
    v_uid_comp    UUID;
    v_item        JSONB;
BEGIN
    BEGIN
        SELECT nome_produto INTO v_produto FROM public.produtos WHERE id_produto = NEW.id_produto;
        SELECT nome_empresa, auth_user_id INTO v_comprador, v_uid_comp FROM public.usuarios WHERE id_usuario = NEW.id_usuario;
        v_uid_forn := public.uid_fornecedor_do_produto(NEW.id_produto);

        v_item := jsonb_build_object('id_pedido', NEW.id_pedido, 'produto', v_produto,
                                     'quantidade', NEW.quantidade, 'valor_total', NEW.valor_total);

        IF TG_OP = 'INSERT' THEN
            -- Carrinho: um e-mail por compra e fornecedor, com todos os itens
            PERFORM public.enfileirar_email(v_uid_forn, 'PEDIDO_RECEBIDO',
                jsonb_build_object('comprador', v_comprador, 'observacao', NEW.observacao, 'itens', jsonb_build_array(v_item)),
                CASE WHEN NEW.id_compra IS NOT NULL
                     THEN 'pedido-recebido-compra-' || NEW.id_compra || '-' || v_uid_forn
                     ELSE 'pedido-recebido-' || NEW.id_pedido END);

        ELSIF NEW.status_pedido IS DISTINCT FROM OLD.status_pedido THEN
            IF NEW.status_pedido = 'CANCELADO' AND NEW.motivo_cancelamento IS NOT NULL THEN
                -- Cancelado pelo comprador (só a RPC dele grava o motivo): avisa o fornecedor
                PERFORM public.enfileirar_email(v_uid_forn, 'PEDIDO_CANCELADO',
                    v_item || jsonb_build_object('comprador', v_comprador, 'motivo', NEW.motivo_cancelamento),
                    'cancelado-' || NEW.id_pedido);

            ELSIF NEW.status_pedido IN ('CONFIRMADO', 'ENVIADO', 'ENTREGUE', 'CANCELADO') THEN
                PERFORM public.enfileirar_email(v_uid_comp, 'STATUS_PEDIDO',
                    v_item || jsonb_build_object('status', NEW.status_pedido),
                    'status-' || NEW.id_pedido || '-' || NEW.status_pedido);
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[SERF] E-mail do pedido % não enfileirado: %', NEW.id_pedido, SQLERRM;
    END;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_email ON public.pedidos;
CREATE TRIGGER trg_pedidos_email
    AFTER INSERT OR UPDATE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.pedidos_notificar_email();


CREATE OR REPLACE FUNCTION public.mensagens_notificar_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid_comp UUID;
    v_uid_forn UUID;
    v_destino  UUID;
    v_nome     TEXT;
BEGIN
    BEGIN
        SELECT u.auth_user_id, public.uid_fornecedor_do_produto(p.id_produto)
          INTO v_uid_comp, v_uid_forn
          FROM public.pedidos p JOIN public.usuarios u ON u.id_usuario = p.id_usuario
         WHERE p.id_pedido = NEW.id_pedido;

        v_destino := CASE WHEN NEW.id_remetente = v_uid_comp THEN v_uid_forn ELSE v_uid_comp END;

        SELECT COALESCE(
                 (SELECT nome_empresa FROM public.usuarios WHERE auth_user_id = NEW.id_remetente),
                 (SELECT COALESCE(nome_fantasia, razao_social) FROM public.fornecedores WHERE auth_user_id = NEW.id_remetente))
          INTO v_nome;

        -- No máximo 1 e-mail a cada 30 min por conversa e destinatário
        PERFORM public.enfileirar_email(v_destino, 'MENSAGEM_NOVA',
            jsonb_build_object('id_pedido', NEW.id_pedido, 'remetente', v_nome, 'trecho', left(NEW.texto, 140)),
            'mensagem-' || NEW.id_pedido || '-' || v_destino || '-' || floor(extract(epoch FROM NEW.data_envio) / 1800));
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[SERF] E-mail da mensagem não enfileirado: %', SQLERRM;
    END;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mensagens_email ON public.mensagens_pedidos;
CREATE TRIGGER trg_mensagens_email
    AFTER INSERT ON public.mensagens_pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.mensagens_notificar_email();


CREATE OR REPLACE FUNCTION public.pagamentos_notificar_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id_produto BIGINT;
    v_comprador  TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NULL;
    END IF;

    BEGIN
        SELECT p.id_produto, u.nome_empresa INTO v_id_produto, v_comprador
          FROM public.pedidos p JOIN public.usuarios u ON u.id_usuario = p.id_usuario
         WHERE p.id_pedido = NEW.id_pedido;

        IF NEW.status = 'PAGO' THEN
            PERFORM public.enfileirar_email(public.uid_fornecedor_do_produto(v_id_produto), 'PAGAMENTO_CONFIRMADO',
                jsonb_build_object('id_pedido', NEW.id_pedido, 'valor', NEW.valor, 'metodo', NEW.metodo, 'comprador', v_comprador),
                'pago-' || NEW.id_pedido);
        ELSIF NEW.status = 'AGUARDANDO_APROVACAO' THEN
            PERFORM public.enfileirar_email(public.uid_fornecedor_do_produto(v_id_produto), 'PRAZO_SOLICITADO',
                jsonb_build_object('id_pedido', NEW.id_pedido, 'valor', NEW.valor, 'prazo_dias', NEW.prazo_dias, 'comprador', v_comprador),
                'prazo-' || NEW.id_pedido || '-' || extract(epoch FROM NEW.data_atualizacao)::BIGINT);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[SERF] E-mail do pagamento % não enfileirado: %', NEW.id_pedido, SQLERRM;
    END;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pagamentos_email ON public.pagamentos;
CREATE TRIGGER trg_pagamentos_email
    AFTER INSERT OR UPDATE ON public.pagamentos
    FOR EACH ROW
    EXECUTE FUNCTION public.pagamentos_notificar_email();


-- ==========================================================
-- 5. RESERVA PARA ENVIO (só a Edge Function, com a chave de serviço)
-- SKIP LOCKED: duas execuções simultâneas nunca pegam o mesmo e-mail.
-- Reserva vencida (10 min sem confirmação) volta para a fila.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.reservar_emails(p_limite INT DEFAULT 50)
RETURNS SETOF public.notificacoes_email
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.notificacoes_email n
       SET reservada_em = NOW()
     WHERE n.id IN (
            SELECT id FROM public.notificacoes_email
             WHERE enviada_em IS NULL
               AND tentativas < 5
               AND (reservada_em IS NULL OR reservada_em < NOW() - INTERVAL '10 minutes')
             ORDER BY criada_em
             LIMIT LEAST(GREATEST(p_limite, 1), 200)
             FOR UPDATE SKIP LOCKED)
    RETURNING n.*;
$$;

REVOKE ALL ON FUNCTION public.reservar_emails(INT) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
