-- S.E.R.F. - Estrutura inicial do banco de dados
-- Banco utilizado: PostgreSQL/Supabase

-- ATENÇÃO: os comandos abaixo apagam as tabelas existentes.
-- Por segurança, foram mantidos desativados com comentários.

-- DROP TABLE IF EXISTS public.pedidos CASCADE;
-- DROP TABLE IF EXISTS public.produtos CASCADE;
-- DROP TABLE IF EXISTS public.fornecedores CASCADE;
-- DROP TABLE IF EXISTS public.usuarios CASCADE;


-- TABELA USUÁRIOS
-- Armazena as empresas compradoras cadastradas no sistema.

CREATE TABLE public.usuarios (
    id_usuario BIGINT GENERATED ALWAYS AS IDENTITY,
    auth_user_id UUID UNIQUE, -- Liga o cadastro ao login do Supabase
    nome_empresa VARCHAR(150) NOT NULL,
    cnpj VARCHAR(14) NOT NULL UNIQUE,
    nome_responsavel VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    telefone VARCHAR(20),
    status_cadastro VARCHAR(30) NOT NULL DEFAULT 'PENDENTE_EMAIL',
    data_cadastro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT pk_usuarios PRIMARY KEY (id_usuario),

    CONSTRAINT fk_usuarios_auth
        FOREIGN KEY (auth_user_id)
        REFERENCES auth.users (id)
        ON DELETE CASCADE,

    CONSTRAINT ck_usuarios_status
        CHECK (status_cadastro IN (
            'PENDENTE_EMAIL',
            'PENDENTE_VALIDACAO',
            'APROVADA',
            'REPROVADA',
            'CONTESTADA',
            'BLOQUEADA'
        ))
);


-- TABELA FORNECEDORES
-- Armazena as empresas que fornecem os produtos.

CREATE TABLE public.fornecedores (
    id_fornecedor BIGINT GENERATED ALWAYS AS IDENTITY,
    auth_user_id UUID UNIQUE, -- Liga o fornecedor ao login do Supabase
    razao_social VARCHAR(150) NOT NULL,
    nome_fantasia VARCHAR(150),
    cnpj VARCHAR(14) NOT NULL UNIQUE,
    email VARCHAR(150) NOT NULL UNIQUE,
    telefone VARCHAR(20),
    cidade VARCHAR(100),
    estado CHAR(2),
    status_cadastro VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
    data_cadastro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT pk_fornecedores PRIMARY KEY (id_fornecedor),

    CONSTRAINT fk_fornecedores_auth
        FOREIGN KEY (auth_user_id)
        REFERENCES auth.users (id)
        ON DELETE CASCADE,

    CONSTRAINT ck_fornecedores_status
        CHECK (status_cadastro IN (
            'PENDENTE',
            'APROVADO',
            'REPROVADO',
            'BLOQUEADO'
        ))
);


-- TABELA PRODUTOS
-- Armazena os produtos oferecidos pelos fornecedores.

CREATE TABLE public.produtos (
    id_produto BIGINT GENERATED ALWAYS AS IDENTITY,
    id_fornecedor BIGINT NOT NULL, -- Identifica o fornecedor do produto
    nome_produto VARCHAR(150) NOT NULL,
    descricao VARCHAR(500),
    categoria VARCHAR(100),
    marca VARCHAR(100),
    preco_atacado NUMERIC(12,2) NOT NULL,
    quantidade_minima INTEGER NOT NULL,
    quantidade_estoque INTEGER NOT NULL DEFAULT 0,
    data_cadastro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT pk_produtos PRIMARY KEY (id_produto),

    CONSTRAINT fk_produtos_fornecedores
        FOREIGN KEY (id_fornecedor)
        REFERENCES public.fornecedores (id_fornecedor)
        ON DELETE CASCADE,

    CONSTRAINT ck_produtos_preco CHECK (preco_atacado > 0),
    CONSTRAINT ck_produtos_quantidade_minima CHECK (quantidade_minima > 0),
    CONSTRAINT ck_produtos_estoque CHECK (quantidade_estoque >= 0)
);


-- TABELA PEDIDOS
-- Registra os produtos comprados pelos usuários.

CREATE TABLE public.pedidos (
    id_pedido BIGINT GENERATED ALWAYS AS IDENTITY,
    id_usuario BIGINT NOT NULL, -- Identifica quem realizou o pedido
    id_produto BIGINT NOT NULL, -- Identifica o produto comprado
    quantidade INTEGER NOT NULL,
    valor_unitario NUMERIC(12,2) NOT NULL,

    -- Calcula automaticamente quantidade × valor unitário
    valor_total NUMERIC(12,2)
        GENERATED ALWAYS AS (quantidade * valor_unitario) STORED,

    status_pedido VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
    observacao VARCHAR(500),
    data_pedido TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_pedidos PRIMARY KEY (id_pedido),

    CONSTRAINT fk_pedidos_usuarios
        FOREIGN KEY (id_usuario)
        REFERENCES public.usuarios (id_usuario)
        ON DELETE CASCADE,

    CONSTRAINT fk_pedidos_produtos
        FOREIGN KEY (id_produto)
        REFERENCES public.produtos (id_produto)
        ON DELETE CASCADE,

    CONSTRAINT ck_pedidos_quantidade CHECK (quantidade > 0),
    CONSTRAINT ck_pedidos_valor_unitario CHECK (valor_unitario > 0),

    CONSTRAINT ck_pedidos_status
        CHECK (status_pedido IN (
            'PENDENTE',
            'CONFIRMADO',
            'EM_SEPARACAO',
            'ENVIADO',
            'ENTREGUE',
            'CANCELADO'
        ))
);
