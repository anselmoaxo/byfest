# byfest

App web da festa de 40 anos da Priscila, tema Cherry 🍒

Um único arquivo (`index.html`, HTML + JS puro, sem build) com:

- **Convite público** (`#convite`): foto, contagem regressiva, mapa, agenda e compartilhamento pelo WhatsApp.
- **Confirmação de presença** (`#confirmar`): passo a passo com resposta, acompanhantes, restrições e revisão.
- **Painel privado** (`#painel`, PIN inicial `4040`): resumo, convidados (CSV), checklist e finanças.

## Rodar localmente

Abra `index.html` no navegador, ou sirva a pasta:

```bash
npx serve .
```

## Limitação atual

Os dados ficam salvos no `localStorage` de cada navegador. Para que as confirmações enviadas
pelos convidados cheguem ao painel da aniversariante, o próximo passo é ligar um backend
(ex.: Supabase) e publicar o app (ex.: Vercel).
