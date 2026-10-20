-- S.E.R.F. - NF-e REAL (Focus NFe), desligada por padrão
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 026.
-- Pode ser executado mais de uma vez (idempotente).
--
-- Modo (uma linha só, alterada só pelo SQL Editor):
--   SIMULADA (padrão) → NF-e da 010, sem valor fiscal.
--   REAL              → emissão pela Focus NFe (que fala com a SEFAZ com o
--                       certificado A1 do fornecedor, cadastrado no painel
--                       da Focus). A nota simulada fica bloqueada.
--     UPDATE public.configuracao_nfe SET modo = 'REAL';
--
-- Dados fiscais que uma NF-e real exige e o S.E.R.F. não tinha:
--   - produto: NCM (8 dígitos) e unidade;
--   - comprador (destinatário): endereço completo e inscrição estadual;
--   - fornecedor (emitente): regime tributário (só Simples Nacional é
--     suportado: CSOSN 102 / PIS e COFINS 07 — confirme com o contador).
-- preparar_nfe lista o que falta antes de qualquer chamada à SEFAZ.
--
-- Fluxo REAL (Edge Functions nfe-emitir, nfe-consultar, nfe-cancelar e
-- nfe-webhook): emitir → PROCESSANDO → (SEFAZ) → AUTORIZADA ou REJEITADA.
-- Segunda camada: no modo REAL, nota só vira AUTORIZADA ou CANCELADA pelo
-- caminho do emissor (trigger notas_exigir_provedor). Pedido com NF-e real
-- autorizada não cancela sozinho: cancele a nota antes (a SEFAZ registra).


-- ==========================================================
-- 1. MODO
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.configuracao_nfe (
    id BOOLEAN NOT NULL DEFAULT TRUE,
    modo VARCHAR(10) NOT NULL DEFAULT 'SIMULADA',
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_configuracao_nfe PRIMARY KEY (id),
    CONSTRAINT ck_configuracao_nfe_unica CHECK (id),
    CONSTRAINT ck_configuracao_nfe_modo CHECK (modo IN ('SIMULADA', 'REAL'))
);

INSERT INTO public.configuracao_nfe (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.configuracao_nfe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS configuracao_nfe_select ON public.configuracao_nfe;
CREATE POLICY configuracao_nfe_select ON public.configuracao_nfe FOR SELECT TO authenticated USING (TRUE);
REVOKE INSERT, UPDATE, DELETE ON public.configuracao_nfe FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.nfe_modo()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT modo FROM public.configuracao_nfe LIMIT 1), 'SIMULADA');
$$;


