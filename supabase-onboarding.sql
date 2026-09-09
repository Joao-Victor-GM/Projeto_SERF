-- =========================================================================
-- SERF - Migração de Onboarding e Segurança (SCRUM-9, 10 e 11)
-- Versão revisada. Adaptada ao schema existente: mantém nomes, tipos e
-- constraints originais. Todos os comandos são idempotentes.
--
-- Rode no SQL Editor do Supabase, de cima para baixo, de uma vez só.
-- =========================================================================


-- =========================================================================
-- 1) COLUNAS NOVAS EM public.usuarios
-- Reaproveitadas do seu schema: telefone, nome_responsavel,
-- status_cadastro, data_cadastro, ativo.
-- =========================================================================
ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS perfil                  VARCHAR(15),
    ADD COLUMN IF NOT EXISTS inscricao_estadual      VARCHAR(20),
    ADD COLUMN IF NOT EXISTS isento_ie               BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS cep                     VARCHAR(8),
    ADD COLUMN IF NOT EXISTS logradouro              VARCHAR(150),
    ADD COLUMN IF NOT EXISTS numero                  VARCHAR(15),
    ADD COLUMN IF NOT EXISTS complemento             VARCHAR(100),
    ADD COLUMN IF NOT EXISTS bairro                  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS cidade                  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS estado                  CHAR(2),
    ADD COLUMN IF NOT EXISTS nichos                  TEXT[],
    ADD COLUMN IF NOT EXISTS raio_atuacao_km         INTEGER,
    ADD COLUMN IF NOT EXISTS onboarding_completo     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS onboarding_concluido_em TIMESTAMPTZ;


-- =========================================================================
-- 2) COLUNAS NOVAS EM public.fornecedores
-- Reaproveitadas do seu schema: telefone, cidade, estado, nome_fantasia,
-- status_cadastro, data_cadastro, ativo.
-- =========================================================================
ALTER TABLE public.fornecedores
    ADD COLUMN IF NOT EXISTS perfil                  VARCHAR(15),
    ADD COLUMN IF NOT EXISTS nome_responsavel        VARCHAR(100),
    ADD COLUMN IF NOT EXISTS inscricao_estadual      VARCHAR(20),
    ADD COLUMN IF NOT EXISTS isento_ie               BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS cep                     VARCHAR(8),
    ADD COLUMN IF NOT EXISTS logradouro              VARCHAR(150),
    ADD COLUMN IF NOT EXISTS numero                  VARCHAR(15),
    ADD COLUMN IF NOT EXISTS complemento             VARCHAR(100),
    ADD COLUMN IF NOT EXISTS bairro                  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS nichos                  TEXT[],
    ADD COLUMN IF NOT EXISTS raio_atuacao_km         INTEGER,
    ADD COLUMN IF NOT EXISTS onboarding_completo     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS onboarding_concluido_em TIMESTAMPTZ;


-- =========================================================================
-- 3) nome_responsavel deixa de ser obrigatório no INSERT
-- O nome do responsável só é perguntado na Etapa 1 do onboarding, então o
-- INSERT do cadastro quebraria contra o NOT NULL. A coluna e o tipo
-- continuam iguais; a obrigatoriedade migra para a CHECK da seção 5, que
-- exige o campo no momento em que onboarding_completo vira TRUE.
-- =========================================================================
ALTER TABLE public.usuarios
    ALTER COLUMN nome_responsavel DROP NOT NULL;


-- =========================================================================
-- 4) Perfil híbrido (SCRUM-9)
-- auth_user_id, cnpj e email são UNIQUE por tabela, então a mesma conta
-- existir nas duas já é válido. Aqui só formalizamos os valores aceitos.
-- =========================================================================
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_perfil;
ALTER TABLE public.usuarios
    ADD CONSTRAINT ck_usuarios_perfil
        CHECK (perfil IS NULL OR perfil IN ('Comprador', 'Ambos'));

ALTER TABLE public.fornecedores DROP CONSTRAINT IF EXISTS ck_fornecedores_perfil;
ALTER TABLE public.fornecedores
    ADD CONSTRAINT ck_fornecedores_perfil
        CHECK (perfil IS NULL OR perfil IN ('Fornecedor', 'Ambos'));


