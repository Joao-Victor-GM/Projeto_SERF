-- S.E.R.F. - Cotação reversa (o comprador publica; fornecedores propõem)
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 023.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Fluxo:
--   1. Comprador publica uma cotação: o que precisa, categoria, quantidade,
--      preço-alvo (opcional) e até quando aceita propostas (1 a 30 dias).
--   2. Fornecedores do segmento são avisados (app + e-mail, agrupado por
--      dia): quem vende produtos ativos da categoria ou acompanha o segmento.
--   3. Cada fornecedor envia UMA proposta (pode atualizar enquanto a cotação
--      estiver aberta), sempre ligada a um produto dele com estoque.
--      Um fornecedor nunca vê as propostas dos concorrentes.
--   4. O comprador aceita uma proposta → vira um PEDIDO normal (PENDENTE),
--      com o preço da proposta; as demais são recusadas. Daí em diante é o
--      fluxo de sempre (confirmação, pagamento, NF-e, envio).
--
-- Segurança: o navegador só LÊ as tabelas; toda escrita passa pelas RPCs
-- abaixo (SECURITY DEFINER), que validam quem é quem e a etapa.
--
-- Também nesta migration (pedidos_validar):
--   - pedido de proposta aceita usa o preço da proposta (lido do banco);
--   - segunda camada: depois de criado, comprador, produto, quantidade,
--     preço e proposta do pedido não mudam, nem por funções do servidor
--     (o navegador já só pode alterar status_pedido — GRANT da 003).


-- ==========================================================
-- 1. TABELAS
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.cotacoes (
    id_cotacao BIGINT GENERATED ALWAYS AS IDENTITY,
    id_usuario BIGINT NOT NULL,
    comprador_nome VARCHAR(150) NOT NULL,      -- retrato no momento da publicação
    titulo VARCHAR(150) NOT NULL,
    descricao VARCHAR(1000),
    categoria VARCHAR(100) NOT NULL,
    quantidade INTEGER NOT NULL,
    unidade VARCHAR(10) NOT NULL DEFAULT 'un.',
    preco_alvo NUMERIC(12,2),
    valida_ate TIMESTAMPTZ NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'ABERTA',
    id_proposta_aceita BIGINT,
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    encerrada_em TIMESTAMPTZ,

    CONSTRAINT pk_cotacoes PRIMARY KEY (id_cotacao),
    CONSTRAINT fk_cotacoes_usuarios FOREIGN KEY (id_usuario) REFERENCES public.usuarios (id_usuario) ON DELETE CASCADE,
    CONSTRAINT fk_cotacoes_categoria FOREIGN KEY (categoria) REFERENCES public.categorias (nome) ON UPDATE CASCADE,
    CONSTRAINT ck_cotacoes_titulo CHECK (char_length(btrim(titulo)) BETWEEN 3 AND 150),
    CONSTRAINT ck_cotacoes_quantidade CHECK (quantidade > 0),
    CONSTRAINT ck_cotacoes_unidade CHECK (unidade IN ('un.', 'kg', 't', 'L', 'm', 'm²', 'm³', 'cx', 'pct')),
    CONSTRAINT ck_cotacoes_preco_alvo CHECK (preco_alvo IS NULL OR preco_alvo > 0),
    CONSTRAINT ck_cotacoes_status CHECK (status IN ('ABERTA', 'FECHADA', 'CANCELADA'))
);

