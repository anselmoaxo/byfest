# byfest

App web da festa de 40 anos da Priscila, tema Cherry 🍒

Um único arquivo (`index.html`, HTML + JS puro, sem build) com:

- **Convite público** (`#convite`): foto, contagem regressiva, mapa, agenda e compartilhamento pelo WhatsApp.
- **Confirmação de presença** (`#confirmar`): passo a passo com resposta, acompanhantes, restrições e revisão.
- **Painel privado** (`#painel`, PIN inicial `4040`): resumo, convidados (CSV), checklist e finanças.

## Como funciona online

Publicado na Vercel, o app usa a função `api/rpc.js` para guardar tudo num banco Postgres (Neon):

- O convite e a confirmação são públicos. A página pública recebe só os dados da festa, sem orçamento, convidados ou despesas.
- As confirmações ficam na tabela `rsvps` e entram na lista de convidados quando a aniversariante abre o painel.
- O painel exige o PIN, conferido no banco (com hash bcrypt e bloqueio de 30 segundos após 5 erros).
- As tabelas e funções são criadas automaticamente na primeira chamada (`db/schema.sql`).

Variáveis de ambiente na Vercel:

| Variável | Para quê |
| --- | --- |
| `DATABASE_URL` | Conexão do Neon (a integração Neon da Vercel cria sozinha) |
| `ADMIN_PIN` | PIN inicial do painel, de 4 a 8 números. Depois pode ser trocado em Festa › Segurança |

Se mudar `db/schema.sql`, rode `npm run build:schema` para regerar `lib/schema.js`.

## Rodar localmente

Abrindo `index.html` direto no navegador, o app funciona sem banco: os dados ficam no `localStorage`
(o PIN inicial nesse modo é `4040`).
