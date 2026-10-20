# byfest

App web da festa de 40 anos da Priscila, tema Cherry 🍒

Um único arquivo (`index.html`, HTML + JS puro, sem build) com:

- **Convite público** (endereço principal, `/`): é o link enviado pelo WhatsApp, como um link de agendamento. Tem foto, contagem regressiva, mapa, agenda e compartilhamento pelo WhatsApp. As tags Open Graph usam `og-convite.jpg` (1200×630) para o card de prévia do link; o card é genérico, sem dados de convidados.
- **Confirmação de presença** (`#confirmar`): passo a passo com resposta, acompanhantes, restrições e revisão.
- **Painel privado** (entrada em `/login`, com e-mail e senha): resumo, convidados (CSV e relatório em PDF dos confirmados), checklist e finanças (CSV, impressão e resumo em PDF).
  Cadastro de convidado com nome e WhatsApp obrigatórios, sem WhatsApp repetido. “Salvar e abrir WhatsApp” abre o WhatsApp com o convite pessoal (no computador vai direto ao `web.whatsapp.com/send`; no celular, `api.whatsapp.com/send`. A página de redirecionamento do `wa.me`/`api.whatsapp.com` trocava os emojis por “�” ao abrir o app do computador); o convite fica “Preparado no WhatsApp” até a anfitriã marcar como enviado. A presença só muda pela resposta no convite público.
  O PDF é gerado no navegador com [jsPDF](https://github.com/parallax/jsPDF) e jsPDF-AutoTable (MIT), copiados em `vendor/` e carregados só quando a aniversariante clica em “Baixar relatório em PDF”. Ele usa os dados já carregados no painel e não traz telefones nem valores. O resumo financeiro em PDF usa o mesmo layout e só existe dentro do painel.

## Como funciona online

Publicado na Vercel, o app usa a função `api/rpc.js` para guardar tudo num banco Postgres (Neon):

- O convite e a confirmação são públicos. A página pública recebe só os dados da festa, sem orçamento, convidados ou despesas.
- As confirmações ficam na tabela `rsvps` e entram na lista de convidados quando a aniversariante abre o painel.
- O painel exige e-mail e senha, conferidos no banco (senha com hash bcrypt e bloqueio de 30 segundos após 5 erros).
  No primeiro acesso a senha é o `ADMIN_PIN`. Se `ADMIN_EMAILS` estiver definida, só esses e-mails entram, todos com a mesma senha;
  sem ela, o e-mail usado no primeiro acesso fica gravado como o e-mail de acesso.
  Os dois podem ser trocados em Festa › Acesso.
- As tabelas e funções são criadas automaticamente na primeira chamada (`db/schema.sql`).

Variáveis de ambiente na Vercel:

| Variável | Para quê |
| --- | --- |
| `DATABASE_URL` | Conexão do Neon (a integração Neon da Vercel cria sozinha) |
| `ADMIN_PIN` | Senha inicial do painel, de 4 a 8 números. Depois pode ser trocada em Festa › Acesso |
| `ADMIN_EMAILS` | Opcional. E-mails que podem entrar no painel, separados por vírgula, todos com a mesma senha |

Se mudar `db/schema.sql`, rode `npm run build:schema` para regerar `lib/schema.js`.

## Rodar localmente

Abrindo `index.html` direto no navegador, o app funciona sem banco: os dados ficam no `localStorage`
(nesse modo o painel abre em `#entrar`, com qualquer e-mail e a senha inicial `4040`).

## PWA

O site publicado em HTTPS pode ser instalado pelo navegador em Android e iOS. O manifesto fica em
`manifest.webmanifest`; `sw.js` mantém o shell da página disponível para abrir offline depois do
primeiro acesso. Offline, consultas e alterações que dependem da API continuam indisponíveis.
No iPhone/iPad, use **Compartilhar → Adicionar à Tela de Início** no Safari. Notificações push não
estão incluídas nesta etapa.

## Entrada e convite com código

- O endereço principal (`/`) abre o login. O convite só aparece pelo link pessoal `/convite/<código>`.
- Cada convidado da lista recebe um código aleatório de 12 caracteres (`guest.code`), criado no painel ao salvar. Só esse link mostra data, local e foto e aceita resposta (`get_invite` e `submit_rsvp_code`). As chamadas públicas antigas `submit_rsvp` e `rsvp_limit` saíram da API, e `get_public` devolve só nome e idade.
- Links antigos `?c=` (nome|telefone em base64) continuam abrindo enquanto a opção "Aceitar links enviados antes do convite com código" estiver ligada em Convidados, e só para quem está na lista com aquele telefone.


## Cardápio

- A anfitriã monta o cardápio em **Festa › Cardápio** (ou pelo atalho “Cardápio da festa” no início do painel): categorias (começa com Entradas, Pratos principais, Sobremesas e Bebidas), itens com descrição opcional, ordem das categorias, título e um recado no fim. Há uma chave para mostrar ou esconder o cardápio no convite.
- Fica em `party.menu` e chega ao convidado junto com o convite (`get_invite`), então só quem tem o link pessoal vê. Não houve mudança no banco.
- No convite aparece sempre o cartão “Comes e bebes” com o botão **Bora ver os comes e bebes?** (some só se a chave estiver desligada; sem itens, a página avisa que está sendo preparado), que abre `/convite/<código>#cardapio`. A página segue o tema escolhido em Festa › Tema. Categorias sem itens não aparecem.
- O cardápio é só para consulta: o convidado não escolhe prato.
