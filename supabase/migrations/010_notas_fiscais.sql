-- S.E.R.F. - Nota fiscal eletrônica (SIMULADA) dos pedidos
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 009.
-- Pode ser executado mais de uma vez (idempotente).
--
-- IMPORTANTE: documento SIMULADO, SEM VALOR FISCAL. Não há comunicação com
-- a SEFAZ nem certificado digital. Emissão real de NF-e exige certificado
-- A1 da empresa e um provedor homologado (ex.: Focus NFe, NFE.io).
-- Valores de impostos exibidos são ilustrativos.
--
-- Regras (as mesmas de uma NF-e real, simplificadas):
--   1. Quem emite é o FORNECEDOR, após o pagamento (ou prazo aprovado).
--   2. Numeração sequencial por fornecedor, série 1; chave de acesso com
--      44 dígitos e dígito verificador (módulo 11).
--   3. A mercadoria só pode ser ENVIADA com NF-e autorizada.
--   4. Cancelamento em até 24 h da autorização, com justificativa de no
--      mínimo 15 caracteres; pedido cancelado antes do envio cancela a nota.
--   5. O navegador não grava na tabela: tudo passa pelas funções abaixo.


-- ==========================================================
-- 1. TABELA NOTAS_FISCAIS
-- No máximo UMA nota autorizada por pedido; notas canceladas ficam
-- registradas (o número de uma nota cancelada nunca é reaproveitado).
-- Os dados de emitente/destinatário/item são uma FOTOGRAFIA do momento
-- da emissão: alterações posteriores no cadastro não mudam a nota.
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.notas_fiscais (
    id_nota BIGINT GENERATED ALWAYS AS IDENTITY,
    id_pedido BIGINT NOT NULL,
    id_fornecedor BIGINT NOT NULL,
    numero INTEGER NOT NULL,
    serie SMALLINT NOT NULL DEFAULT 1,
    chave_acesso CHAR(44) NOT NULL,
    protocolo VARCHAR(20) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'AUTORIZADA',
    natureza_operacao VARCHAR(60) NOT NULL DEFAULT 'Venda de mercadoria',
    cfop CHAR(4) NOT NULL DEFAULT '5102',

    -- Emitente (fornecedor)
    emitente_razao_social VARCHAR(150) NOT NULL,
    emitente_cnpj VARCHAR(14) NOT NULL,
    emitente_cidade VARCHAR(100),
    emitente_uf CHAR(2),

    -- Destinatário (comprador)
    destinatario_nome VARCHAR(150) NOT NULL,
    destinatario_cnpj VARCHAR(14) NOT NULL,

    -- Item (um produto por pedido)
    produto_codigo BIGINT NOT NULL,
    produto_descricao VARCHAR(150) NOT NULL,
    quantidade INTEGER NOT NULL,
    valor_unitario NUMERIC(12,2) NOT NULL,
    valor_total NUMERIC(12,2) NOT NULL,
    aliquota_icms NUMERIC(5,2) NOT NULL DEFAULT 18.00,   -- ilustrativa
    valor_icms NUMERIC(12,2) NOT NULL,

    forma_pagamento VARCHAR(40),
    emitida_por UUID,
    data_emissao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_cancelamento TIMESTAMPTZ,
    motivo_cancelamento VARCHAR(255),

    CONSTRAINT pk_notas_fiscais PRIMARY KEY (id_nota),
    CONSTRAINT uq_notas_fiscais_numero UNIQUE (id_fornecedor, serie, numero),
    CONSTRAINT uq_notas_fiscais_chave UNIQUE (chave_acesso),

    CONSTRAINT fk_notas_pedidos
        FOREIGN KEY (id_pedido)
        REFERENCES public.pedidos (id_pedido)
        ON DELETE CASCADE,

    CONSTRAINT fk_notas_fornecedores
        FOREIGN KEY (id_fornecedor)
        REFERENCES public.fornecedores (id_fornecedor)
        ON DELETE CASCADE,

    CONSTRAINT ck_notas_status CHECK (status IN ('AUTORIZADA', 'CANCELADA')),
    CONSTRAINT ck_notas_chave CHECK (chave_acesso ~ '^[0-9]{44}$')
);

