-- S.E.R.F. - Central de notificações dentro do app (sino no topo)
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 022.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Até a 022 os eventos (pedido recebido, status, mensagem, pagamento,
-- prazo, produto novo no segmento) só viravam e-mail. Agora cada evento
-- também vira uma notificação no app, em tempo real (Realtime), mesmo para
-- quem desligou os e-mails.
--
-- Como: os triggers da 020/021 chamam enfileirar_email(...). Essa função
-- passa a ser o ponto único "notificar": grava a notificação do app e,
-- se o usuário quiser e-mail, enfileira o e-mail (lógica antiga, agora em
-- enfileirar_somente_email). Nenhum trigger precisou mudar.
--
-- Agrupamento: a mesma chave do e-mail. Eventos repetidos (ex.: várias
-- mensagens na mesma conversa em 30 min, vários itens de uma compra)
-- atualizam a notificação existente (quantidade + 1, volta a "não lida").


-- ==========================================================
-- 1. TABELA
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.notificacoes (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    auth_user_id UUID NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    dados JSONB NOT NULL DEFAULT '{}'::JSONB,
    chave TEXT NOT NULL,
    quantidade INT NOT NULL DEFAULT 1,
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lida_em TIMESTAMPTZ,

    CONSTRAINT pk_notificacoes PRIMARY KEY (id),
    CONSTRAINT uq_notificacoes_chave UNIQUE (chave),
    CONSTRAINT fk_notificacoes_app_auth FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

-- Sino: as mais recentes do usuário; contador: as não lidas
CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario
    ON public.notificacoes (auth_user_id, atualizada_em DESC);
CREATE INDEX IF NOT EXISTS idx_notificacoes_nao_lidas
    ON public.notificacoes (auth_user_id) WHERE lida_em IS NULL;

ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notificacoes_select_proprias ON public.notificacoes;
CREATE POLICY notificacoes_select_proprias ON public.notificacoes
    FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notificacoes_update_proprias ON public.notificacoes;
CREATE POLICY notificacoes_update_proprias ON public.notificacoes
    FOR UPDATE TO authenticated
    USING (auth_user_id = (SELECT auth.uid()))
    WITH CHECK (auth_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notificacoes_delete_proprias ON public.notificacoes;
CREATE POLICY notificacoes_delete_proprias ON public.notificacoes
    FOR DELETE TO authenticated USING (auth_user_id = (SELECT auth.uid()));

-- O usuário só marca como lida (ou apaga); o conteúdo vem do servidor
REVOKE INSERT, UPDATE ON public.notificacoes FROM anon, authenticated;
GRANT UPDATE (lida_em) ON public.notificacoes TO authenticated;

-- Realtime: o sino atualiza sozinho (o RLS filtra por usuário)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notificacoes') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes;
    END IF;
END $$;


-- ==========================================================
-- 2. E-MAIL (lógica da 020, só com outro nome)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.enfileirar_somente_email(p_auth_user_id UUID, p_tipo TEXT, p_dados JSONB, p_chave TEXT)
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

REVOKE ALL ON FUNCTION public.enfileirar_somente_email(UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;


-- ==========================================================
-- 3. NOTIFICAR (app + e-mail). enfileirar_email vira um apelido dela,
-- para os triggers existentes continuarem iguais.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.notificar(p_auth_user_id UUID, p_tipo TEXT, p_dados JSONB, p_chave TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_auth_user_id IS NULL THEN RETURN; END IF;

    INSERT INTO public.notificacoes AS n (auth_user_id, tipo, dados, chave)
    VALUES (p_auth_user_id, p_tipo, p_dados, p_chave)
    ON CONFLICT (chave) DO UPDATE
        SET dados = CASE
                        WHEN EXCLUDED.dados ? 'itens' THEN jsonb_set(EXCLUDED.dados, '{itens}',
                            COALESCE(n.dados -> 'itens', '[]'::JSONB) || COALESCE(EXCLUDED.dados -> 'itens', '[]'::JSONB))
                        ELSE EXCLUDED.dados
                    END,
            quantidade = n.quantidade + 1,
            atualizada_em = NOW(),
            lida_em = NULL;

    PERFORM public.enfileirar_somente_email(p_auth_user_id, p_tipo, p_dados, p_chave);
END;
$$;

REVOKE ALL ON FUNCTION public.notificar(UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enfileirar_email(p_auth_user_id UUID, p_tipo TEXT, p_dados JSONB, p_chave TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.notificar(p_auth_user_id, p_tipo, p_dados, p_chave);
$$;

REVOKE ALL ON FUNCTION public.enfileirar_email(UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;


-- ==========================================================
-- 4. MARCAR TODAS COMO LIDAS (um clique no sino)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.marcar_notificacoes_lidas()
RETURNS INT
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
    WITH lidas AS (
        UPDATE public.notificacoes
           SET lida_em = NOW()
         WHERE auth_user_id = auth.uid() AND lida_em IS NULL
     RETURNING 1)
    SELECT COUNT(*)::INT FROM lidas;
$$;

REVOKE ALL ON FUNCTION public.marcar_notificacoes_lidas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_notificacoes_lidas() TO authenticated;


-- ==========================================================
-- 5. LIMPEZA: notificações lidas com mais de 90 dias
-- (chamar pelo pg_cron, junto do envio de e-mails)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.limpar_notificacoes_antigas()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    WITH apagadas AS (
        DELETE FROM public.notificacoes
         WHERE lida_em IS NOT NULL AND atualizada_em < NOW() - INTERVAL '90 days'
     RETURNING 1)
    SELECT COUNT(*)::INT FROM apagadas;
$$;

REVOKE ALL ON FUNCTION public.limpar_notificacoes_antigas() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
