# SERF — Sistema Empresarial de Relacionamento com Fornecedores

O **SERF** é um projeto acadêmico desenvolvido no curso de Análise e Desenvolvimento de Sistemas (ADS), com o objetivo de criar uma plataforma B2B para facilitar o relacionamento entre empresas compradoras e fornecedores.

## Objetivo do Projeto

Centralizar em um único ambiente processos relacionados ao cadastro de empresas, fornecedores, produtos e pedidos, criando uma base organizada para a comunicação e gestão das relações comerciais entre empresas.

## Estrutura do Projeto

O repositório está organizado em áreas de responsabilidade:

- `frontend/` — interfaces e experiência do usuário;
- `backend/` — lógica e serviços do sistema;
- `supabase/` — estrutura e evolução do banco de dados;
- `docs/` — documentação técnica e funcional do projeto.

## Frontend

O frontend está organizado em:

- `pages/public/` — páginas públicas: a página inicial (`index.html`), login e cadastro;
- `pages/app/` — páginas internas da aplicação;
- `css/` — estilos da interface;
- `js/` — scripts e comportamentos do frontend;
- `assets/` — imagens, ícones e logotipos.

## Banco de Dados

O projeto utiliza **Supabase** para gerenciamento do banco de dados.

As alterações estruturais do banco são registradas em:

`supabase/migrations/`

## Testes

```bash
npm install
npx playwright install chromium
npm test
```

Detalhes em [`docs/arquitetura.md`](docs/arquitetura.md#testes).

## Documentação

A pasta `docs/` concentra a documentação técnica e funcional do projeto, incluindo:

- arquitetura;
- regras de negócio;
- casos de uso;
- registro consolidado do backlog.

O gerenciamento operacional das tarefas e do backlog é realizado através do **Jira**.

## Organização do Desenvolvimento

O desenvolvimento do SERF utiliza Git e GitHub para controle de versão e colaboração entre os integrantes.

As funcionalidades podem ser desenvolvidas em branches separadas e posteriormente integradas ao projeto através de Pull Requests.

## Status

Projeto acadêmico em desenvolvimento.

A estrutura, documentação e funcionalidades serão atualizadas conforme a evolução do projeto.
