-- S.E.R.F. - Índices que faltavam e limites contra abuso
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 029.
-- Pode ser executado mais de uma vez (idempotente).
--
-- 1. Índices em chaves estrangeiras que eram varridas por inteiro:
--    produtos.categoria (catálogo filtrado por segmento, radar, aviso de
--    produto novo), mensagens_pedidos.id_remetente (exportação LGPD e
--    exclusão de conta), notificacoes_email.auth_user_id (exclusão de
--    conta), propostas.id_produto e cotacoes.id_proposta_aceita (apagar
--    produto/proposta varria a tabela toda).
-- 2. Busca do catálogo por nome: índice de trigramas (pg_trgm), para o
--    ILIKE '%termo%' não varrer todos os produtos.
-- 3. Limites de frequência (um usuário abusivo não inunda os outros):
--    - chat: 20 mensagens por minuto por remetente;
--    - produtos: 60 cadastros por hora por fornecedor;
--    - cotações: 10 publicações por hora por comprador (já há o teto de 20
--      abertas; este limita o "abre e cancela" para disparar avisos).


-- ==========================================================
-- 1. ÍNDICES EM CHAVES ESTRANGEIRAS
-- ==========================================================

CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON public.produtos (categoria);
CREATE INDEX IF NOT EXISTS idx_mensagens_remetente ON public.mensagens_pedidos (id_remetente, data_envio DESC);
CREATE INDEX IF NOT EXISTS idx_notificacoes_email_usuario ON public.notificacoes_email (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_propostas_produto ON public.propostas (id_produto);
CREATE INDEX IF NOT EXISTS idx_cotacoes_proposta_aceita ON public.cotacoes (id_proposta_aceita) WHERE id_proposta_aceita IS NOT NULL;

-- Catálogo: produtos ativos mais recentes e por preço (ordenações da tela)
CREATE INDEX IF NOT EXISTS idx_produtos_ativos_recentes ON public.produtos (id_produto DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_produtos_ativos_preco ON public.produtos (preco_atacado) WHERE ativo;


-- ==========================================================
-- 2. BUSCA POR NOME (trigramas)
-- Sem a extensão (ambiente sem permissão), a busca segue funcionando,
-- só sem o índice.
-- ==========================================================

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[SERF] pg_trgm indisponível: busca do catálogo sem índice de texto.';
    END;
END $$;

DO $$
DECLARE
    v_esquema TEXT;
BEGIN
    SELECT n.nspname INTO v_esquema
      FROM pg_opclass o JOIN pg_namespace n ON n.oid = o.opcnamespace
     WHERE o.opcname = 'gin_trgm_ops' LIMIT 1;

    IF v_esquema IS NOT NULL THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_produtos_nome_trgm ON public.produtos USING gin (nome_produto %I.gin_trgm_ops) WHERE ativo', v_esquema);
    END IF;
END $$;


-- ==========================================================
-- 3. LIMITES DE FREQUÊNCIA
-- ==========================================================

CREATE OR REPLACE FUNCTION public.mensagens_limitar_frequencia()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (SELECT COUNT(*) FROM public.mensagens_pedidos
         WHERE id_remetente = NEW.id_remetente AND data_envio > NOW() - INTERVAL '1 minute') >= 20 THEN
        RAISE EXCEPTION 'Muitas mensagens em pouco tempo. Aguarde um minuto.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mensagens_frequencia ON public.mensagens_pedidos;
CREATE TRIGGER trg_mensagens_frequencia
    BEFORE INSERT ON public.mensagens_pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.mensagens_limitar_frequencia();

CREATE OR REPLACE FUNCTION public.produtos_limitar_frequencia()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (SELECT COUNT(*) FROM public.produtos
         WHERE id_fornecedor = NEW.id_fornecedor AND data_cadastro > NOW() - INTERVAL '1 hour') >= 60 THEN
        RAISE EXCEPTION 'Limite de 60 produtos cadastrados por hora atingido. Tente novamente mais tarde.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_produtos_frequencia ON public.produtos;
CREATE TRIGGER trg_produtos_frequencia
    BEFORE INSERT ON public.produtos
    FOR EACH ROW
    EXECUTE FUNCTION public.produtos_limitar_frequencia();

CREATE OR REPLACE FUNCTION public.cotacoes_limitar_frequencia()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (SELECT COUNT(*) FROM public.cotacoes
         WHERE id_usuario = NEW.id_usuario AND criada_em > NOW() - INTERVAL '1 hour') >= 10 THEN
        RAISE EXCEPTION 'Limite de 10 cotações por hora atingido. Tente novamente mais tarde.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cotacoes_frequencia ON public.cotacoes;
CREATE TRIGGER trg_cotacoes_frequencia
    BEFORE INSERT ON public.cotacoes
    FOR EACH ROW
    EXECUTE FUNCTION public.cotacoes_limitar_frequencia();

NOTIFY pgrst, 'reload schema';
