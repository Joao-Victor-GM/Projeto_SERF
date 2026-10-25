# Segurança do S.E.R.F.

Nenhum sistema é "à prova de invasão". O objetivo aqui é fechar as portas
conhecidas, limitar o estrago se algo falhar e manter isso verificado
automaticamente (testes + CI). Este documento diz o que já está garantido,
o que foi corrigido na auditoria de outubro/2026 e o que depende de
configuração ao publicar.

## Modelo de ameaça

| Quem | Pode | Defesa principal |
|---|---|---|
| Visitante sem login | Chamar a API REST do Supabase com a chave pública | RLS: sem login só lê `categorias` |
| Empresa logada mal-intencionada | Chamar qualquer tabela/RPC com o próprio login; gravar texto malicioso em nomes, produtos, mensagens | RLS + regras no banco (preço, estoque, status, pagamento) + escape de HTML + CSP |
| Script de terceiro (CDN adulterado) | Rodar código nas páginas | SRI (hash) + versões fixas + CSP |
| Site falso que embute o S.E.R.F. | Clickjacking | `frame-ancestors 'none'` / `X-Frame-Options: DENY` |
| Quem rouba a senha de um administrador | Tudo | 2FA nas contas (fora do código) |

**A chave do Supabase no front-end é pública por natureza** (`sb_publishable_…`).
Ela não dá poder nenhum além do que o RLS permite. A chave secreta
(`service_role`) só existe nos segredos das Edge Functions e **nunca** foi
versionada (histórico verificado).

## Camadas que existem hoje

1. **Banco (o que de fato protege):**
   - RLS em todas as tabelas; views do navegador só leitura;
   - escrita sensível só por funções que conferem quem chama;
   - preço, estoque, transições de status e "pago" decididos no banco;
   - no modo REAL, "pago" e "NF-e autorizada" só pelo provedor.
2. **Invariantes testados** (`tests/banco/invariantes.sql`, também no
   Postgres do Supabase na CI):
   - toda tabela com RLS;
   - `SECURITY DEFINER` sempre com `search_path` fixo;
   - funções do servidor fora do alcance do navegador;
   - nenhuma escrita para visitante;
   - nenhuma escrita em view;
   - nenhum `TRUNCATE` para o navegador;
   - migrations reaplicáveis.
3. **Front-end:**
   - todo dado do banco é escapado antes de virar HTML;
   - títulos do SweetAlert sempre como texto (`titleText`);
   - nenhum script inline nem `onclick=` (a CSP proíbe);
   - SRI nos scripts de CDN;
   - o logout limpa os dados de exibição do navegador.
4. **CSP** (em `<meta>` em todas as páginas e em `frontend/_headers`):
   scripts só do próprio site e de `cdn.jsdelivr.net`/`cdnjs.cloudflare.com`;
   conexões só com o Supabase do projeto, BrasilAPI e ViaCEP.
5. **Edge Functions:**
   - webhooks com assinatura/token conferidos em tempo constante;
   - o estado do pagamento ou da nota é sempre **consultado** no provedor
     (o corpo da notificação não vale);
   - erros técnicos só no log.

## Corrigido na auditoria (out/2026)

