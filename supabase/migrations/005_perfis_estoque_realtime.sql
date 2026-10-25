-- S.E.R.F. - Perfil "Ambos", segmentação no servidor, login por e-mail,
--            dados públicos de fornecedores, estoque e pedidos em tempo real
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 003 e da 004.
-- Pode ser executado mais de uma vez (idempotente).
--
-- O que este script faz:
--   1. Remove a função obter_email_por_cnpj (o login passou a ser por e-mail).
--   2. Cria o cadastro da empresa em "usuarios" por trigger no auth.users,
--      funcionando mesmo com a confirmação de e-mail ligada.
--   3. RPC atualizar_segmentacao_usuario: Comprador, Fornecedor ou Ambos,
--      com INSERT/DELETE feitos no servidor, numa única transação.
--   4. Fecha INSERT/DELETE diretos do front-end em usuarios e fornecedores.
--   5. View fornecedores_publicos: o catálogo vê apenas dados comerciais
--      (sem CNPJ, e-mail e telefone).
--   6. Estoque: reservado ao CONFIRMAR o pedido e devolvido ao CANCELAR.
--   7. Pedidos no Supabase Realtime (comprador vê o status mudar ao vivo).


-- ==========================================================
-- 1. LOGIN POR E-MAIL: REMOVE A BUSCA DE E-MAIL POR CNPJ
-- ==========================================================

DROP FUNCTION IF EXISTS public.obter_email_por_cnpj(TEXT);


-- ==========================================================
-- 2. CADASTRO DA EMPRESA PELO BANCO
-- O front-end envia CNPJ e razão social nos metadados do signUp;
-- o registro em "usuarios" nasce aqui, sem depender de sessão.
-- ==========================================================

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

    IF EXISTS (SELECT 1 FROM public.usuarios WHERE cnpj = v_cnpj)
       OR EXISTS (SELECT 1 FROM public.fornecedores WHERE cnpj = v_cnpj) THEN
        RAISE EXCEPTION 'CNPJ_JA_CADASTRADO';
    END IF;

    INSERT INTO public.usuarios (auth_user_id, nome_empresa, cnpj, nome_responsavel, email)
    VALUES (
        NEW.id,
        v_razao,
        v_cnpj,
        -- nome_responsavel é obrigatório; até haver campo próprio, usa a razão social.
        COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data ->> 'nome_responsavel'), ''), v_razao),
        NEW.email
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_criar_empresa_no_cadastro ON auth.users;
CREATE TRIGGER trg_criar_empresa_no_cadastro
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.criar_empresa_no_cadastro();