-- =========================================================================
-- 5) Integridade dos dados do onboarding
-- Com onboarding_completo = FALSE os campos podem estar vazios.
-- Quando vira TRUE, o registro precisa estar realmente completo.
-- =========================================================================
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_onboarding_completo;
ALTER TABLE public.usuarios
    ADD CONSTRAINT ck_usuarios_onboarding_completo
        CHECK (
            onboarding_completo = FALSE
            OR (
                nome_responsavel IS NOT NULL
                AND telefone   IS NOT NULL
                AND cep        IS NOT NULL
                AND logradouro IS NOT NULL
                AND numero     IS NOT NULL
                AND cidade     IS NOT NULL
                AND estado     IS NOT NULL
                AND nichos     IS NOT NULL
                AND array_length(nichos, 1) > 0
            )
        );

ALTER TABLE public.fornecedores DROP CONSTRAINT IF EXISTS ck_fornecedores_onboarding_completo;
ALTER TABLE public.fornecedores
    ADD CONSTRAINT ck_fornecedores_onboarding_completo
        CHECK (
            onboarding_completo = FALSE
            OR (
                nome_responsavel IS NOT NULL
                AND telefone   IS NOT NULL
                AND cep        IS NOT NULL
                AND logradouro IS NOT NULL
                AND numero     IS NOT NULL
                AND cidade     IS NOT NULL
                AND estado     IS NOT NULL
                AND nichos     IS NOT NULL
                AND array_length(nichos, 1) > 0
            )
        );

ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_cep;
ALTER TABLE public.usuarios
    ADD CONSTRAINT ck_usuarios_cep CHECK (cep IS NULL OR cep ~ '^[0-9]{8}$');

ALTER TABLE public.fornecedores DROP CONSTRAINT IF EXISTS ck_fornecedores_cep;
ALTER TABLE public.fornecedores
    ADD CONSTRAINT ck_fornecedores_cep CHECK (cep IS NULL OR cep ~ '^[0-9]{8}$');


-- =========================================================================
-- 6) Índices de apoio à busca da home
-- =========================================================================
CREATE INDEX IF NOT EXISTS ix_fornecedores_nichos
    ON public.fornecedores USING GIN (nichos);

CREATE INDEX IF NOT EXISTS ix_fornecedores_regiao
    ON public.fornecedores (estado, cidade) WHERE ativo = TRUE;

CREATE INDEX IF NOT EXISTS ix_usuarios_onboarding
    ON public.usuarios (auth_user_id, onboarding_completo);

CREATE INDEX IF NOT EXISTS ix_fornecedores_onboarding
    ON public.fornecedores (auth_user_id, onboarding_completo);


-- =========================================================================
-- 7) CADASTRO ATÔMICO VIA TRIGGER  (corrige o bloqueador principal)
--
-- Antes: o JavaScript fazia o INSERT depois do signUp. Com confirmação de
-- e-mail ligada não existe sessão nesse momento, auth.uid() é NULL e o
-- INSERT falhava — a conta nascia no Auth sem empresa nas tabelas.
--
-- Agora: o trigger roda dentro da própria transação do signUp, lendo os
-- dados que o front manda em options.data. Funciona com ou sem confirmação
-- de e-mail, e "Ambos" grava nas duas tabelas ou em nenhuma.
-- =========================================================================
DROP FUNCTION IF EXISTS public.criar_cadastro_serf(VARCHAR, VARCHAR, VARCHAR, VARCHAR);

CREATE OR REPLACE FUNCTION public.handle_novo_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_perfil VARCHAR := NEW.raw_user_meta_data->>'perfil';
    v_razao  VARCHAR := NEW.raw_user_meta_data->>'razao_social';
    v_cnpj   VARCHAR := NEW.raw_user_meta_data->>'cnpj';
