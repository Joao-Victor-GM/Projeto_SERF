-- S.E.R.F. - Posse do CNPJ ("identidade verificada")
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 028.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Antes: qualquer um cadastrava qualquer CNPJ (os dados da Receita são
-- públicos) e o primeiro a chegar "ocupava" o CNPJ — o dono de verdade não
-- conseguia mais se cadastrar. O selo "homologado" só conferia se o CNPJ
-- existe, não se a pessoa é da empresa.
--
-- Agora:
--   1. Prova de posse: um código de 6 dígitos vai para o E-MAIL QUE A
--      RECEITA TEM DO CNPJ (Edge Function verificar-cnpj); quem digita o
--      código controla o e-mail oficial da empresa. O banco guarda só o
--      HASH do código; validade de 30 min, 5 tentativas, limite de envios.
--   2. CNPJ único só entre empresas VERIFICADAS: o dono verifica e fica com
--      o CNPJ mesmo que alguém o tenha cadastrado antes; quem ocupava perde
--      a carência e não consegue mais verificar.
--   3. Vender (receber pedido, enviar proposta) exige identidade verificada.
--      Contas que já existiam ganham 30 dias de carência.
--   4. Selo "homologado" = CNPJ ativo na Receita E posse comprovada.
--
-- Modo (configuracao_identidade.modo, só pelo SQL Editor):
--   DEMONSTRACAO (padrão) → o código aparece na tela, com aviso. Para
--                           apresentações: não envia e-mail a empresas reais.
--   REAL                  → o código vai só para o e-mail da Receita.
--     UPDATE public.configuracao_identidade SET modo = 'REAL';


-- ==========================================================
-- 1. MODO
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.configuracao_identidade (
    id BOOLEAN NOT NULL DEFAULT TRUE,
    modo VARCHAR(12) NOT NULL DEFAULT 'DEMONSTRACAO',

    CONSTRAINT pk_configuracao_identidade PRIMARY KEY (id),
    CONSTRAINT ck_configuracao_identidade_unica CHECK (id),
    CONSTRAINT ck_configuracao_identidade_modo CHECK (modo IN ('DEMONSTRACAO', 'REAL'))
);

INSERT INTO public.configuracao_identidade (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.configuracao_identidade ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS configuracao_identidade_select ON public.configuracao_identidade;
CREATE POLICY configuracao_identidade_select ON public.configuracao_identidade FOR SELECT TO authenticated USING (TRUE);
REVOKE ALL ON public.configuracao_identidade FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.configuracao_identidade FROM authenticated;


-- ==========================================================
-- 2. IDENTIDADE DE CADA CONTA
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.identidade_empresas (
    auth_user_id UUID NOT NULL,
    cnpj VARCHAR(14) NOT NULL,
    verificada_em TIMESTAMPTZ,
    metodo VARCHAR(20),
    carencia_ate TIMESTAMPTZ,             -- contas anteriores à 029: 30 dias para verificar
    contestada_em TIMESTAMPTZ,            -- o dono verdadeiro verificou este CNPJ em outra conta
    -- Código em andamento (só o hash; o navegador nunca lê estas colunas)
    codigo_hash CHAR(64),
    codigo_expira_em TIMESTAMPTZ,
    tentativas SMALLINT NOT NULL DEFAULT 0,
    email_destino VARCHAR(160),           -- já mascarado: j***@empresa.com.br
    envios JSONB NOT NULL DEFAULT '[]'::JSONB,   -- horários dos últimos envios (limite)

    CONSTRAINT pk_identidade_empresas PRIMARY KEY (auth_user_id),
    CONSTRAINT fk_identidade_auth FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT ck_identidade_cnpj CHECK (cnpj ~ '^[0-9]{14}$'),
    CONSTRAINT ck_identidade_metodo CHECK (metodo IS NULL OR metodo IN ('EMAIL_RECEITA', 'DEMONSTRACAO', 'MANUAL', 'CERTIFICADO', 'TESTE'))
);

-- Um CNPJ só pode estar VERIFICADO em uma conta
CREATE UNIQUE INDEX IF NOT EXISTS uq_identidade_cnpj_verificado
    ON public.identidade_empresas (cnpj) WHERE verificada_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_identidade_cnpj ON public.identidade_empresas (cnpj);

ALTER TABLE public.identidade_empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS identidade_select_propria ON public.identidade_empresas;
CREATE POLICY identidade_select_propria ON public.identidade_empresas
    FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.uid()));