CREATE INDEX IF NOT EXISTS idx_notas_fornecedor ON public.notas_fiscais (id_fornecedor, data_emissao);
CREATE INDEX IF NOT EXISTS idx_notas_pedido ON public.notas_fiscais (id_pedido, data_emissao);

-- Uma única NF-e AUTORIZADA por pedido
CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_pedido_autorizada
    ON public.notas_fiscais (id_pedido)
    WHERE status = 'AUTORIZADA';

ALTER TABLE public.notas_fiscais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notas_select_participantes ON public.notas_fiscais;
CREATE POLICY notas_select_participantes
    ON public.notas_fiscais
    FOR SELECT
    TO authenticated
    USING (public.participa_do_pedido(id_pedido));

REVOKE INSERT, UPDATE, DELETE ON public.notas_fiscais FROM anon, authenticated;


-- ==========================================================
-- 2. CHAVE DE ACESSO (44 dígitos, DV módulo 11 — formato da NF-e)
-- cUF(2) AAMM(4) CNPJ(14) modelo 55(2) série(3) número(9)
-- tpEmis 1(1) código numérico(8) DV(1)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.gerar_chave_nfe_simulada(
    p_uf CHAR(2),
    p_cnpj TEXT,
    p_serie INT,
    p_numero INT
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    v_codigos_uf CONSTANT JSONB := '{"RO":11,"AC":12,"AM":13,"RR":14,"PA":15,"AP":16,"TO":17,"MA":21,"PI":22,"CE":23,"RN":24,"PB":25,"PE":26,"AL":27,"SE":28,"BA":29,"MG":31,"ES":32,"RJ":33,"SP":35,"PR":41,"SC":42,"RS":43,"MS":50,"MT":51,"GO":52,"DF":53}';
    v_base TEXT;
    v_soma INT := 0;
    v_peso INT := 2;
    v_resto INT;
    v_dv INT;
    i INT;
BEGIN
    v_base := lpad(COALESCE(v_codigos_uf ->> upper(p_uf), '35'), 2, '0')
        || to_char(NOW(), 'YYMM')
        || lpad(regexp_replace(p_cnpj, '\D', '', 'g'), 14, '0')
        || '55'
        || lpad(p_serie::TEXT, 3, '0')
        || lpad(p_numero::TEXT, 9, '0')
        || '1'
        || lpad(floor(random() * 100000000)::BIGINT::TEXT, 8, '0');

    -- Módulo 11 com pesos 2..9 da direita para a esquerda
    FOR i IN REVERSE length(v_base)..1 LOOP
        v_soma := v_soma + substr(v_base, i, 1)::INT * v_peso;
        v_peso := CASE WHEN v_peso = 9 THEN 2 ELSE v_peso + 1 END;
    END LOOP;

    v_resto := v_soma % 11;
    v_dv := CASE WHEN v_resto < 2 THEN 0 ELSE 11 - v_resto END;

    RETURN v_base || v_dv::TEXT;
END;
$$;


-- ==========================================================
-- 3. FORNECEDOR: EMITIR NF-e
-- ==========================================================

CREATE OR REPLACE FUNCTION public.emitir_nota_fiscal(p_id_pedido BIGINT)
RETURNS public.notas_fiscais
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido     public.pedidos%ROWTYPE;
    v_produto    public.produtos%ROWTYPE;
    v_fornecedor public.fornecedores%ROWTYPE;
    v_comprador  public.usuarios%ROWTYPE;
    v_pagamento  public.pagamentos%ROWTYPE;
    v_nota       public.notas_fiscais%ROWTYPE;
    v_numero     INT;
    v_forma      TEXT;
BEGIN
    SELECT * INTO v_pedido FROM public.pedidos WHERE id_pedido = p_id_pedido;
    SELECT * INTO v_produto FROM public.produtos WHERE id_produto = v_pedido.id_produto;

    IF v_pedido.id_pedido IS NULL OR v_produto.id_fornecedor IS DISTINCT FROM public.meu_id_fornecedor() THEN
        RAISE EXCEPTION 'Pedido não encontrado para a sua empresa.';
    END IF;

    IF v_pedido.status_pedido IN ('PENDENTE', 'CANCELADO') THEN
        RAISE EXCEPTION 'A nota fiscal é emitida para pedidos confirmados.';
    END IF;

    IF NOT public.pagamento_libera_envio(p_id_pedido) THEN
        RAISE EXCEPTION 'Emita a nota após o pagamento do comprador (ou a aprovação do prazo).';
    END IF;

    SELECT * INTO v_nota
      FROM public.notas_fiscais
     WHERE id_pedido = p_id_pedido AND status = 'AUTORIZADA'
       FOR UPDATE;

    IF FOUND THEN
        RAISE EXCEPTION 'Este pedido já possui NF-e autorizada (nº %).', v_nota.numero;
    END IF;

    SELECT * INTO v_fornecedor FROM public.fornecedores WHERE id_fornecedor = v_produto.id_fornecedor;
    SELECT * INTO v_comprador FROM public.usuarios WHERE id_usuario = v_pedido.id_usuario;
    SELECT * INTO v_pagamento FROM public.pagamentos WHERE id_pedido = p_id_pedido;

    -- Numeração sequencial por fornecedor, sem buracos por concorrência
    PERFORM pg_advisory_xact_lock(hashtext('nfe-serf'), v_fornecedor.id_fornecedor::INT);

    SELECT COALESCE(MAX(numero), 0) + 1
      INTO v_numero
      FROM public.notas_fiscais
     WHERE id_fornecedor = v_fornecedor.id_fornecedor
       AND serie = 1;

    v_forma := CASE v_pagamento.metodo
        WHEN 'PIX' THEN 'Pix'
        WHEN 'BOLETO' THEN 'Boleto bancário'
        WHEN 'CARTAO' THEN 'Cartão de crédito (' || v_pagamento.parcelas || 'x)'
        WHEN 'PRAZO' THEN 'A prazo (' || v_pagamento.prazo_dias || ' dias)'
    END;

    INSERT INTO public.notas_fiscais (
        id_pedido, id_fornecedor, numero, serie, chave_acesso, protocolo,
        emitente_razao_social, emitente_cnpj, emitente_cidade, emitente_uf,
        destinatario_nome, destinatario_cnpj,
        produto_codigo, produto_descricao, quantidade, valor_unitario, valor_total,
        aliquota_icms, valor_icms, forma_pagamento, emitida_por
    )
    VALUES (
        p_id_pedido, v_fornecedor.id_fornecedor, v_numero, 1,
        public.gerar_chave_nfe_simulada(COALESCE(v_fornecedor.estado, 'SP'), v_fornecedor.cnpj, 1, v_numero),
        '135' || to_char(NOW(), 'YYYYMMDDHH24MISS') || lpad(floor(random() * 10)::INT::TEXT, 1, '0'),
        v_fornecedor.razao_social, v_fornecedor.cnpj, v_fornecedor.cidade, v_fornecedor.estado,
        v_comprador.nome_empresa, v_comprador.cnpj,
        v_produto.id_produto, v_produto.nome_produto, v_pedido.quantidade, v_pedido.valor_unitario, v_pedido.valor_total,
        18.00, round(v_pedido.valor_total * 0.18, 2), v_forma, auth.uid()
    )
    RETURNING * INTO v_nota;

    RETURN v_nota;
END;
$$;


-- ==========================================================
-- 4. FORNECEDOR: CANCELAR NF-e (até 24 h, justificativa >= 15 caracteres)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.cancelar_nota_fiscal(p_id_pedido BIGINT, p_motivo TEXT)
RETURNS public.notas_fiscais
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido public.pedidos%ROWTYPE;
    v_nota   public.notas_fiscais%ROWTYPE;
BEGIN
    SELECT * INTO v_pedido FROM public.pedidos WHERE id_pedido = p_id_pedido;

    IF NOT FOUND OR public.fornecedor_do_produto(v_pedido.id_produto) IS DISTINCT FROM public.meu_id_fornecedor() THEN
        RAISE EXCEPTION 'Pedido não encontrado para a sua empresa.';
    END IF;

    SELECT * INTO v_nota
      FROM public.notas_fiscais
     WHERE id_pedido = p_id_pedido AND status = 'AUTORIZADA'
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Não há NF-e autorizada para cancelar.';
    END IF;

    IF v_pedido.status_pedido IN ('ENVIADO', 'ENTREGUE') THEN
        RAISE EXCEPTION 'A mercadoria já saiu com esta nota: não é possível cancelá-la.';
    END IF;

    IF v_nota.data_emissao < NOW() - INTERVAL '24 hours' THEN
        RAISE EXCEPTION 'O prazo de cancelamento (24 horas após a autorização) expirou.';
    END IF;

    IF length(btrim(COALESCE(p_motivo, ''))) < 15 THEN
        RAISE EXCEPTION 'A justificativa do cancelamento deve ter pelo menos 15 caracteres.';
    END IF;

    UPDATE public.notas_fiscais
       SET status = 'CANCELADA',
           data_cancelamento = NOW(),
           motivo_cancelamento = left(btrim(p_motivo), 255)
     WHERE id_nota = v_nota.id_nota
     RETURNING * INTO v_nota;

    RETURN v_nota;
END;
$$;

REVOKE ALL ON FUNCTION public.emitir_nota_fiscal(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancelar_nota_fiscal(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.emitir_nota_fiscal(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_nota_fiscal(BIGINT, TEXT) TO authenticated;


-- ==========================================================
-- 5. REGRAS NO PEDIDO
-- ==========================================================

-- Mercadoria só sai com NF-e autorizada (BEFORE UPDATE)
CREATE OR REPLACE FUNCTION public.pedidos_exigir_nota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status_pedido = 'ENVIADO'
       AND OLD.status_pedido IS DISTINCT FROM 'ENVIADO'
       AND NOT EXISTS (
            SELECT 1 FROM public.notas_fiscais
             WHERE id_pedido = NEW.id_pedido AND status = 'AUTORIZADA'
       ) THEN
        RAISE EXCEPTION 'Emita a nota fiscal antes de enviar a mercadoria.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_nota ON public.pedidos;
CREATE TRIGGER trg_pedidos_nota
    BEFORE UPDATE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.pedidos_exigir_nota();

-- Pedido cancelado (antes do envio): cancela a nota junto (AFTER UPDATE)
CREATE OR REPLACE FUNCTION public.pedidos_cancelar_nota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status_pedido = 'CANCELADO' AND OLD.status_pedido IS DISTINCT FROM 'CANCELADO' THEN
        UPDATE public.notas_fiscais
           SET status = 'CANCELADA',
               data_cancelamento = NOW(),
               motivo_cancelamento = 'Cancelamento automático: pedido cancelado antes do envio.'
         WHERE id_pedido = NEW.id_pedido
           AND status = 'AUTORIZADA';
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_cancelar_nota ON public.pedidos;
CREATE TRIGGER trg_pedidos_cancelar_nota
    AFTER UPDATE ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.pedidos_cancelar_nota();


-- ==========================================================
-- 6. TEMPO REAL
-- ==========================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'notas_fiscais'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notas_fiscais;
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
