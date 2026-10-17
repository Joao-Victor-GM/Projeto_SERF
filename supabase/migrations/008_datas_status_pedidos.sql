-- S.E.R.F. - Datas de cada etapa do pedido + histórico de status
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 007.
-- Pode ser executado mais de uma vez (idempotente).
--
-- O que este script faz:
--   1. Colunas de data em pedidos: atualização, resposta do fornecedor,
--      envio, entrega e cancelamento — preenchidas AUTOMATICAMENTE pelo banco.
--   2. Tabela pedidos_historico_status: cada mudança de status com data e autor.
--   3. Preenche os pedidos antigos com a melhor estimativa disponível.
--
-- Com isso os relatórios passam a medir faturamento pela data de entrega,
-- tempo médio de resposta e prazo médio de entrega.
-- O navegador continua podendo alterar SOMENTE status_pedido (GRANT da 003):
-- as datas são definidas pelo trigger e não podem ser forjadas.


-- ==========================================================
-- 1. COLUNAS DE DATA EM PEDIDOS
-- ==========================================================

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS data_atualizacao  TIMESTAMPTZ;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS data_resposta     TIMESTAMPTZ; -- 1ª resposta: confirmou ou recusou
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS data_envio        TIMESTAMPTZ;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS data_entrega      TIMESTAMPTZ;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS data_cancelamento TIMESTAMPTZ;


-- ==========================================================
-- 2. HISTÓRICO DE STATUS
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.pedidos_historico_status (
    id_historico BIGINT GENERATED ALWAYS AS IDENTITY,
    id_pedido BIGINT NOT NULL,
    status_anterior VARCHAR(30),          -- NULL na criação do pedido
    status_novo VARCHAR(30) NOT NULL,
    alterado_por UUID,                    -- usuário do Supabase Auth (NULL = sistema)
    data_alteracao TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_pedidos_historico_status PRIMARY KEY (id_historico),

    CONSTRAINT fk_historico_pedidos
        FOREIGN KEY (id_pedido)
        REFERENCES public.pedidos (id_pedido)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_historico_pedido_data
    ON public.pedidos_historico_status (id_pedido, data_alteracao);

-- Leitura pelas duas empresas do pedido; escrita somente pelo trigger.
ALTER TABLE public.pedidos_historico_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS historico_select_participantes ON public.pedidos_historico_status;
CREATE POLICY historico_select_participantes
    ON public.pedidos_historico_status
    FOR SELECT
    TO authenticated
    USING (public.participa_do_pedido(id_pedido));

REVOKE INSERT, UPDATE, DELETE ON public.pedidos_historico_status FROM anon, authenticated;


-- ==========================================================
-- 3. PEDIDOS ANTIGOS: MELHOR ESTIMATIVA
-- Antes desta migration não havia datas por etapa; usa-se a data do
-- pedido. Os relatórios avisam que esses valores são aproximados.
-- ==========================================================

UPDATE public.pedidos
   SET data_atualizacao = data_pedido
 WHERE data_atualizacao IS NULL;

UPDATE public.pedidos
   SET data_resposta = data_pedido
 WHERE data_resposta IS NULL
   AND status_pedido <> 'PENDENTE';

UPDATE public.pedidos
   SET data_envio = data_pedido
 WHERE data_envio IS NULL
   AND status_pedido IN ('ENVIADO', 'ENTREGUE');

UPDATE public.pedidos
   SET data_entrega = data_pedido
 WHERE data_entrega IS NULL
   AND status_pedido = 'ENTREGUE';

UPDATE public.pedidos
   SET data_cancelamento = data_pedido
 WHERE data_cancelamento IS NULL
   AND status_pedido = 'CANCELADO';

-- Um registro inicial de histórico para cada pedido antigo
INSERT INTO public.pedidos_historico_status (id_pedido, status_anterior, status_novo, alterado_por, data_alteracao)
SELECT p.id_pedido, NULL, p.status_pedido, NULL, p.data_pedido
  FROM public.pedidos p
 WHERE NOT EXISTS (
        SELECT 1 FROM public.pedidos_historico_status h WHERE h.id_pedido = p.id_pedido
 );

ALTER TABLE public.pedidos ALTER COLUMN data_atualizacao SET DEFAULT NOW();
ALTER TABLE public.pedidos ALTER COLUMN data_atualizacao SET NOT NULL;


-- ==========================================================
-- 4. TRIGGER: DATAS DE CADA ETAPA (BEFORE)
-- Roda antes do trg_pedidos_validar (ordem alfabética); se a transição
-- for inválida, o validar aborta a operação inteira.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.pedidos_registrar_datas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.data_atualizacao  := NOW();
        NEW.data_resposta     := NULL;
        NEW.data_envio        := NULL;
        NEW.data_entrega      := NULL;
        NEW.data_cancelamento := NULL;
        RETURN NEW;
    END IF;

    -- UPDATE: as datas nunca vêm do navegador
    NEW.data_resposta     := OLD.data_resposta;
    NEW.data_envio        := OLD.data_envio;
    NEW.data_entrega      := OLD.data_entrega;
    NEW.data_cancelamento := OLD.data_cancelamento;
    NEW.data_atualizacao  := OLD.data_atualizacao;

    IF NEW.status_pedido IS DISTINCT FROM OLD.status_pedido THEN
        NEW.data_atualizacao := NOW();

        IF OLD.status_pedido = 'PENDENTE' AND NEW.data_resposta IS NULL THEN
            NEW.data_resposta := NOW();
        END IF;

        IF NEW.status_pedido = 'ENVIADO' THEN
            NEW.data_envio := NOW();
        ELSIF NEW.status_pedido = 'ENTREGUE' THEN
            NEW.data_entrega := NOW();
            NEW.data_envio := COALESCE(NEW.data_envio, NOW());
        ELSIF NEW.status_pedido = 'CANCELADO' THEN
            NEW.data_cancelamento := NOW();
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_datas ON public.pedidos;
CREATE TRIGGER trg_pedidos_datas
    BEFORE INSERT OR UPDATE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.pedidos_registrar_datas();


-- ==========================================================
-- 5. TRIGGER: HISTÓRICO (AFTER)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.pedidos_registrar_historico()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.pedidos_historico_status (id_pedido, status_anterior, status_novo, alterado_por)
        VALUES (NEW.id_pedido, NULL, NEW.status_pedido, auth.uid());
    ELSIF NEW.status_pedido IS DISTINCT FROM OLD.status_pedido THEN
        INSERT INTO public.pedidos_historico_status (id_pedido, status_anterior, status_novo, alterado_por)
        VALUES (NEW.id_pedido, OLD.status_pedido, NEW.status_pedido, auth.uid());
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_historico ON public.pedidos;
CREATE TRIGGER trg_pedidos_historico
    AFTER INSERT OR UPDATE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.pedidos_registrar_historico();

NOTIFY pgrst, 'reload schema';