-- Leitura só das colunas de situação (nunca o hash do código)
REVOKE ALL ON public.identidade_empresas FROM anon, authenticated;
GRANT SELECT (auth_user_id, cnpj, verificada_em, metodo, carencia_ate, contestada_em, codigo_expira_em, tentativas, email_destino)
    ON public.identidade_empresas TO authenticated;

-- Contas que já existem: uma linha por login, com 30 dias de carência
INSERT INTO public.identidade_empresas (auth_user_id, cnpj, carencia_ate)
SELECT DISTINCT ON (e.auth_user_id) e.auth_user_id, e.cnpj, NOW() + INTERVAL '30 days'
  FROM (SELECT auth_user_id, cnpj FROM public.usuarios WHERE auth_user_id IS NOT NULL
        UNION ALL
        SELECT auth_user_id, cnpj FROM public.fornecedores WHERE auth_user_id IS NOT NULL) e
 WHERE e.cnpj ~ '^[0-9]{14}$'
ON CONFLICT (auth_user_id) DO NOTHING;


-- ==========================================================
-- 3. CNPJ ÚNICO SÓ ENTRE VERIFICADOS
-- (antes: UNIQUE em usuarios.cnpj e fornecedores.cnpj — o primeiro a
-- cadastrar travava o CNPJ para sempre)
-- ==========================================================

ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_cnpj_key;
ALTER TABLE public.fornecedores DROP CONSTRAINT IF EXISTS fornecedores_cnpj_key;
CREATE INDEX IF NOT EXISTS idx_usuarios_cnpj ON public.usuarios (cnpj);
CREATE INDEX IF NOT EXISTS idx_fornecedores_cnpj ON public.fornecedores (cnpj);

CREATE OR REPLACE FUNCTION public.criar_empresa_no_cadastro()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cnpj  TEXT := regexp_replace(COALESCE(NEW.raw_user_meta_data ->> 'cnpj', ''), '\D', '', 'g');
    v_razao TEXT := NULLIF(TRIM(NEW.raw_user_meta_data ->> 'razao_social'), '');
BEGIN
    -- Contas sem dados de empresa (ex.: criadas pelo painel) são ignoradas.
    IF length(v_cnpj) <> 14 OR v_razao IS NULL THEN
        RETURN NEW;
    END IF;

    -- [029] Só recusa se o CNPJ já tem dono VERIFICADO
    IF EXISTS (SELECT 1 FROM public.identidade_empresas WHERE cnpj = v_cnpj AND verificada_em IS NOT NULL) THEN
        RAISE EXCEPTION 'CNPJ_JA_VERIFICADO';
    END IF;

    INSERT INTO public.usuarios (auth_user_id, nome_empresa, cnpj, nome_responsavel, email)
    VALUES (
        NEW.id,
        v_razao,
        v_cnpj,
        COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data ->> 'nome_responsavel'), ''), v_razao),
        NEW.email
    );

    -- [029] Conta nova: sem carência — verifica para vender
    INSERT INTO public.identidade_empresas (auth_user_id, cnpj)
    VALUES (NEW.id, v_cnpj)
    ON CONFLICT (auth_user_id) DO NOTHING;

    RETURN NEW;
END;
$$;


-- ==========================================================
-- 4. QUEM PODE VENDER
-- ==========================================================

CREATE OR REPLACE FUNCTION public.identidade_libera_venda(p_auth_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.identidade_empresas i
         WHERE i.auth_user_id = p_auth_user_id
           AND (i.verificada_em IS NOT NULL OR (i.carencia_ate > NOW() AND i.contestada_em IS NULL))
    );
$$;

REVOKE ALL ON FUNCTION public.identidade_libera_venda(UUID) FROM PUBLIC, anon, authenticated;

-- Pedido novo só para fornecedor liberado (o comprador vê o motivo)
CREATE OR REPLACE FUNCTION public.pedidos_exigir_identidade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.identidade_libera_venda(public.uid_fornecedor_do_produto(NEW.id_produto)) THEN
        RAISE EXCEPTION 'Este fornecedor ainda não comprovou a posse do CNPJ e não pode receber pedidos.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_identidade ON public.pedidos;
CREATE TRIGGER trg_pedidos_identidade
    BEFORE INSERT ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.pedidos_exigir_identidade();