CREATE TABLE IF NOT EXISTS public.propostas (
    id_proposta BIGINT GENERATED ALWAYS AS IDENTITY,
    id_cotacao BIGINT NOT NULL,
    id_fornecedor BIGINT NOT NULL,
    id_produto BIGINT NOT NULL,
    fornecedor_nome VARCHAR(150) NOT NULL,
    produto_nome VARCHAR(150) NOT NULL,
    preco_unitario NUMERIC(12,2) NOT NULL,
    prazo_entrega_dias SMALLINT NOT NULL,
    observacao VARCHAR(500),
    status VARCHAR(10) NOT NULL DEFAULT 'ENVIADA',
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_propostas PRIMARY KEY (id_proposta),
    CONSTRAINT uq_propostas_fornecedor UNIQUE (id_cotacao, id_fornecedor),
    CONSTRAINT fk_propostas_cotacoes FOREIGN KEY (id_cotacao) REFERENCES public.cotacoes (id_cotacao) ON DELETE CASCADE,
    CONSTRAINT fk_propostas_fornecedores FOREIGN KEY (id_fornecedor) REFERENCES public.fornecedores (id_fornecedor) ON DELETE CASCADE,
    CONSTRAINT fk_propostas_produtos FOREIGN KEY (id_produto) REFERENCES public.produtos (id_produto) ON DELETE CASCADE,
    CONSTRAINT ck_propostas_preco CHECK (preco_unitario > 0),
    CONSTRAINT ck_propostas_prazo CHECK (prazo_entrega_dias BETWEEN 1 AND 365),
    CONSTRAINT ck_propostas_status CHECK (status IN ('ENVIADA', 'ACEITA', 'RECUSADA', 'RETIRADA'))
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cotacoes_proposta_aceita') THEN
        ALTER TABLE public.cotacoes ADD CONSTRAINT fk_cotacoes_proposta_aceita
            FOREIGN KEY (id_proposta_aceita) REFERENCES public.propostas (id_proposta) ON DELETE SET NULL;
    END IF;
END $$;

-- Pedido que nasceu de uma proposta aceita (no máximo um por proposta)
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS id_proposta BIGINT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pedidos_proposta') THEN
        ALTER TABLE public.pedidos ADD CONSTRAINT fk_pedidos_proposta
            FOREIGN KEY (id_proposta) REFERENCES public.propostas (id_proposta) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_pedidos_proposta') THEN
        ALTER TABLE public.pedidos ADD CONSTRAINT uq_pedidos_proposta UNIQUE (id_proposta);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cotacoes_abertas ON public.cotacoes (categoria, valida_ate) WHERE status = 'ABERTA';
CREATE INDEX IF NOT EXISTS idx_cotacoes_usuario ON public.cotacoes (id_usuario, criada_em DESC);
CREATE INDEX IF NOT EXISTS idx_propostas_fornecedor ON public.propostas (id_fornecedor);


-- ==========================================================
-- 2. LEITURA (RLS)
-- ==========================================================

-- Auxiliares sem recursão de RLS
CREATE OR REPLACE FUNCTION public.cotacao_e_minha(p_id_cotacao BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.cotacoes
                    WHERE id_cotacao = p_id_cotacao AND id_usuario = public.meu_id_usuario());
$$;

CREATE OR REPLACE FUNCTION public.propus_na_cotacao(p_id_cotacao BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.propostas
                    WHERE id_cotacao = p_id_cotacao AND id_fornecedor = public.meu_id_fornecedor());
$$;

REVOKE ALL ON FUNCTION public.cotacao_e_minha(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.propus_na_cotacao(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cotacao_e_minha(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propus_na_cotacao(BIGINT) TO authenticated;

ALTER TABLE public.cotacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.propostas ENABLE ROW LEVEL SECURITY;

-- Cotação: a própria (qualquer status), as abertas no prazo (mercado) e
-- as em que o fornecedor já propôs (para ver o desfecho)
DROP POLICY IF EXISTS cotacoes_select ON public.cotacoes;
CREATE POLICY cotacoes_select ON public.cotacoes
    FOR SELECT TO authenticated
    USING (
        id_usuario = (SELECT public.meu_id_usuario())
        OR (status = 'ABERTA' AND valida_ate > NOW())
        OR public.propus_na_cotacao(id_cotacao)
    );

-- Proposta: o fornecedor vê a própria; o comprador, as da sua cotação
DROP POLICY IF EXISTS propostas_select ON public.propostas;
CREATE POLICY propostas_select ON public.propostas
    FOR SELECT TO authenticated
    USING (
        id_fornecedor = (SELECT public.meu_id_fornecedor())
        OR public.cotacao_e_minha(id_cotacao)
    );

REVOKE INSERT, UPDATE, DELETE ON public.cotacoes FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.propostas FROM anon, authenticated;
REVOKE ALL ON public.cotacoes, public.propostas FROM anon;

-- Realtime: propostas chegando na tela do comprador
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'propostas') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.propostas;
    END IF;
END $$;


-- ==========================================================
-- 3. COMPRADOR: PUBLICAR E CANCELAR
-- ==========================================================

CREATE OR REPLACE FUNCTION public.publicar_cotacao(
    p_titulo TEXT,
    p_categoria TEXT,
    p_quantidade INT,
    p_unidade TEXT DEFAULT 'un.',
    p_descricao TEXT DEFAULT NULL,
    p_preco_alvo NUMERIC DEFAULT NULL,
    p_dias_validade INT DEFAULT 7
)
RETURNS public.cotacoes
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id_usuario BIGINT := public.meu_id_usuario();
    v_nome       TEXT;
    v_cotacao    public.cotacoes%ROWTYPE;
BEGIN
    IF v_id_usuario IS NULL THEN
        RAISE EXCEPTION 'Só empresas compradoras podem publicar cotações.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.categorias WHERE nome = p_categoria) THEN
        RAISE EXCEPTION 'Escolha um segmento da lista.';
    END IF;

    IF char_length(btrim(COALESCE(p_titulo, ''))) < 3 THEN
        RAISE EXCEPTION 'Descreva o que você precisa (pelo menos 3 letras).';
    END IF;

    IF COALESCE(p_quantidade, 0) < 1 THEN
        RAISE EXCEPTION 'Informe a quantidade.';
    END IF;

    IF COALESCE(p_dias_validade, 0) NOT BETWEEN 1 AND 30 THEN
        RAISE EXCEPTION 'A cotação fica aberta de 1 a 30 dias.';
    END IF;

    IF (SELECT COUNT(*) FROM public.cotacoes
         WHERE id_usuario = v_id_usuario AND status = 'ABERTA' AND valida_ate > NOW()) >= 20 THEN
        RAISE EXCEPTION 'Você já tem 20 cotações abertas. Feche ou cancele alguma antes de publicar outra.';
    END IF;

    SELECT nome_empresa INTO v_nome FROM public.usuarios WHERE id_usuario = v_id_usuario;

    INSERT INTO public.cotacoes (id_usuario, comprador_nome, titulo, descricao, categoria, quantidade,
                                 unidade, preco_alvo, valida_ate)
    VALUES (v_id_usuario, v_nome, btrim(p_titulo), NULLIF(btrim(p_descricao), ''), p_categoria, p_quantidade,
            COALESCE(p_unidade, 'un.'), p_preco_alvo, NOW() + make_interval(days => p_dias_validade))
    RETURNING * INTO v_cotacao;

    RETURN v_cotacao;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_cotacao(p_id_cotacao BIGINT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.cotacoes
       SET status = 'CANCELADA', encerrada_em = NOW()
     WHERE id_cotacao = p_id_cotacao
       AND id_usuario = public.meu_id_usuario()
       AND status = 'ABERTA';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cotação não encontrada ou já encerrada.';
    END IF;

    UPDATE public.propostas SET status = 'RECUSADA', atualizada_em = NOW()
     WHERE id_cotacao = p_id_cotacao AND status = 'ENVIADA';
END;
$$;


-- ==========================================================
-- 4. FORNECEDOR: ENVIAR (OU ATUALIZAR) E RETIRAR PROPOSTA
-- ==========================================================

CREATE OR REPLACE FUNCTION public.enviar_proposta(
    p_id_cotacao BIGINT,
    p_id_produto BIGINT,
    p_preco_unitario NUMERIC,
    p_prazo_entrega_dias INT,
    p_observacao TEXT DEFAULT NULL
)
RETURNS public.propostas
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id_fornecedor BIGINT := public.meu_id_fornecedor();
    v_cotacao       public.cotacoes%ROWTYPE;
    v_produto       public.produtos%ROWTYPE;
    v_nome          TEXT;
    v_proposta      public.propostas%ROWTYPE;
BEGIN
    IF v_id_fornecedor IS NULL THEN
        RAISE EXCEPTION 'Só empresas fornecedoras podem enviar propostas.';
    END IF;

    SELECT * INTO v_cotacao FROM public.cotacoes WHERE id_cotacao = p_id_cotacao FOR UPDATE;

    IF NOT FOUND OR v_cotacao.status <> 'ABERTA' OR v_cotacao.valida_ate <= NOW() THEN
        RAISE EXCEPTION 'Esta cotação não está mais recebendo propostas.';
    END IF;

    IF v_cotacao.id_usuario IS NOT DISTINCT FROM public.meu_id_usuario() THEN
        RAISE EXCEPTION 'Você não pode enviar proposta para a sua própria cotação.';
    END IF;

    SELECT * INTO v_produto FROM public.produtos WHERE id_produto = p_id_produto;

    IF NOT FOUND OR v_produto.id_fornecedor <> v_id_fornecedor THEN
        RAISE EXCEPTION 'Escolha um produto do seu catálogo.';
    END IF;

    IF NOT v_produto.ativo THEN
        RAISE EXCEPTION 'Este produto está pausado. Reative-o no catálogo para propor.';
    END IF;

    IF v_produto.quantidade_estoque < v_cotacao.quantidade THEN
        RAISE EXCEPTION 'Estoque insuficiente: o comprador precisa de % e você tem % de "%".',
            v_cotacao.quantidade, v_produto.quantidade_estoque, v_produto.nome_produto;
    END IF;

    IF COALESCE(p_preco_unitario, 0) <= 0 THEN
        RAISE EXCEPTION 'Informe o preço por unidade.';
    END IF;

    IF COALESCE(p_prazo_entrega_dias, 0) NOT BETWEEN 1 AND 365 THEN
        RAISE EXCEPTION 'O prazo de entrega vai de 1 a 365 dias.';
    END IF;

    SELECT COALESCE(nome_fantasia, razao_social) INTO v_nome FROM public.fornecedores WHERE id_fornecedor = v_id_fornecedor;

    INSERT INTO public.propostas AS p (id_cotacao, id_fornecedor, id_produto, fornecedor_nome, produto_nome,
                                       preco_unitario, prazo_entrega_dias, observacao)
    VALUES (p_id_cotacao, v_id_fornecedor, p_id_produto, v_nome, v_produto.nome_produto,
            round(p_preco_unitario, 2), p_prazo_entrega_dias, NULLIF(btrim(p_observacao), ''))
    ON CONFLICT (id_cotacao, id_fornecedor) DO UPDATE
        SET id_produto = EXCLUDED.id_produto,
            produto_nome = EXCLUDED.produto_nome,
            preco_unitario = EXCLUDED.preco_unitario,
            prazo_entrega_dias = EXCLUDED.prazo_entrega_dias,
            observacao = EXCLUDED.observacao,
            status = 'ENVIADA',
            atualizada_em = NOW()
    RETURNING * INTO v_proposta;

    RETURN v_proposta;
END;
$$;

CREATE OR REPLACE FUNCTION public.retirar_proposta(p_id_cotacao BIGINT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.propostas
       SET status = 'RETIRADA', atualizada_em = NOW()
     WHERE id_cotacao = p_id_cotacao
       AND id_fornecedor = public.meu_id_fornecedor()
       AND status = 'ENVIADA';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Não há proposta sua em aberto nesta cotação.';
    END IF;
END;
$$;


-- ==========================================================
-- 5. COMPRADOR: ACEITAR → PEDIDO
-- Aceitar é possível mesmo depois do prazo (o prazo é para RECEBER
-- propostas); só não depois de fechada ou cancelada.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.aceitar_proposta(p_id_proposta BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_proposta public.propostas%ROWTYPE;
    v_cotacao  public.cotacoes%ROWTYPE;
    v_pedido   BIGINT;
BEGIN
    SELECT * INTO v_proposta FROM public.propostas WHERE id_proposta = p_id_proposta;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proposta não encontrada.';
    END IF;

    SELECT * INTO v_cotacao FROM public.cotacoes WHERE id_cotacao = v_proposta.id_cotacao FOR UPDATE;

    IF v_cotacao.id_usuario IS DISTINCT FROM public.meu_id_usuario() THEN
        RAISE EXCEPTION 'Proposta não encontrada.';
    END IF;

    IF v_cotacao.status <> 'ABERTA' THEN
        RAISE EXCEPTION 'Esta cotação já foi encerrada.';
    END IF;

    IF v_proposta.status <> 'ENVIADA' THEN
        RAISE EXCEPTION 'Esta proposta não está mais disponível.';
    END IF;

    UPDATE public.propostas SET status = 'ACEITA', atualizada_em = NOW() WHERE id_proposta = p_id_proposta;
    UPDATE public.propostas SET status = 'RECUSADA', atualizada_em = NOW()
     WHERE id_cotacao = v_cotacao.id_cotacao AND id_proposta <> p_id_proposta AND status = 'ENVIADA';
    UPDATE public.cotacoes SET status = 'FECHADA', id_proposta_aceita = p_id_proposta, encerrada_em = NOW()
     WHERE id_cotacao = v_cotacao.id_cotacao;

    -- Pedido normal; o preço vem da proposta (pedidos_validar confere)
    INSERT INTO public.pedidos (id_usuario, id_produto, quantidade, valor_unitario, observacao, id_proposta)
    VALUES (v_cotacao.id_usuario, v_proposta.id_produto, v_cotacao.quantidade, v_proposta.preco_unitario,
            left(format('Cotação #%s aceita: %s', v_cotacao.id_cotacao, v_cotacao.titulo), 500), p_id_proposta)
    RETURNING id_pedido INTO v_pedido;

    RETURN v_pedido;
END;
$$;

REVOKE ALL ON FUNCTION public.publicar_cotacao(TEXT, TEXT, INT, TEXT, TEXT, NUMERIC, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancelar_cotacao(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enviar_proposta(BIGINT, BIGINT, NUMERIC, INT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retirar_proposta(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aceitar_proposta(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publicar_cotacao(TEXT, TEXT, INT, TEXT, TEXT, NUMERIC, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_cotacao(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_proposta(BIGINT, BIGINT, NUMERIC, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retirar_proposta(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aceitar_proposta(BIGINT) TO authenticated;


-- ==========================================================
-- 6. pedidos_validar: preço da proposta + campos imutáveis
-- (mesma função da 005, com os dois acréscimos marcados)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.pedidos_validar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_produto     RECORD;
    v_permitidos  TEXT[];
    v_proposta    RECORD;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT preco_atacado, quantidade_minima, quantidade_estoque, ativo
          INTO v_produto
          FROM public.produtos
         WHERE id_produto = NEW.id_produto;

        IF NOT FOUND OR NOT v_produto.ativo THEN
            RAISE EXCEPTION 'Produto indisponível para pedidos.';
        END IF;

        IF NEW.quantidade > v_produto.quantidade_estoque THEN
            RAISE EXCEPTION 'Estoque insuficiente: % unidades disponíveis.',
                v_produto.quantidade_estoque;
        END IF;

        IF NEW.id_proposta IS NOT NULL THEN
            -- [024] Pedido de proposta aceita: precisa bater com a proposta e a
            -- cotação (ninguém usa o preço de uma proposta em outro pedido)
            SELECT pr.preco_unitario, pr.id_produto, pr.status, c.id_usuario, c.quantidade
              INTO v_proposta
              FROM public.propostas pr JOIN public.cotacoes c ON c.id_cotacao = pr.id_cotacao
             WHERE pr.id_proposta = NEW.id_proposta;

            IF NOT FOUND OR v_proposta.status <> 'ACEITA'
               OR v_proposta.id_usuario <> NEW.id_usuario
               OR v_proposta.id_produto <> NEW.id_produto
               OR v_proposta.quantidade <> NEW.quantidade THEN
                RAISE EXCEPTION 'Pedido não corresponde à proposta aceita.';
            END IF;

            -- Quantidade da cotação vale mesmo abaixo do mínimo do catálogo
            NEW.valor_unitario := v_proposta.preco_unitario;
        ELSE
            IF NEW.quantidade < v_produto.quantidade_minima THEN
                RAISE EXCEPTION 'A quantidade mínima para este produto é % unidades.',
                    v_produto.quantidade_minima;
            END IF;

            -- O preço vem sempre do cadastro do produto, nunca do navegador.
            NEW.valor_unitario := v_produto.preco_atacado;
        END IF;

        NEW.status_pedido  := 'PENDENTE';
        NEW.data_pedido    := NOW();

        RETURN NEW;
    END IF;

    -- [024] UPDATE: o que foi combinado não muda depois de criado
    NEW.id_usuario     := OLD.id_usuario;
    NEW.id_produto     := OLD.id_produto;
    NEW.quantidade     := OLD.quantidade;
    NEW.valor_unitario := OLD.valor_unitario;
    NEW.id_proposta    := OLD.id_proposta;
    NEW.data_pedido    := OLD.data_pedido;

    -- UPDATE: valida a transição de status
    IF NEW.status_pedido IS DISTINCT FROM OLD.status_pedido THEN
        v_permitidos := CASE OLD.status_pedido
            WHEN 'PENDENTE'     THEN ARRAY['CONFIRMADO', 'CANCELADO']
            WHEN 'CONFIRMADO'   THEN ARRAY['EM_SEPARACAO', 'ENVIADO', 'CANCELADO']
            WHEN 'EM_SEPARACAO' THEN ARRAY['ENVIADO', 'CANCELADO']
            WHEN 'ENVIADO'      THEN ARRAY['ENTREGUE']
            ELSE ARRAY[]::TEXT[]  -- ENTREGUE e CANCELADO são finais
        END;

        IF NOT (NEW.status_pedido = ANY (v_permitidos)) THEN
            RAISE EXCEPTION 'Transição de status inválida: % → %.',
                OLD.status_pedido, NEW.status_pedido;
        END IF;

        -- Estoque: reserva ao confirmar...
        IF NEW.status_pedido = 'CONFIRMADO' THEN
            UPDATE public.produtos
               SET quantidade_estoque = quantidade_estoque - NEW.quantidade
             WHERE id_produto = NEW.id_produto
               AND quantidade_estoque >= NEW.quantidade;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Estoque insuficiente para confirmar este pedido.';
            END IF;

        -- ...e devolve se um pedido já confirmado for cancelado.
        ELSIF NEW.status_pedido = 'CANCELADO'
              AND OLD.status_pedido IN ('CONFIRMADO', 'EM_SEPARACAO') THEN
            UPDATE public.produtos
               SET quantidade_estoque = quantidade_estoque + NEW.quantidade
             WHERE id_produto = NEW.id_produto;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


-- ==========================================================
-- 7. AVISOS (app + e-mail, via notificar() da 023)
-- ==========================================================

ALTER TABLE public.notificacoes_email DROP CONSTRAINT IF EXISTS ck_notificacoes_tipo;
ALTER TABLE public.notificacoes_email ADD CONSTRAINT ck_notificacoes_tipo CHECK (tipo IN (
    'PEDIDO_RECEBIDO', 'STATUS_PEDIDO', 'PEDIDO_CANCELADO',
    'MENSAGEM_NOVA', 'PAGAMENTO_CONFIRMADO', 'PRAZO_SOLICITADO',
    'NOVO_PRODUTO_SEGMENTO', 'COTACAO_NOVA', 'PROPOSTA_RECEBIDA'
));

-- Cotação nova → fornecedores do segmento: vendem produto ativo da
-- categoria OU marcaram o segmento no radar. 1 aviso por segmento por dia.
CREATE OR REPLACE FUNCTION public.cotacoes_notificar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_comprador_uid UUID;
    v_item          JSONB;
    v_destino       RECORD;
BEGIN
    BEGIN
        SELECT auth_user_id INTO v_comprador_uid FROM public.usuarios WHERE id_usuario = NEW.id_usuario;

        v_item := jsonb_build_object(
            'id_cotacao', NEW.id_cotacao, 'comprador', NEW.comprador_nome, 'titulo', NEW.titulo,
            'quantidade', NEW.quantidade, 'unidade', NEW.unidade, 'preco_alvo', NEW.preco_alvo,
            'valida_ate', NEW.valida_ate);

        FOR v_destino IN
            SELECT DISTINCT f.auth_user_id
              FROM public.fornecedores f
             WHERE f.auth_user_id IS NOT NULL
               AND f.auth_user_id IS DISTINCT FROM v_comprador_uid
               AND (EXISTS (SELECT 1 FROM public.produtos p
                             WHERE p.id_fornecedor = f.id_fornecedor AND p.ativo AND p.categoria = NEW.categoria)
                    OR EXISTS (SELECT 1 FROM public.segmentos_interesse s
                                WHERE s.auth_user_id = f.auth_user_id AND s.categoria = NEW.categoria))
        LOOP
            PERFORM public.notificar(v_destino.auth_user_id, 'COTACAO_NOVA',
                jsonb_build_object('categoria', NEW.categoria, 'itens', jsonb_build_array(v_item)),
                'cotacao-' || v_destino.auth_user_id || '-' || md5(NEW.categoria) || '-' ||
                    to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'));
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[SERF] Aviso da cotação % não enviado: %', NEW.id_cotacao, SQLERRM;
    END;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cotacoes_notificar ON public.cotacoes;
CREATE TRIGGER trg_cotacoes_notificar
    AFTER INSERT ON public.cotacoes
    FOR EACH ROW
    EXECUTE FUNCTION public.cotacoes_notificar();

-- Proposta nova ou atualizada → comprador (agrupa por cotação e dia)
CREATE OR REPLACE FUNCTION public.propostas_notificar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cotacao RECORD;
BEGIN
    IF NEW.status <> 'ENVIADA' THEN RETURN NULL; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'ENVIADA'
       AND NEW.preco_unitario = OLD.preco_unitario AND NEW.prazo_entrega_dias = OLD.prazo_entrega_dias THEN
        RETURN NULL;
    END IF;

    BEGIN
        SELECT c.titulo, u.auth_user_id INTO v_cotacao
          FROM public.cotacoes c JOIN public.usuarios u ON u.id_usuario = c.id_usuario
         WHERE c.id_cotacao = NEW.id_cotacao;

        PERFORM public.notificar(v_cotacao.auth_user_id, 'PROPOSTA_RECEBIDA',
            jsonb_build_object('id_cotacao', NEW.id_cotacao, 'titulo', v_cotacao.titulo,
                               'fornecedor', NEW.fornecedor_nome, 'produto', NEW.produto_nome,
                               'preco_unitario', NEW.preco_unitario, 'prazo_entrega_dias', NEW.prazo_entrega_dias),
            'proposta-' || NEW.id_cotacao || '-' || to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'));
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[SERF] Aviso da proposta % não enviado: %', NEW.id_proposta, SQLERRM;
    END;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_propostas_notificar ON public.propostas;
CREATE TRIGGER trg_propostas_notificar
    AFTER INSERT OR UPDATE ON public.propostas
    FOR EACH ROW
    EXECUTE FUNCTION public.propostas_notificar();

NOTIFY pgrst, 'reload schema';