| Gravidade | Problema | Correção | Teste |
|---|---|---|---|
| **Crítica** | Qualquer empresa logada podia **renomear ou apagar qualquer fornecedor** (com produtos, pedidos, pagamentos e NF-e em cascata) pela view `fornecedores_publicos`. Os privilégios padrão do Supabase davam escrita em views, e views ignoram o RLS. | Migration **028**: views só leitura; sem TRUNCATE; privilégios padrão corrigidos | `tests/banco/seguranca-views.test.mjs` + invariantes 5 e 6 |
| **Alta** | XSS armazenado: nome de produto de outro fornecedor virava HTML no detalhe do catálogo (o `title` do SweetAlert é HTML). | `titleText` no catálogo e em `SERFAvisos` (todos os diálogos) | `tests/e2e/seguranca.spec.mjs` |
| Média | `pagamento_libera_envio(id)` respondia a qualquer um se o pedido de outra empresa estava pago. | 028: só o servidor executa | `seguranca-views.test.mjs` |
| Média | E-mail digitado inserido como HTML na confirmação do cadastro. | escapado | `tests/e2e/login.spec.mjs` |
| Média | Sem CSP, sem SRI, scripts inline em 6 páginas e `onclick=` na segmentação. | CSP + SRI + scripts em arquivos | `tests/e2e/csp.spec.mjs`, `tests/unit/seguranca.test.mjs` |
| Baixa | Logout deixava CNPJ/e-mail da empresa no `localStorage`. | limpo ao sair e ao excluir a conta | — |
| Baixa | Senha mínima de 6 (redefinição) / sem mínimo (cadastro). | 8 no front; **configure 8 no Supabase também** (abaixo) | `login.spec.mjs` |
| Baixa | Segredo do agendador comparado com `!==` (vaza por tempo). | comparação em tempo constante | — |
| Média | Sem limite de frequência: um usuário podia inundar o chat, cadastrar milhares de produtos ou abrir/cancelar cotações em série (cada uma dispara avisos para fornecedores). | Migration **030**: 20 mensagens/min, 60 produtos/h, 10 cotações/h; homologação de CNPJ no máximo a cada 2 min | `tests/banco/limites.test.mjs` |
| Média | Relatórios, histórico e painel de empresas liam no máximo 1.000 linhas (corte silencioso da API): totais errados para quem tem muitos pedidos. | `buscarTodasAsPaginas` (páginas ordenadas com desempate) | `tests/unit/utils.test.mjs` |
| Baixa | Erros técnicos do banco apareciam crus para o usuário em ~15 telas. | todos passam por `mensagemDeErro` | — |

## Ao publicar (checklist)

**Banco:** aplique as migrations até a **031**. A 028 corrige a falha crítica, então aplique-a imediatamente, mesmo antes do resto.

**Hospedagem (Cloudflare Pages ou Netlify):**
- Publicar a pasta **`frontend/`**. O `_headers` e o `_redirects` já estão nela; publicar a raiz do repositório exporia `tests/`, `docs/` e o código das funções.
- O GitHub Pages não aplica o `_headers`. A CSP em `<meta>` continua valendo lá, mas sem HSTS e sem bloqueio de iframe.

**Supabase (painel):**
- [ ] Authentication → URL Configuration: *Site URL* e *Redirect URLs* só com o domínio do site.
- [ ] Authentication → Providers → Email:
  - [ ] confirmação de e-mail ligada;
  - [ ] **senha mínima 8**;
  - [ ] "Leaked password protection".
- [ ] Authentication → Attack Protection: **CAPTCHA** (Turnstile ou hCaptcha) no cadastro e no login. Se ligar, me avise: o front precisa mandar o token.
- [ ] Advisors → Security Advisor: resolver o que aparecer.
- [ ] Segredos das funções: `APP_URL` = endereço onde fica a pasta `pages/` (ex.: `https://serf.pages.dev`).
- [ ] Plano com **backup** antes de dinheiro e NF-e reais.

**Contas:**
- [ ] 2FA no GitHub, no Supabase, no Mercado Pago, na Focus e no e-mail dos administradores.
- [ ] GitHub: proteger a branch principal (PR + CI verde); ativar o Dependabot.

**Antes do lançamento:**
- [ ] Varredura OWASP ZAP (baseline) contra o site publicado.

## Riscos que continuam (decisões de negócio)

- **Posse do CNPJ — resolvida na migration 029, mas em modo DEMONSTRAÇÃO
  por padrão.** Ver "Posse do CNPJ" abaixo. Enquanto o modo for
  `DEMONSTRACAO`, o código aparece na tela de quem pede: serve para mostrar
  o fluxo, **não** prova nada. Para valer, mude para `REAL`.
- **Limites de frequência existem no banco (030)**, mas por usuário: quem
  cria muitas contas contorna. Ligue o CAPTCHA no cadastro (checklist acima).
- **`style-src 'unsafe-inline'`** continua na CSP, porque vários componentes
  usam `style=`. É risco baixo (CSS não executa script) e pode ser removido
  aos poucos.
- **Pix e NF-e reais** foram testados contra simulações. Valide em sandbox e
  homologação antes de ligar.