-- Proposta (cotação reversa) também é venda
CREATE OR REPLACE FUNCTION public.propostas_exigir_identidade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'ENVIADA' AND NOT public.identidade_libera_venda(
        (SELECT auth_user_id FROM public.fornecedores WHERE id_fornecedor = NEW.id_fornecedor)) THEN
        RAISE EXCEPTION 'Comprove a posse do CNPJ (Perfil → Identidade da empresa) para enviar propostas.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propostas_identidade ON public.propostas;
CREATE TRIGGER trg_propostas_identidade
    BEFORE INSERT OR UPDATE ON public.propostas
    FOR EACH ROW
    EXECUTE FUNCTION public.propostas_exigir_identidade();


-- ==========================================================
-- 5. SELO "HOMOLOGADO" = Receita OK + posse comprovada
-- ==========================================================

CREATE OR REPLACE FUNCTION public.fornecedores_homologacao_exige_identidade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status_cadastro = 'APROVADO' AND OLD.status_cadastro IS DISTINCT FROM 'APROVADO'
       AND NOT EXISTS (SELECT 1 FROM public.identidade_empresas
                        WHERE auth_user_id = NEW.auth_user_id AND verificada_em IS NOT NULL) THEN
        NEW.status_cadastro := 'PENDENTE';
        NEW.homologacao_motivo := 'POSSE_PENDENTE: CNPJ ativo na Receita. Falta comprovar a posse do CNPJ (Perfil → Identidade da empresa).';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fornecedores_homologacao_identidade ON public.fornecedores;
CREATE TRIGGER trg_fornecedores_homologacao_identidade
    BEFORE UPDATE OF status_cadastro ON public.fornecedores
    FOR EACH ROW
    EXECUTE FUNCTION public.fornecedores_homologacao_exige_identidade();

-- Homologados antes da 029 (sem posse comprovada) perdem o selo até verificar
UPDATE public.fornecedores f
   SET status_cadastro = 'PENDENTE',
       homologacao_motivo = 'POSSE_PENDENTE: CNPJ ativo na Receita. Falta comprovar a posse do CNPJ (Perfil → Identidade da empresa).'
 WHERE f.status_cadastro = 'APROVADO'
   AND NOT EXISTS (SELECT 1 FROM public.identidade_empresas i
                    WHERE i.auth_user_id = f.auth_user_id AND i.verificada_em IS NOT NULL);


-- ==========================================================
-- 6. CÓDIGO: registrar (só servidor) e confirmar (usuário)
-- ==========================================================

ALTER TABLE public.notificacoes_email DROP CONSTRAINT IF EXISTS ck_notificacoes_tipo;
ALTER TABLE public.notificacoes_email ADD CONSTRAINT ck_notificacoes_tipo CHECK (tipo IN (
    'PEDIDO_RECEBIDO', 'STATUS_PEDIDO', 'PEDIDO_CANCELADO',
    'MENSAGEM_NOVA', 'PAGAMENTO_CONFIRMADO', 'PRAZO_SOLICITADO',
    'NOVO_PRODUTO_SEGMENTO', 'COTACAO_NOVA', 'PROPOSTA_RECEBIDA',
    'VERIFICACAO_CNPJ'
));

-- Hash do código: sha256(código + id da conta), em hexadecimal.
-- A Edge Function calcula igual (supabase/functions/verificar-cnpj/regras.ts).
CREATE OR REPLACE FUNCTION public.hash_codigo_identidade(p_codigo TEXT, p_uid UUID)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256(convert_to(p_codigo || p_uid::TEXT, 'UTF8')), 'hex');
$$;

