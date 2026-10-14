# byfest

App web da festa de 40 anos da Priscila, tema Cherry 🍒

Um único arquivo (`index.html`, HTML + JS puro, sem build) com:

- **Convite público** (endereço principal, `/`): é o link enviado pelo WhatsApp, como um link de agendamento. Tem foto, contagem regressiva, mapa, agenda e compartilhamento pelo WhatsApp.
- **Confirmação de presença** (`#confirmar`): passo a passo com resposta, acompanhantes, restrições e revisão.
- **Painel privado** (entrada em `/login`, com e-mail e senha): resumo, convidados (CSV e relatório em PDF dos confirmados), checklist e finanças.
  O PDF é gerado no navegador com [jsPDF](https://github.com/parallax/jsPDF) e jsPDF-AutoTable (MIT), copiados em `vendor/` e carregados só quando a aniversariante clica em “Baixar relatório em PDF”. Ele usa os dados já carregados no painel e não traz telefones nem valores.

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