-- ==========================================================
-- 2. DADOS FISCAIS NOS CADASTROS (cada empresa edita os seus)
-- ==========================================================

ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS ncm CHAR(8);
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS unidade_fiscal VARCHAR(6) NOT NULL DEFAULT 'UN';

ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS cep CHAR(8);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS logradouro VARCHAR(120);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS numero_endereco VARCHAR(10);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS complemento VARCHAR(60);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS bairro VARCHAR(60);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS municipio VARCHAR(60);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS uf CHAR(2);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS inscricao_estadual VARCHAR(14);

ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS regime_tributario VARCHAR(10) NOT NULL DEFAULT 'SIMPLES';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_produtos_ncm') THEN
        ALTER TABLE public.produtos ADD CONSTRAINT ck_produtos_ncm CHECK (ncm IS NULL OR ncm ~ '^[0-9]{8}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_produtos_unidade_fiscal') THEN
        ALTER TABLE public.produtos ADD CONSTRAINT ck_produtos_unidade_fiscal
            CHECK (unidade_fiscal IN ('UN', 'KG', 'TON', 'L', 'M', 'M2', 'M3', 'CX', 'PCT', 'PC'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuarios_cep') THEN
        ALTER TABLE public.usuarios ADD CONSTRAINT ck_usuarios_cep CHECK (cep IS NULL OR cep ~ '^[0-9]{8}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuarios_uf') THEN
        ALTER TABLE public.usuarios ADD CONSTRAINT ck_usuarios_uf CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuarios_ie') THEN
        ALTER TABLE public.usuarios ADD CONSTRAINT ck_usuarios_ie
            CHECK (inscricao_estadual IS NULL OR inscricao_estadual ~ '^([0-9]{2,14}|ISENTO)$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_fornecedores_regime') THEN
        ALTER TABLE public.fornecedores ADD CONSTRAINT ck_fornecedores_regime CHECK (regime_tributario IN ('SIMPLES', 'NORMAL'));
    END IF;
END $$;

GRANT UPDATE (ncm, unidade_fiscal) ON public.produtos TO authenticated;
GRANT UPDATE (cep, logradouro, numero_endereco, complemento, bairro, municipio, uf, inscricao_estadual)
    ON public.usuarios TO authenticated;
GRANT UPDATE (regime_tributario) ON public.fornecedores TO authenticated;


-- ==========================================================
-- 3. NOTAS: estados do emissor real
-- ==========================================================

ALTER TABLE public.notas_fiscais ALTER COLUMN numero DROP NOT NULL;
ALTER TABLE public.notas_fiscais ALTER COLUMN chave_acesso DROP NOT NULL;
ALTER TABLE public.notas_fiscais ALTER COLUMN protocolo DROP NOT NULL;

ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS provedor VARCHAR(12) NOT NULL DEFAULT 'SIMULADO';
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS provedor_ref VARCHAR(60);
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS url_danfe TEXT;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS url_xml TEXT;
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS mensagem_sefaz VARCHAR(500);

ALTER TABLE public.notas_fiscais DROP CONSTRAINT IF EXISTS ck_notas_status;
ALTER TABLE public.notas_fiscais ADD CONSTRAINT ck_notas_status
    CHECK (status IN ('PROCESSANDO', 'AUTORIZADA', 'REJEITADA', 'CANCELADA'));

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_notas_autorizada_completa') THEN
        ALTER TABLE public.notas_fiscais ADD CONSTRAINT ck_notas_autorizada_completa
            CHECK (status <> 'AUTORIZADA' OR (numero IS NOT NULL AND chave_acesso IS NOT NULL AND protocolo IS NOT NULL));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_notas_provedor') THEN
        ALTER TABLE public.notas_fiscais ADD CONSTRAINT ck_notas_provedor CHECK (provedor IN ('SIMULADO', 'FOCUS_NFE'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_provedor_ref ON public.notas_fiscais (provedor_ref) WHERE provedor_ref IS NOT NULL;
-- No máximo uma nota em processamento por pedido
CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_pedido_processando
    ON public.notas_fiscais (id_pedido) WHERE status = 'PROCESSANDO';


-- ==========================================================
-- 4. MODO REAL: só o emissor autoriza ou cancela (segunda camada)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.notas_exigir_provedor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF COALESCE(current_setting('serf.nfe_provedor', TRUE), '') = 'sim' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.provedor = 'FOCUS_NFE'
       AND NEW.status = 'CANCELADA' AND OLD.status = 'AUTORIZADA' THEN
        RAISE EXCEPTION 'NF-e real: cancele a nota pelo botão "Cancelar NF-e" antes (a SEFAZ precisa registrar).';
    END IF;

    IF public.nfe_modo() = 'REAL' AND NEW.status = 'AUTORIZADA'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'AUTORIZADA') THEN
        RAISE EXCEPTION 'NF-e real ativa: emita pela SEFAZ (botão "Emitir NF-e").';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notas_exigir_provedor ON public.notas_fiscais;
CREATE TRIGGER trg_notas_exigir_provedor
    BEFORE INSERT OR UPDATE ON public.notas_fiscais
    FOR EACH ROW
    EXECUTE FUNCTION public.notas_exigir_provedor();


-- ==========================================================
-- 5. nfe-emitir: confere e reúne os dados (sessão do FORNECEDOR)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.preparar_nfe(p_id_pedido BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pedido     public.pedidos%ROWTYPE;
    v_produto    public.produtos%ROWTYPE;
    v_fornecedor public.fornecedores%ROWTYPE;
    v_comprador  public.usuarios%ROWTYPE;
    v_pagamento  public.pagamentos%ROWTYPE;
    v_faltas     TEXT[] := ARRAY[]::TEXT[];
    v_tentativa  INT;
BEGIN
    IF public.nfe_modo() <> 'REAL' THEN
        RAISE EXCEPTION 'A NF-e real não está ativa (ambiente simulado).';
    END IF;

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

    IF EXISTS (SELECT 1 FROM public.notas_fiscais WHERE id_pedido = p_id_pedido AND status IN ('AUTORIZADA', 'PROCESSANDO')) THEN
        RAISE EXCEPTION 'Este pedido já tem NF-e autorizada ou em processamento.';
    END IF;

    SELECT * INTO v_fornecedor FROM public.fornecedores WHERE id_fornecedor = v_produto.id_fornecedor;
    SELECT * INTO v_comprador FROM public.usuarios WHERE id_usuario = v_pedido.id_usuario;
    SELECT * INTO v_pagamento FROM public.pagamentos WHERE id_pedido = p_id_pedido;

    -- O que falta (tudo de uma vez, com onde corrigir)
    IF v_fornecedor.regime_tributario <> 'SIMPLES' THEN
        v_faltas := array_append(v_faltas, 'emissão real só para Simples Nacional por enquanto (regime normal exige configurar ICMS/PIS/COFINS com o contador)');
    END IF;
    IF v_fornecedor.estado IS NULL THEN
        v_faltas := array_append(v_faltas, 'UF da sua empresa (Perfil)');
    END IF;
    IF v_produto.ncm IS NULL THEN
        v_faltas := array_append(v_faltas, format('NCM do produto "%s" (Catálogo → editar produto)', v_produto.nome_produto));
    END IF;
    IF v_comprador.cep IS NULL OR v_comprador.logradouro IS NULL OR v_comprador.numero_endereco IS NULL
       OR v_comprador.bairro IS NULL OR v_comprador.municipio IS NULL OR v_comprador.uf IS NULL THEN
        v_faltas := array_append(v_faltas, format('endereço completo de %s (o comprador preenche no Perfil)', v_comprador.nome_empresa));
    END IF;

    IF array_length(v_faltas, 1) > 0 THEN
        RAISE EXCEPTION 'Faltam dados para a NF-e: %.', array_to_string(v_faltas, '; ');
    END IF;

    SELECT COUNT(*) + 1 INTO v_tentativa FROM public.notas_fiscais WHERE id_pedido = p_id_pedido;

    RETURN jsonb_build_object(
        'ref', format('serf-%s-%s', p_id_pedido, v_tentativa),
        'id_pedido', p_id_pedido,
        'cfop', CASE WHEN upper(v_fornecedor.estado) = v_comprador.uf THEN '5102' ELSE '6102' END,
        'emitente', jsonb_build_object('cnpj', v_fornecedor.cnpj, 'uf', upper(v_fornecedor.estado)),
        'destinatario', jsonb_build_object(
            'nome', v_comprador.nome_empresa, 'cnpj', v_comprador.cnpj, 'email', v_comprador.email,
            'inscricao_estadual', v_comprador.inscricao_estadual,
            'cep', v_comprador.cep, 'logradouro', v_comprador.logradouro, 'numero', v_comprador.numero_endereco,
            'complemento', v_comprador.complemento, 'bairro', v_comprador.bairro,
            'municipio', v_comprador.municipio, 'uf', v_comprador.uf),
        'item', jsonb_build_object(
            'codigo', v_produto.id_produto, 'descricao', v_produto.nome_produto, 'ncm', v_produto.ncm,
            'unidade', v_produto.unidade_fiscal, 'quantidade', v_pedido.quantidade,
            'valor_unitario', v_pedido.valor_unitario, 'valor_total', v_pedido.valor_total),
        'pagamento', jsonb_build_object('metodo', v_pagamento.metodo, 'valor', v_pedido.valor_total)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.preparar_nfe(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preparar_nfe(BIGINT) TO authenticated;


-- ==========================================================
-- 6. nfe-emitir: registra a nota enviada (só servidor)
-- Fotografia dos dados no momento do envio (como na 010).
-- ==========================================================

CREATE OR REPLACE FUNCTION public.registrar_nfe_enviada(p_id_pedido BIGINT, p_ref TEXT, p_cfop TEXT, p_emitida_por UUID)
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
BEGIN
    SELECT * INTO v_pedido FROM public.pedidos WHERE id_pedido = p_id_pedido;
    SELECT * INTO v_produto FROM public.produtos WHERE id_produto = v_pedido.id_produto;
    SELECT * INTO v_fornecedor FROM public.fornecedores WHERE id_fornecedor = v_produto.id_fornecedor;
    SELECT * INTO v_comprador FROM public.usuarios WHERE id_usuario = v_pedido.id_usuario;
    SELECT * INTO v_pagamento FROM public.pagamentos WHERE id_pedido = p_id_pedido;

    INSERT INTO public.notas_fiscais (
        id_pedido, id_fornecedor, status, provedor, provedor_ref, cfop,
        emitente_razao_social, emitente_cnpj, emitente_cidade, emitente_uf,
        destinatario_nome, destinatario_cnpj,
        produto_codigo, produto_descricao, quantidade, valor_unitario, valor_total,
        aliquota_icms, valor_icms, forma_pagamento, emitida_por
    )
    VALUES (
        p_id_pedido, v_fornecedor.id_fornecedor, 'PROCESSANDO', 'FOCUS_NFE', p_ref, p_cfop,
        v_fornecedor.razao_social, v_fornecedor.cnpj, v_fornecedor.cidade, v_fornecedor.estado,
        v_comprador.nome_empresa, v_comprador.cnpj,
        v_produto.id_produto, v_produto.nome_produto, v_pedido.quantidade, v_pedido.valor_unitario, v_pedido.valor_total,
        0, 0,                               -- Simples Nacional (CSOSN 102): sem destaque de ICMS
        CASE v_pagamento.metodo WHEN 'PIX' THEN 'Pix' WHEN 'PRAZO' THEN 'A prazo (' || v_pagamento.prazo_dias || ' dias)' ELSE v_pagamento.metodo END,
        p_emitida_por
    )
    RETURNING * INTO v_nota;

    RETURN v_nota;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_nfe_enviada(BIGINT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;


-- ==========================================================
-- 7. RETORNO DO EMISSOR (consulta, webhook ou cancelamento; só servidor)
-- Idempotente: o mesmo retorno duas vezes não muda nada.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.atualizar_nfe_provedor(
    p_ref TEXT,
    p_status TEXT,                     -- PROCESSANDO | AUTORIZADA | REJEITADA | CANCELADA
    p_numero INT DEFAULT NULL,
    p_serie INT DEFAULT NULL,
    p_chave TEXT DEFAULT NULL,
    p_protocolo TEXT DEFAULT NULL,
    p_url_danfe TEXT DEFAULT NULL,
    p_url_xml TEXT DEFAULT NULL,
    p_mensagem TEXT DEFAULT NULL
)
RETURNS public.notas_fiscais
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_nota public.notas_fiscais%ROWTYPE;
BEGIN
    SELECT * INTO v_nota FROM public.notas_fiscais WHERE provedor_ref = p_ref FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nota % não encontrada.', p_ref;
    END IF;

    IF p_status = v_nota.status OR p_status = 'PROCESSANDO' THEN
        RETURN v_nota;
    END IF;

    PERFORM set_config('serf.nfe_provedor', 'sim', TRUE);

    IF p_status = 'AUTORIZADA' AND v_nota.status = 'PROCESSANDO' THEN
        UPDATE public.notas_fiscais
           SET status = 'AUTORIZADA', numero = p_numero, serie = COALESCE(p_serie, serie),
               chave_acesso = p_chave, protocolo = p_protocolo,
               url_danfe = p_url_danfe, url_xml = p_url_xml, mensagem_sefaz = left(p_mensagem, 500),
               data_emissao = NOW()
         WHERE id_nota = v_nota.id_nota
         RETURNING * INTO v_nota;

    ELSIF p_status = 'REJEITADA' AND v_nota.status = 'PROCESSANDO' THEN
        UPDATE public.notas_fiscais
           SET status = 'REJEITADA', mensagem_sefaz = left(COALESCE(p_mensagem, 'Rejeitada pela SEFAZ.'), 500)
         WHERE id_nota = v_nota.id_nota
         RETURNING * INTO v_nota;

    ELSIF p_status = 'CANCELADA' AND v_nota.status = 'AUTORIZADA' THEN
        UPDATE public.notas_fiscais
           SET status = 'CANCELADA', data_cancelamento = NOW(),
               motivo_cancelamento = left(COALESCE(p_mensagem, 'Cancelada na SEFAZ.'), 255),
               url_xml = COALESCE(p_url_xml, url_xml)
         WHERE id_nota = v_nota.id_nota
         RETURNING * INTO v_nota;
    END IF;

    RETURN v_nota;
END;
$$;

REVOKE ALL ON FUNCTION public.atualizar_nfe_provedor(TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;


-- ==========================================================
-- 8. CONSULTAR E CANCELAR (sessão do usuário: quem pode)
-- ==========================================================

-- Nota real mais recente do pedido (para acompanhar o processamento)
CREATE OR REPLACE FUNCTION public.nfe_ref_do_pedido(p_id_pedido BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ref TEXT;
BEGIN
    IF NOT public.participa_do_pedido(p_id_pedido) THEN
        RAISE EXCEPTION 'Pedido não encontrado para a sua empresa.';
    END IF;

    SELECT provedor_ref INTO v_ref FROM public.notas_fiscais
     WHERE id_pedido = p_id_pedido AND provedor = 'FOCUS_NFE'
     ORDER BY id_nota DESC LIMIT 1;

    IF v_ref IS NULL THEN
        RAISE EXCEPTION 'Este pedido não tem NF-e real.';
    END IF;
    RETURN v_ref;
END;
$$;

-- Mesmas regras do cancelamento da 010; devolve a referência no emissor
CREATE OR REPLACE FUNCTION public.preparar_cancelamento_nfe(p_id_pedido BIGINT, p_motivo TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
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

    SELECT * INTO v_nota FROM public.notas_fiscais
     WHERE id_pedido = p_id_pedido AND status = 'AUTORIZADA' AND provedor = 'FOCUS_NFE';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Não há NF-e real autorizada para cancelar.';
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

    RETURN v_nota.provedor_ref;
END;
$$;

REVOKE ALL ON FUNCTION public.nfe_ref_do_pedido(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preparar_cancelamento_nfe(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfe_ref_do_pedido(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preparar_cancelamento_nfe(BIGINT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