## Posse do CNPJ (migration 029)

Antes, o CNPJ era só declarado: os dados da Receita são públicos, então
qualquer um se passava por outra empresa, e o primeiro a cadastrar
"ocupava" o CNPJ — o dono não conseguia mais entrar.

**Como funciona agora:**

1. Perfil → **Identidade da empresa** → "Enviar código". A Edge Function
   `verificar-cnpj` consulta o CNPJ na BrasilAPI e manda um código de 6
   dígitos para o **e-mail que a Receita tem do CNPJ** (não o que a pessoa
   digitou). O e-mail diz quem pediu; quem não reconhece só ignora.
2. A pessoa digita o código (`confirmar_identidade`). O banco guarda só o
   **hash**; o código vale 30 min, aceita 5 tentativas (a 5ª errada invalida
   até o código certo) e no máximo 3 envios por hora. Depois de enviado, o
   código é apagado da fila de e-mails.
3. **CNPJ único só entre contas verificadas.** O dono verdadeiro pode se
   cadastrar mesmo que alguém tenha ocupado o CNPJ; ao verificar, a conta
   ocupante perde a carência e não consegue mais verificar. Depois disso,
   ninguém mais cadastra o CNPJ (`CNPJ_JA_VERIFICADO`).
4. **Vender exige identidade:** sem verificação, a empresa não recebe
   pedidos nem envia propostas (compra normalmente). Contas que existiam
   antes da 029 têm **30 dias de carência**.
5. **Selo "homologado"** = CNPJ ativo na Receita **e** posse comprovada.

**Modos** (`configuracao_identidade.modo`, só pelo SQL Editor):

| Modo | Para onde vai o código | Use para |
|---|---|---|
| `DEMONSTRACAO` (padrão) | aparece na tela, com aviso "em produção iria para o e-mail da Receita" | apresentações (não manda e-mail para empresas reais) |
| `REAL` | só para o e-mail da Receita | produção: `UPDATE public.configuracao_identidade SET modo = 'REAL';` |

O modo `REAL` precisa da função `enviar-emails` configurada (Resend).

**Limites conhecidos:**
- CNPJ sem e-mail na Receita: a tela pede para atualizar o e-mail na
  Receita (pelo contador) ou falar com o suporte. Verificação por documentos
  (contrato social + quadro de sócios, com aprovação manual) é o próximo
  passo, se o negócio seguir.
- O e-mail da Receita às vezes é o do contador: ele repassa o código, o que
  é aceitável (é alguém de confiança da empresa).
- Fornecedor que ligar a NF-e real já provou a posse com o certificado A1 na
  Focus: dá para verificá-lo automaticamente no futuro.

## Logo da empresa e sessão (migration 031)

- **Logo:** cada empresa só grava na própria pasta do bucket `logos`
  (políticas em `storage.objects`); só PNG, JPEG ou WebP de até 1 MB (SVG,
  que pode carregar script, é recusado). No banco, `logo_url` só aceita o
  endereço do **próprio** arquivo no Supabase
  (`…/logos/<auth_user_id>/logo?v=<número>`): ninguém aponta o cadastro para
  o logo de outra empresa nem para imagem externa. A CSP libera `img-src` só
  para o domínio do Supabase do projeto.
- **Sessão:** sem "Manter conectado", a sessão fica no `sessionStorage` e
  some ao fechar o navegador; com a opção, fica no `localStorage`. Saída
  automática após **30 min** sem uso (7 dias com "Manter conectado"), com
  aviso 2 min antes; ao abrir uma página já além do limite, sai antes de
  mostrar dados. Em computador compartilhado, **não** marque a opção.

## Como manter

- Toda migration nova: os invariantes rodam nos testes e na CI. Uma tabela
  sem RLS, uma view com escrita ou uma função de servidor exposta reprovam
  o PR.
- Domínio externo novo (CDN, API): adicionar na CSP das `<meta>` **e** do
  `_headers` (o teste `seguranca.test.mjs` exige as duas iguais) e, se for
  script, com SRI.
- Texto vindo do banco: `textContent` ou `escaparHTML()`; títulos de
  diálogo por `SERFAvisos` ou `titleText`.