BEGIN
    -- Conta criada fora do fluxo do SERF (painel do Supabase, convite):
    -- não temos dados de empresa, deixa passar e o onboarding resolve.
    IF v_perfil IS NULL OR v_cnpj IS NULL OR v_razao IS NULL THEN
        RETURN NEW;
    END IF;

    IF v_perfil NOT IN ('Comprador', 'Fornecedor', 'Ambos') THEN
        RAISE EXCEPTION 'Perfil inválido: %', v_perfil;
    END IF;

    IF v_cnpj !~ '^[0-9]{14}$' THEN
        RAISE EXCEPTION 'CNPJ deve conter 14 dígitos.';
    END IF;

    IF v_perfil IN ('Comprador', 'Ambos') THEN
        INSERT INTO public.usuarios (auth_user_id, nome_empresa, cnpj, email, perfil)
        VALUES (NEW.id, v_razao, v_cnpj, NEW.email, v_perfil)
        ON CONFLICT (auth_user_id) DO NOTHING;
    END IF;

    IF v_perfil IN ('Fornecedor', 'Ambos') THEN
        INSERT INTO public.fornecedores (auth_user_id, razao_social, cnpj, email, perfil)
        VALUES (NEW.id, v_razao, v_cnpj, NEW.email, v_perfil)
        ON CONFLICT (auth_user_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_novo_usuario_serf ON auth.users;
CREATE TRIGGER tr_novo_usuario_serf
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_novo_usuario();


-- =========================================================================
-- 8) ROW LEVEL SECURITY — contas
-- Sem isso, a chave publishable exposta no front deixa qualquer visitante
-- ler a base inteira de CNPJs, e-mails e telefones.
-- =========================================================================
ALTER TABLE public.usuarios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuarios_dono_le       ON public.usuarios;
DROP POLICY IF EXISTS usuarios_dono_insere   ON public.usuarios;
DROP POLICY IF EXISTS usuarios_dono_atualiza ON public.usuarios;

CREATE POLICY usuarios_dono_le ON public.usuarios
    FOR SELECT TO authenticated USING (auth.uid() = auth_user_id);

CREATE POLICY usuarios_dono_insere ON public.usuarios
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = auth_user_id);

CREATE POLICY usuarios_dono_atualiza ON public.usuarios
    FOR UPDATE TO authenticated
    USING (auth.uid() = auth_user_id)
    WITH CHECK (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS fornecedores_dono_le       ON public.fornecedores;
DROP POLICY IF EXISTS fornecedores_dono_insere   ON public.fornecedores;
DROP POLICY IF EXISTS fornecedores_dono_atualiza ON public.fornecedores;
DROP POLICY IF EXISTS fornecedores_vitrine       ON public.fornecedores;

CREATE POLICY fornecedores_dono_le ON public.fornecedores
    FOR SELECT TO authenticated USING (auth.uid() = auth_user_id);

CREATE POLICY fornecedores_dono_insere ON public.fornecedores
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = auth_user_id);

CREATE POLICY fornecedores_dono_atualiza ON public.fornecedores
    FOR UPDATE TO authenticated
    USING (auth.uid() = auth_user_id)
    WITH CHECK (auth.uid() = auth_user_id);

-- A policy "fornecedores_vitrine" da versão anterior foi REMOVIDA:
-- ela liberava a linha inteira, incluindo email, cnpj e telefone, para
-- qualquer usuário logado. A vitrine agora sai pela view da seção 9.


-- =========================================================================
-- 9) VITRINE PÚBLICA SEM VAZAR CONTATO
-- A view expõe só o que o comprador precisa para escolher um fornecedor.
-- security_invoker = off faz a view ignorar o RLS da tabela base, então
-- ela funciona sem abrir fornecedores para todo mundo.
-- =========================================================================
DROP VIEW IF EXISTS public.vw_fornecedores_publicos;

CREATE VIEW public.vw_fornecedores_publicos
WITH (security_invoker = off) AS
SELECT
    id_fornecedor,
    razao_social,
    nome_fantasia,
    cidade,
    estado,
    nichos,
    raio_atuacao_km
FROM public.fornecedores
WHERE ativo = TRUE
  AND status_cadastro = 'APROVADO'
  AND onboarding_completo = TRUE;

REVOKE ALL ON public.vw_fornecedores_publicos FROM anon;
GRANT SELECT ON public.vw_fornecedores_publicos TO authenticated;

-- Telefone e e-mail do fornecedor só depois que houver relação comercial.
-- Use esta função na tela do pedido, nunca na listagem.
CREATE OR REPLACE FUNCTION public.contato_fornecedor(p_id_fornecedor BIGINT)
RETURNS TABLE (telefone VARCHAR, email VARCHAR, nome_responsavel VARCHAR)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT f.telefone, f.email, f.nome_responsavel
    FROM public.fornecedores f
    WHERE f.id_fornecedor = p_id_fornecedor
      AND f.ativo = TRUE
      AND f.status_cadastro = 'APROVADO'
      AND EXISTS (
          SELECT 1
          FROM public.pedidos pe
          JOIN public.produtos pr ON pr.id_produto = pe.id_produto
          JOIN public.usuarios  u  ON u.id_usuario  = pe.id_usuario
          WHERE pr.id_fornecedor = p_id_fornecedor
            AND u.auth_user_id = auth.uid()
      );
