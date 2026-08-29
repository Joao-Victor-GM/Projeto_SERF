-- S.E.R.F. - Estrutura inicial do banco de dados
-- Banco: PostgreSQL / Supabase
-- Este arquivo contém somente a estrutura das tabelas.
-- Não contém registros, senhas, tokens ou chaves de acesso.

CREATE TABLE public.usuarios
(
    id_usuario BIGINT GENERATED ALWAYS AS IDENTITY,
    auth_user_id UUID UNIQUE,
    nome_empresa VARCHAR(150) NOT NULL,
    cnpj VARCHAR(14) NOT NULL,
    nome_responsavel VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    telefone VARCHAR(20),
    status_cadastro VARCHAR(30) NOT NULL DEFAULT 'PENDENTE_EMAIL',
    data_cadastro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT pk_usuarios
        PRIMARY KEY (id_usuario),

    CONSTRAINT uq_usuarios_cnpj
        UNIQUE (cnpj),

    CONSTRAINT uq_usuarios_email
        UNIQUE (email),

    CONSTRAINT fk_usuarios_auth
        FOREIGN KEY (auth_user_id)
        REFERENCES auth.users (id)
        ON DELETE CASCADE,

    CONSTRAINT ck_usuarios_status
        CHECK
        (
            status_cadastro IN
            (
                'PENDENTE_EMAIL',
                'PENDENTE_VALIDACAO',
                'APROVADA',
                'REPROVADA',
                'CONTESTADA',
                'BLOQUEADA'
            )
        )
);

CREATE TABLE public.fornecedores
(
    id_fornecedor BIGINT GENERATED ALWAYS AS IDENTITY,
    razao_social VARCHAR(150) NOT NULL,
    nome_fantasia VARCHAR(150),
    cnpj VARCHAR(14) NOT NULL,
    email VARCHAR(150) NOT NULL,
    telefone VARCHAR(20),
    cidade VARCHAR(100),
    estado CHAR(2),
    status_cadastro VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
    data_cadastro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT pk_fornecedores
        PRIMARY KEY (id_fornecedor),

    CONSTRAINT uq_fornecedores_cnpj
        UNIQUE (cnpj),

    CONSTRAINT uq_fornecedores_email
        UNIQUE (email),

    CONSTRAINT ck_fornecedores_status
        CHECK
        (
            status_cadastro IN
            (
                'PENDENTE',
                'APROVADO',
                'REPROVADO',
                'BLOQUEADO'
            )
        )
);

CREATE TABLE public.produtos
(
    id_produto BIGINT GENERATED ALWAYS AS IDENTITY,
    id_fornecedor BIGINT NOT NULL,
    nome_produto VARCHAR(150) NOT NULL,
    descricao VARCHAR(500),
    categoria VARCHAR(100),
    marca VARCHAR(100),
    preco_atacado NUMERIC(12,2) NOT NULL,
    quantidade_minima INTEGER NOT NULL,
    quantidade_estoque INTEGER NOT NULL DEFAULT 0,
    data_cadastro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT pk_produtos
        PRIMARY KEY (id_produto),

    CONSTRAINT fk_produtos_fornecedores
        FOREIGN KEY (id_fornecedor)
        REFERENCES public.fornecedores (id_fornecedor),

    CONSTRAINT ck_produtos_preco
        CHECK (preco_atacado > 0),

    CONSTRAINT ck_produtos_quantidade_minima
        CHECK (quantidade_minima > 0),

    CONSTRAINT ck_produtos_estoque
        CHECK (quantidade_estoque >= 0)
);

CREATE TABLE public.pedidos
(
    id_pedido BIGINT GENERATED ALWAYS AS IDENTITY,
    id_usuario BIGINT NOT NULL,
    id_produto BIGINT NOT NULL,
    quantidade INTEGER NOT NULL,
    valor_unitario NUMERIC(12,2) NOT NULL,
    valor_total NUMERIC(12,2)
        GENERATED ALWAYS AS (quantidade * valor_unitario) STORED,
    status_pedido VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
    observacao VARCHAR(500),
    data_pedido TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_pedidos
        PRIMARY KEY (id_pedido),

    CONSTRAINT fk_pedidos_usuarios
        FOREIGN KEY (id_usuario)
        REFERENCES public.usuarios (id_usuario),

    CONSTRAINT fk_pedidos_produtos
        FOREIGN KEY (id_produto)
        REFERENCES public.produtos (id_produto),

    CONSTRAINT ck_pedidos_quantidade
        CHECK (quantidade > 0),

    CONSTRAINT ck_pedidos_valor_unitario
        CHECK (valor_unitario > 0),

    CONSTRAINT ck_pedidos_status
        CHECK
        (
            status_pedido IN
            (
                'PENDENTE',
                'CONFIRMADO',
                'EM_SEPARACAO',
                'ENVIADO',
                'ENTREGUE',
                'CANCELADO'
            )
        )
);