-- ==========================================================
-- 3. SEGMENTAÇÃO NO SERVIDOR
-- A empresa é sempre a da sessão (auth.uid()): a função não recebe
-- um id de usuário, para que ninguém altere o perfil de outra empresa.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.atualizar_segmentacao_usuario(p_perfil TEXT, p_nicho TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid           UUID := auth.uid();
    v_id_usuario    BIGINT;
    v_id_fornecedor BIGINT;
    v_razao         TEXT;
    v_cnpj          TEXT;
    v_email         TEXT;
    v_responsavel   TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sessão expirada. Faça login novamente.';
    END IF;

    IF p_perfil NOT IN ('Comprador', 'Fornecedor', 'Ambos') THEN
        RAISE EXCEPTION 'Perfil inválido: %.', p_perfil;
    END IF;

    IF NULLIF(TRIM(p_nicho), '') IS NULL THEN
        RAISE EXCEPTION 'Selecione o nicho de atuação da empresa.';
    END IF;

    -- Dados atuais da empresa (comprador → fornecedor → metadados do cadastro)
    SELECT id_usuario, nome_empresa, cnpj, email, nome_responsavel
      INTO v_id_usuario, v_razao, v_cnpj, v_email, v_responsavel
      FROM public.usuarios
     WHERE auth_user_id = v_uid;

    SELECT id_fornecedor INTO v_id_fornecedor
      FROM public.fornecedores
     WHERE auth_user_id = v_uid;

    IF v_cnpj IS NULL THEN
        SELECT razao_social, cnpj, email
          INTO v_razao, v_cnpj, v_email
          FROM public.fornecedores
         WHERE auth_user_id = v_uid;
    END IF;

    IF v_cnpj IS NULL THEN
        SELECT raw_user_meta_data ->> 'razao_social',
               regexp_replace(COALESCE(raw_user_meta_data ->> 'cnpj', ''), '\D', '', 'g'),
               email
          INTO v_razao, v_cnpj, v_email
          FROM auth.users
         WHERE id = v_uid;
    END IF;

    IF v_razao IS NULL OR v_cnpj IS NULL OR length(v_cnpj) <> 14 THEN
        RAISE EXCEPTION 'Cadastro da empresa incompleto (CNPJ ou razão social).';
    END IF;

    -- Papel de COMPRADOR (tabela usuarios)
    IF p_perfil IN ('Comprador', 'Ambos') THEN
        IF v_id_usuario IS NULL THEN
            INSERT INTO public.usuarios (auth_user_id, nome_empresa, cnpj, nome_responsavel, email, nicho)
            VALUES (v_uid, v_razao, v_cnpj, COALESCE(v_responsavel, v_razao), v_email, p_nicho);
        ELSE
            UPDATE public.usuarios SET nicho = p_nicho WHERE id_usuario = v_id_usuario;
        END IF;
    ELSIF v_id_usuario IS NOT NULL THEN
        -- O DELETE apagaria os pedidos em cascata: bloqueia se houver histórico.
        IF EXISTS (SELECT 1 FROM public.pedidos WHERE id_usuario = v_id_usuario) THEN
            RAISE EXCEPTION 'A empresa já possui pedidos de compra. Escolha o perfil "Ambos".';
        END IF;
        DELETE FROM public.usuarios WHERE id_usuario = v_id_usuario;
    END IF;

    -- Papel de FORNECEDOR (tabela fornecedores)
    IF p_perfil IN ('Fornecedor', 'Ambos') THEN
        IF v_id_fornecedor IS NULL THEN
            INSERT INTO public.fornecedores (auth_user_id, razao_social, cnpj, email, nicho)
            VALUES (v_uid, v_razao, v_cnpj, v_email, p_nicho);
        ELSE
            UPDATE public.fornecedores SET nicho = p_nicho WHERE id_fornecedor = v_id_fornecedor;
        END IF;
    ELSIF v_id_fornecedor IS NOT NULL THEN
        -- O DELETE apagaria produtos e pedidos em cascata: bloqueia se houver catálogo.
        IF EXISTS (SELECT 1 FROM public.produtos WHERE id_fornecedor = v_id_fornecedor) THEN
            RAISE EXCEPTION 'A empresa já possui produtos cadastrados. Escolha o perfil "Ambos".';
        END IF;
        DELETE FROM public.fornecedores WHERE id_fornecedor = v_id_fornecedor;
    END IF;

    -- Conclui o onboarding na mesma transação
    UPDATE auth.users
       SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
           || jsonb_build_object('segmentacao_concluida', true, 'perfil', p_perfil, 'nicho', p_nicho)
     WHERE id = v_uid;

    RETURN p_perfil;
END;
$$;

REVOKE ALL ON FUNCTION public.atualizar_segmentacao_usuario(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atualizar_segmentacao_usuario(TEXT, TEXT) TO authenticated;


-- ==========================================================
-- 4. SEM INSERT/DELETE DIRETO DO FRONT-END NAS EMPRESAS
-- Cadastro → trigger (item 2); segmentação → RPC (item 3).
-- Continua permitido: cada empresa editar o próprio cadastro (UPDATE).
-- ==========================================================

DROP POLICY IF EXISTS usuarios_insert_proprio ON public.usuarios;
DROP POLICY IF EXISTS usuarios_delete_proprio ON public.usuarios;
DROP POLICY IF EXISTS fornecedores_insert_proprio ON public.fornecedores;


-- ==========================================================
-- 5. DADOS PÚBLICOS DE FORNECEDORES
-- A tabela passa a ser lida só pelo próprio fornecedor; o catálogo e
-- os pedidos usam a view, que expõe apenas campos comerciais.
-- A view roda com o dono (postgres) de propósito: é ela que filtra as
-- colunas. O linter do Supabase mostra "Security Definer View": esperado.
-- ==========================================================

DROP POLICY IF EXISTS fornecedores_select_autenticados ON public.fornecedores;

DROP POLICY IF EXISTS fornecedores_select_proprio ON public.fornecedores;
CREATE POLICY fornecedores_select_proprio
    ON public.fornecedores
    FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid());

-- [031] Depois da 031 a view também tem logo_url; recriá-la aqui sem a
-- coluna falharia ("cannot drop columns from view") ao rodar de novo.
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'fornecedores_publicos' AND column_name = 'logo_url') THEN
        EXECUTE $v$
        CREATE OR REPLACE VIEW public.fornecedores_publicos AS
            SELECT id_fornecedor,
                   razao_social,
                   nome_fantasia,
                   cidade,
                   estado,
                   nicho
              FROM public.fornecedores
        $v$;
    END IF;
END $do$;

REVOKE ALL ON public.fornecedores_publicos FROM PUBLIC, anon;
GRANT SELECT ON public.fornecedores_publicos TO authenticated;


-- ==========================================================
-- 6. VALIDAÇÃO DE PEDIDOS + CONTROLE DE ESTOQUE
-- Substitui a função da 003, acrescentando o estoque:
--   CONFIRMADO                      → desconta a quantidade do produto;
--   CANCELADO (após confirmação)    → devolve a quantidade ao produto.
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
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT preco_atacado, quantidade_minima, quantidade_estoque, ativo
          INTO v_produto
          FROM public.produtos
         WHERE id_produto = NEW.id_produto;

        IF NOT FOUND OR NOT v_produto.ativo THEN
            RAISE EXCEPTION 'Produto indisponível para pedidos.';
        END IF;

        IF NEW.quantidade < v_produto.quantidade_minima THEN
            RAISE EXCEPTION 'A quantidade mínima para este produto é % unidades.',
                v_produto.quantidade_minima;
        END IF;

        IF NEW.quantidade > v_produto.quantidade_estoque THEN
            RAISE EXCEPTION 'Estoque insuficiente: % unidades disponíveis.',
                v_produto.quantidade_estoque;
        END IF;

        -- O preço vem sempre do cadastro do produto, nunca do navegador.
        NEW.valor_unitario := v_produto.preco_atacado;
        NEW.status_pedido  := 'PENDENTE';
        NEW.data_pedido    := NOW();

        RETURN NEW;
    END IF;

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

-- O trigger trg_pedidos_validar (criado na 003) já aponta para esta função.


-- ==========================================================
-- 7. PEDIDOS EM TEMPO REAL
-- O Realtime respeita o RLS: cada empresa só recebe os próprios pedidos.
-- ==========================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'pedidos'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pedidos;
    END IF;
END;
$$;