$$;

REVOKE ALL ON FUNCTION public.contato_fornecedor(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contato_fornecedor(BIGINT) TO authenticated;


-- =========================================================================
-- 10) LOGIN POR CNPJ — busca de e-mail com freio contra varredura
--
-- O login precisa resolver CNPJ -> e-mail ANTES de existir sessão, então a
-- função tem que aceitar anon. Para não virar uma API de coleta de e-mails,
-- ela agora registra cada consulta e recusa quando o volume dispara.
--
-- Leia a seção 13(a): a blindagem definitiva é uma Edge Function, que
-- nunca devolve o e-mail ao navegador.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.consultas_cnpj (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cnpj          VARCHAR(14) NOT NULL,
    encontrado    BOOLEAN NOT NULL,
    consultado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_consultas_cnpj_janela
    ON public.consultas_cnpj (consultado_em DESC);

-- RLS ligado e nenhuma policy: só funções SECURITY DEFINER acessam.
ALTER TABLE public.consultas_cnpj ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.email_por_cnpj(p_cnpj VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email       VARCHAR;
    v_total_geral INTEGER;
    v_total_cnpj  INTEGER;
BEGIN
    IF p_cnpj IS NULL OR p_cnpj !~ '^[0-9]{14}$' THEN
        RETURN NULL;
    END IF;

    -- Limpa o histórico velho para a tabela não crescer sem fim.
    DELETE FROM public.consultas_cnpj WHERE consultado_em < NOW() - INTERVAL '2 hours';

    SELECT COUNT(*) INTO v_total_geral
    FROM public.consultas_cnpj
    WHERE consultado_em > NOW() - INTERVAL '10 minutes';

    SELECT COUNT(*) INTO v_total_cnpj
    FROM public.consultas_cnpj
    WHERE cnpj = p_cnpj AND consultado_em > NOW() - INTERVAL '10 minutes';

    -- Ajuste os números conforme o volume real da plataforma crescer.
    IF v_total_geral > 120 OR v_total_cnpj > 10 THEN
        RAISE EXCEPTION 'Muitas tentativas. Aguarde alguns minutos.';
    END IF;

    SELECT email INTO v_email FROM (
        SELECT email FROM public.usuarios     WHERE cnpj = p_cnpj AND ativo = TRUE
        UNION ALL
        SELECT email FROM public.fornecedores WHERE cnpj = p_cnpj AND ativo = TRUE
    ) t LIMIT 1;

    INSERT INTO public.consultas_cnpj (cnpj, encontrado)
    VALUES (p_cnpj, v_email IS NOT NULL);

    RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.email_por_cnpj(VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_por_cnpj(VARCHAR) TO anon, authenticated;

-- Checagem prévia no cadastro: devolve só TRUE/FALSE, nunca o e-mail.
-- Serve para avisar "CNPJ já cadastrado" antes de chamar o signUp.
CREATE OR REPLACE FUNCTION public.cnpj_existe(p_cnpj VARCHAR)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.usuarios     WHERE cnpj = p_cnpj
        UNION ALL
        SELECT 1 FROM public.fornecedores WHERE cnpj = p_cnpj
    );
$$;

REVOKE ALL ON FUNCTION public.cnpj_existe(VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cnpj_existe(VARCHAR) TO anon, authenticated;


-- =========================================================================
-- 11) FUNÇÕES DE APOIO AO RLS
-- Policies que consultam outra tabela também sofrem o RLS dessa tabela.
-- Estas funções são SECURITY DEFINER justamente para quebrar esse ciclo.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.meu_id_usuario()
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
    SELECT id_usuario FROM public.usuarios WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.meu_id_fornecedor()
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
    SELECT id_fornecedor FROM public.fornecedores WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fornecedor_do_produto(p_id_produto BIGINT)
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
    SELECT id_fornecedor FROM public.produtos WHERE id_produto = p_id_produto;
$$;

CREATE OR REPLACE FUNCTION public.fornecedor_aprovado(p_id_fornecedor BIGINT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.fornecedores
        WHERE id_fornecedor = p_id_fornecedor
          AND ativo = TRUE
          AND status_cadastro = 'APROVADO'
    );
$$;

GRANT EXECUTE ON FUNCTION public.meu_id_usuario()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.meu_id_fornecedor()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.fornecedor_do_produto(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fornecedor_aprovado(BIGINT)   TO authenticated;


-- =========================================================================
-- 12) ROW LEVEL SECURITY — produtos e pedidos
-- Sem isso, qualquer pessoa com a chave publishable edita seu catálogo e
-- lê os pedidos de todo mundo.
-- =========================================================================
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS produtos_dono_gerencia ON public.produtos;
DROP POLICY IF EXISTS produtos_catalogo      ON public.produtos;

-- O fornecedor manda no próprio catálogo.
CREATE POLICY produtos_dono_gerencia ON public.produtos
    FOR ALL TO authenticated
    USING (id_fornecedor = public.meu_id_fornecedor())
    WITH CHECK (id_fornecedor = public.meu_id_fornecedor());

-- Qualquer logado vê produtos ativos de fornecedor aprovado.
CREATE POLICY produtos_catalogo ON public.produtos
    FOR SELECT TO authenticated
    USING (ativo = TRUE AND public.fornecedor_aprovado(id_fornecedor));

DROP POLICY IF EXISTS pedidos_le       ON public.pedidos;
DROP POLICY IF EXISTS pedidos_cria     ON public.pedidos;
DROP POLICY IF EXISTS pedidos_atualiza ON public.pedidos;

-- Comprador vê os pedidos que fez; fornecedor vê os que caíram nele.
CREATE POLICY pedidos_le ON public.pedidos
    FOR SELECT TO authenticated
    USING (
        id_usuario = public.meu_id_usuario()
        OR public.fornecedor_do_produto(id_produto) = public.meu_id_fornecedor()
    );

-- Só dá para comprar em nome próprio, e só de fornecedor aprovado.
CREATE POLICY pedidos_cria ON public.pedidos
    FOR INSERT TO authenticated
    WITH CHECK (
        id_usuario = public.meu_id_usuario()
        AND public.fornecedor_aprovado(public.fornecedor_do_produto(id_produto))
    );

-- Os dois lados mexem no status (cancelar / confirmar / enviar).
CREATE POLICY pedidos_atualiza ON public.pedidos
    FOR UPDATE TO authenticated
    USING (
        id_usuario = public.meu_id_usuario()
        OR public.fornecedor_do_produto(id_produto) = public.meu_id_fornecedor()
    )
    WITH CHECK (
        id_usuario = public.meu_id_usuario()
        OR public.fornecedor_do_produto(id_produto) = public.meu_id_fornecedor()
    );


-- =========================================================================
-- 13) O QUE NÃO SE RESOLVE COM SQL — leia antes de ir para produção
--
-- a) O login por CNPJ devolve o e-mail ao navegador. É inerente ao formato:
--    o signInWithPassword roda no cliente e precisa do e-mail. O freio da
--    seção 10 corta a varredura em massa, mas não elimina o vazamento.
--    Blindagem real: uma Edge Function que recebe CNPJ + senha, resolve o
--    e-mail no servidor, autentica e devolve só a sessão.
--
-- b) Migração de contas antigas. Quem se cadastrou antes desta migração
--    está com perfil NULL e onboarding_completo = FALSE, e vai cair no
--    onboarding no próximo login. É o comportamento correto, mas avise
--    essas pessoas. Para preencher o perfil de quem já existe:
--
--       UPDATE public.usuarios     SET perfil = 'Comprador'  WHERE perfil IS NULL;
--       UPDATE public.fornecedores SET perfil = 'Fornecedor' WHERE perfil IS NULL;
--
--    Contas presentes nas DUAS tabelas devem virar 'Ambos':
--
--       UPDATE public.usuarios u SET perfil = 'Ambos'
--       WHERE EXISTS (SELECT 1 FROM public.fornecedores f
--                     WHERE f.auth_user_id = u.auth_user_id);
--       UPDATE public.fornecedores f SET perfil = 'Ambos'
--       WHERE EXISTS (SELECT 1 FROM public.usuarios u
--                     WHERE u.auth_user_id = f.auth_user_id);
--
-- c) status_cadastro nunca sai de PENDENTE sozinho. Alguém precisa aprovar.
--    Enquanto não existir tela de administração, aprove na mão:
--
--       UPDATE public.fornecedores SET status_cadastro = 'APROVADO'
--       WHERE cnpj = '00000000000000';
--
-- d) Painel do Supabase: Authentication > URL Configuration.
--    Cadastre a Site URL e inclua a URL de redefinir-senha.html em
--    "Redirect URLs", senão o link de recuperação não volta para o site.
-- =========================================================================
