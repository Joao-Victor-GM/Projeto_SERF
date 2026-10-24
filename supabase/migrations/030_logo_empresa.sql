-- S.E.R.F. - Logo (foto de perfil) da empresa
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 029.
-- Pode ser executado mais de uma vez (idempotente).
--
-- O que este script faz:
--   1. Coluna logo_url em usuarios e fornecedores (endereço público da
--      imagem no Supabase Storage). Só a própria empresa altera (o RLS da
--      004 limita o UPDATE ao próprio cadastro; aqui liberamos a coluna).
--   2. fornecedores_publicos e fornecedores_vitrine passam a expor logo_url,
--      para a área de Empresas mostrar o logo no lugar da inicial.
--   3. Bucket "logos" no Storage: leitura pública; cada empresa só grava na
--      própria pasta (<auth.uid()>/logo). Imagem de até 1 MB (PNG, JPEG ou
--      WebP); o perfil já reduz a imagem antes de enviar.
--
-- A CSP das páginas libera img-src para o domínio do Supabase (o logo vem
-- do Storage). Sem esta migration, o envio do logo falha com um aviso de
-- erro e as telas seguem mostrando a inicial do nome.


-- ==========================================================
-- 1. COLUNAS
-- ==========================================================

ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Só endereços do bucket "logos" (nada de imagem externa apontada pela API)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuarios_logo_url') THEN
        ALTER TABLE public.usuarios ADD CONSTRAINT ck_usuarios_logo_url CHECK (
            logo_url IS NULL OR (length(logo_url) <= 500
                AND logo_url LIKE 'https://%/storage/v1/object/public/logos/%'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_fornecedores_logo_url') THEN
        ALTER TABLE public.fornecedores ADD CONSTRAINT ck_fornecedores_logo_url CHECK (
            logo_url IS NULL OR (length(logo_url) <= 500
                AND logo_url LIKE 'https://%/storage/v1/object/public/logos/%'));
    END IF;
END $$;

GRANT UPDATE (logo_url) ON public.usuarios TO authenticated;
GRANT UPDATE (logo_url) ON public.fornecedores TO authenticated;


-- ==========================================================
-- 2. VIEWS PÚBLICAS (logo_url no fim: CREATE OR REPLACE só acrescenta)
-- ==========================================================

CREATE OR REPLACE VIEW public.fornecedores_publicos AS
    SELECT id_fornecedor,
           razao_social,
           nome_fantasia,
           cidade,
           estado,
           nicho,
           logo_url
      FROM public.fornecedores;

-- Mesma definição da 011, com logo_url no fim
CREATE OR REPLACE VIEW public.fornecedores_vitrine AS
WITH estatisticas AS (
    SELECT pr.id_fornecedor,
           COUNT(*) FILTER (WHERE pe.status_pedido = 'ENTREGUE')                  AS pedidos_entregues,
           COUNT(*) FILTER (WHERE pe.status_pedido = 'CANCELADO')                 AS pedidos_cancelados,
           COUNT(DISTINCT pe.id_usuario) FILTER (WHERE pe.status_pedido <> 'CANCELADO') AS clientes_atendidos,
           AVG(EXTRACT(EPOCH FROM (pe.data_resposta - pe.data_pedido)) / 3600.0)
               FILTER (WHERE pe.data_resposta IS NOT NULL AND pe.data_resposta >= pe.data_pedido)
                                                                                  AS tempo_resposta_horas,
           AVG(EXTRACT(EPOCH FROM (pe.data_entrega - pe.data_pedido)) / 86400.0)
               FILTER (WHERE pe.data_entrega IS NOT NULL AND pe.data_entrega >= pe.data_pedido)
                                                                                  AS prazo_entrega_dias
      FROM public.pedidos pe
      JOIN public.produtos pr ON pr.id_produto = pe.id_produto
     GROUP BY pr.id_fornecedor
),
catalogo AS (
    SELECT id_fornecedor,
           COUNT(*)                     AS produtos_ativos,
           array_agg(DISTINCT categoria) FILTER (WHERE categoria IS NOT NULL) AS categorias,
           MIN(preco_atacado)           AS menor_preco
      FROM public.produtos
     WHERE ativo
     GROUP BY id_fornecedor
)
SELECT f.id_fornecedor,
       f.razao_social,
       f.nome_fantasia,
       f.cidade,
       f.estado,
       f.nicho,
       (f.status_cadastro = 'APROVADO')                         AS homologado,
       f.data_cadastro,
       COALESCE(c.produtos_ativos, 0)                           AS produtos_ativos,
       COALESCE(c.categorias, ARRAY[]::VARCHAR[])               AS categorias,
       c.menor_preco,
       COALESCE(e.pedidos_entregues, 0)                         AS pedidos_entregues,
       COALESCE(e.pedidos_cancelados, 0)                        AS pedidos_cancelados,
       COALESCE(e.clientes_atendidos, 0)                        AS clientes_atendidos,
       CASE WHEN COALESCE(e.pedidos_entregues, 0) + COALESCE(e.pedidos_cancelados, 0) > 0
            THEN round(e.pedidos_entregues::NUMERIC / (e.pedidos_entregues + e.pedidos_cancelados), 4)
       END                                                      AS taxa_entrega,
       round(e.tempo_resposta_horas::NUMERIC, 1)                AS tempo_resposta_horas,
       round(e.prazo_entrega_dias::NUMERIC, 1)                  AS prazo_entrega_dias,
       f.logo_url
  FROM public.fornecedores f
  LEFT JOIN catalogo c     ON c.id_fornecedor = f.id_fornecedor
  LEFT JOIN estatisticas e ON e.id_fornecedor = f.id_fornecedor
 WHERE f.ativo;

-- Views: só leitura, só para quem tem login (regra da 028)
REVOKE ALL ON public.fornecedores_publicos FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.fornecedores_publicos FROM authenticated;
GRANT SELECT ON public.fornecedores_publicos TO authenticated;

REVOKE ALL ON public.fornecedores_vitrine FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.fornecedores_vitrine FROM authenticated;
GRANT SELECT ON public.fornecedores_vitrine TO authenticated;


-- ==========================================================
-- 3. STORAGE: bucket "logos"
-- Só roda onde o Storage existe (no Supabase); o banco de testes
-- (tests/banco, sem o schema storage) pula esta parte.
-- ==========================================================

DO $$
BEGIN
    IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
        RAISE NOTICE 'Schema storage ausente: bucket "logos" não criado.';
        RETURN;
    END IF;

    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('logos', 'logos', TRUE, 1048576, ARRAY['image/png', 'image/jpeg', 'image/webp'])
    ON CONFLICT (id) DO UPDATE
        SET public = EXCLUDED.public,
            file_size_limit = EXCLUDED.file_size_limit,
            allowed_mime_types = EXCLUDED.allowed_mime_types;

    -- Cada empresa mexe só na própria pasta: logos/<auth.uid()>/...
    -- (SELECT é exigido pelo upload com upsert; a leitura pública da imagem
    -- não depende dele, pois o bucket é público.)
    EXECUTE 'DROP POLICY IF EXISTS logos_select_propria ON storage.objects';
    EXECUTE $p$CREATE POLICY logos_select_propria ON storage.objects FOR SELECT TO authenticated
        USING (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text)$p$;

    EXECUTE 'DROP POLICY IF EXISTS logos_insert_propria ON storage.objects';
    EXECUTE $p$CREATE POLICY logos_insert_propria ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text)$p$;

    EXECUTE 'DROP POLICY IF EXISTS logos_update_propria ON storage.objects';
    EXECUTE $p$CREATE POLICY logos_update_propria ON storage.objects FOR UPDATE TO authenticated
        USING (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text)
        WITH CHECK (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text)$p$;

    EXECUTE 'DROP POLICY IF EXISTS logos_delete_propria ON storage.objects';
    EXECUTE $p$CREATE POLICY logos_delete_propria ON storage.objects FOR DELETE TO authenticated
        USING (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text)$p$;
END $$;

NOTIFY pgrst, 'reload schema';
