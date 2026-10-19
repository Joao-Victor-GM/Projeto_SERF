-- S.E.R.F. - Primeiros passos (onboarding) e homologação por CNPJ
-- Banco utilizado: PostgreSQL/Supabase
--
-- Executar DEPOIS da 018.
-- Pode ser executado mais de uma vez (idempotente).
--
-- 1. primeiros_passos(): o que a empresa logada já fez (perfil completo,
--    primeiro produto, primeiro pedido, primeira mensagem, CNPJ verificado).
--    A Home mostra um checklist até tudo estar feito.
-- 2. Homologação: o resultado da verificação do CNPJ na Receita (Edge
--    Function homologar-fornecedor) fica registrado no fornecedor. Só a
--    função (service role) grava status_cadastro: o navegador não tem
--    GRANT nessa coluna (migration 006).


-- ==========================================================
-- 1. REGISTRO DA HOMOLOGAÇÃO
-- ==========================================================

ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS homologacao_motivo VARCHAR(300);
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS homologacao_em TIMESTAMPTZ;


-- ==========================================================
-- 2. PRIMEIROS PASSOS
-- SECURITY DEFINER, mas só olha a empresa de auth.uid():
-- não recebe parâmetro, não expõe dados de terceiros.
-- Passos que não se aplicam ao perfil vêm como null.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.primeiros_passos()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid        UUID := auth.uid();
    v_comprador  public.usuarios%ROWTYPE;
    v_fornecedor public.fornecedores%ROWTYPE;
    v_perfil     TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_comprador FROM public.usuarios WHERE auth_user_id = v_uid;
    SELECT * INTO v_fornecedor FROM public.fornecedores WHERE auth_user_id = v_uid;

    v_perfil := CASE
        WHEN v_comprador.id_usuario IS NOT NULL AND v_fornecedor.id_fornecedor IS NOT NULL THEN 'Ambos'
        WHEN v_fornecedor.id_fornecedor IS NOT NULL THEN 'Fornecedor'
        WHEN v_comprador.id_usuario IS NOT NULL THEN 'Comprador'
    END;

    IF v_perfil IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'perfil', v_perfil,

        -- Telefone e nicho em cada papel; fornecedor também cidade/UF (aparece no catálogo)
        'perfil_completo',
            (v_comprador.id_usuario IS NULL
                OR (NULLIF(btrim(v_comprador.telefone), '') IS NOT NULL AND NULLIF(btrim(v_comprador.nicho), '') IS NOT NULL))
            AND (v_fornecedor.id_fornecedor IS NULL
                OR (NULLIF(btrim(v_fornecedor.telefone), '') IS NOT NULL AND NULLIF(btrim(v_fornecedor.nicho), '') IS NOT NULL
                    AND NULLIF(btrim(v_fornecedor.cidade), '') IS NOT NULL AND v_fornecedor.estado IS NOT NULL)),

        'cadastrou_produto', CASE WHEN v_fornecedor.id_fornecedor IS NULL THEN NULL ELSE
            EXISTS (SELECT 1 FROM public.produtos WHERE id_fornecedor = v_fornecedor.id_fornecedor) END,

        'cnpj_verificado', CASE WHEN v_fornecedor.id_fornecedor IS NULL THEN NULL ELSE
            v_fornecedor.status_cadastro = 'APROVADO' END,

        'fez_pedido', CASE WHEN v_comprador.id_usuario IS NULL THEN NULL ELSE
            EXISTS (SELECT 1 FROM public.pedidos WHERE id_usuario = v_comprador.id_usuario) END,

        'enviou_mensagem', EXISTS (SELECT 1 FROM public.mensagens_pedidos WHERE id_remetente = v_uid)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.primeiros_passos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.primeiros_passos() TO authenticated;

NOTIFY pgrst, 'reload schema';