-- Edge Function (chave de serviço): guarda o hash e respeita os limites.
-- O e-mail de destino só é guardado mascarado (para a tela mostrar).
CREATE OR REPLACE FUNCTION public.registrar_codigo_identidade(
    p_uid UUID,
    p_codigo_hash TEXT,
    p_email_mascarado TEXT
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id public.identidade_empresas%ROWTYPE;
    v_recentes INT;
BEGIN
    SELECT * INTO v_id FROM public.identidade_empresas WHERE auth_user_id = p_uid FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conta sem empresa cadastrada.';
    END IF;
    IF v_id.verificada_em IS NOT NULL THEN
        RAISE EXCEPTION 'A posse deste CNPJ já foi comprovada.';
    END IF;
    IF v_id.contestada_em IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.identidade_empresas WHERE cnpj = v_id.cnpj AND verificada_em IS NOT NULL) THEN
        RAISE EXCEPTION 'Este CNPJ já foi verificado por outra conta. Se ela não é da sua empresa, fale com o suporte.';
    END IF;

    -- No máximo 3 envios por hora
    SELECT COUNT(*) INTO v_recentes
      FROM jsonb_array_elements_text(v_id.envios) AS e(quando)
     WHERE e.quando::TIMESTAMPTZ > NOW() - INTERVAL '1 hour';
    IF v_recentes >= 3 THEN
        RAISE EXCEPTION 'Muitos códigos pedidos. Aguarde uma hora e tente de novo.';
    END IF;

    UPDATE public.identidade_empresas
       SET codigo_hash = p_codigo_hash,
           codigo_expira_em = NOW() + INTERVAL '30 minutes',
           tentativas = 0,
           email_destino = left(p_email_mascarado, 160),
           envios = (SELECT COALESCE(jsonb_agg(e), '[]'::JSONB)
                       FROM (SELECT e FROM jsonb_array_elements(v_id.envios) AS e
                              WHERE (e #>> '{}')::TIMESTAMPTZ > NOW() - INTERVAL '1 day') x)
                    || to_jsonb(NOW())
     WHERE auth_user_id = p_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_codigo_identidade(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Usuário digita o código. 5 tentativas; depois, peça outro.
-- Devolve 'verificada' | 'ja_verificada' | 'incorreto:<restantes>'.
-- Código errado NÃO levanta exceção: a exceção desfaria a transação e,
-- com ela, a contagem da tentativa (o limite deixaria de existir).
CREATE OR REPLACE FUNCTION public.confirmar_identidade(p_codigo TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_id  public.identidade_empresas%ROWTYPE;
    v_metodo TEXT;
BEGIN
    SELECT * INTO v_id FROM public.identidade_empresas WHERE auth_user_id = v_uid FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conta sem empresa cadastrada.';
    END IF;
    IF v_id.verificada_em IS NOT NULL THEN
        RETURN 'ja_verificada';
    END IF;
    IF v_id.codigo_hash IS NULL OR v_id.codigo_expira_em < NOW() THEN
        RAISE EXCEPTION 'Código expirado ou não solicitado. Peça um novo.';
    END IF;
    IF v_id.tentativas >= 5 THEN
        RAISE EXCEPTION 'Muitas tentativas erradas. Peça um novo código.';
    END IF;

    IF public.hash_codigo_identidade(btrim(COALESCE(p_codigo, '')), v_uid) <> v_id.codigo_hash THEN
        UPDATE public.identidade_empresas SET tentativas = tentativas + 1 WHERE auth_user_id = v_uid;
        RETURN 'incorreto:' || (4 - v_id.tentativas);
    END IF;

    -- Outra conta verificou este CNPJ entre o envio e agora?
    IF EXISTS (SELECT 1 FROM public.identidade_empresas WHERE cnpj = v_id.cnpj AND verificada_em IS NOT NULL) THEN
        RAISE EXCEPTION 'Este CNPJ já foi verificado por outra conta. Fale com o suporte.';
    END IF;

    SELECT CASE modo WHEN 'REAL' THEN 'EMAIL_RECEITA' ELSE 'DEMONSTRACAO' END INTO v_metodo
      FROM public.configuracao_identidade LIMIT 1;

    UPDATE public.identidade_empresas
       SET verificada_em = NOW(), metodo = v_metodo, codigo_hash = NULL, codigo_expira_em = NULL, tentativas = 0
     WHERE auth_user_id = v_uid;

    -- Quem ocupava o mesmo CNPJ perde a carência (não vende mais)
    UPDATE public.identidade_empresas
       SET contestada_em = NOW(), carencia_ate = NULL, codigo_hash = NULL
     WHERE cnpj = v_id.cnpj AND auth_user_id <> v_uid AND verificada_em IS NULL;

    -- Homologação que só esperava a posse: concede o selo agora
    UPDATE public.fornecedores
       SET status_cadastro = 'APROVADO', homologacao_motivo = 'CNPJ ativo na Receita e posse comprovada.', homologacao_em = NOW()
     WHERE auth_user_id = v_uid AND homologacao_motivo LIKE 'POSSE_PENDENTE:%';

    RETURN 'verificada';
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_identidade(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_identidade(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
