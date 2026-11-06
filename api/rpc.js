// Única porta de entrada do navegador para o banco (Neon/Postgres).
// Só as funções listadas em CALLS podem ser chamadas; as do painel exigem e-mail e senha.
const { neon } = require('@neondatabase/serverless');
const SCHEMA = require('../lib/schema');

const CALLS = {
  get_public: { sql: 'select get_public() as v', args: () => [] },
  // Convite e resposta só com o código do convidado (o link pessoal). Sem código, a resposta pública não existe mais.
  get_invite: { sql: 'select get_invite($1) as v', args: a => [str(a.code, 400)] },
  submit_rsvp_code: {
    sql: 'select submit_rsvp_code($1, $2, $3, $4, $5::text[], $6, $7) as v',
    args: a => [str(a.code, 400), str(a.name, 200), str(a.phone, 30), str(a.status, 10),
      (Array.isArray(a.companions) ? a.companions : []).slice(0, 20).map(c => str(c, 200)),
      str(a.diet, 500), str(a.notes, 1000)],
  },
  admin_load: { sql: 'select admin_load($1, $2) as v', args: a => [str(a.email, 200), str(a.password, 200)] },
  admin_save: {
    sql: 'select admin_save($1, $2, $3::jsonb, $4::int) as v',
    args: a => [str(a.email, 200), str(a.password, 200), JSON.stringify(a.data || {}), Number(a.version) || 0],
  },
  admin_set_login: {
    sql: 'select admin_set_login($1, $2, $3, $4) as v',
    args: a => [str(a.email, 200), str(a.password, 200), str(a.new_email, 200), str(a.new_password, 200)],
  },
};
// Erros levantados pelas funções do banco que podem ser mostrados ao navegador.
const PUBLIC_ERRORS = new Set(['not_configured', 'invalid_code', 'locked', 'closed', 'invalid_name', 'invalid_phone',
  'invalid_status', 'too_many_companions', 'invalid_companion', 'too_long', 'full']);

function str(v, max) { return String(v == null ? '' : v).slice(0, max); }

let ready = null;
function ensureSchema(sql) {
  if (!ready) {
    ready = (async () => {
      for (const stmt of SCHEMA) await sql.query(stmt);
      const pin = process.env.ADMIN_PIN;
      if (!/^\d{4,8}$/.test(pin || '')) throw new Error('ADMIN_PIN ausente ou inválido');
      await sql.query("insert into app_state (id, pin_hash) values (1, crypt($1, gen_salt('bf'))) on conflict (id) do nothing", [pin]);
      // ADMIN_EMAILS: e-mails que podem entrar no painel (separados por vírgula), todos com a mesma senha.
      const emails = String(process.env.ADMIN_EMAILS || '').split(/[,;\s]+/).map(e => e.trim().toLowerCase())
        .filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
      if (emails.length) await sql.query('update app_state set admin_emails = $1::text[] where id = 1', [emails]);
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // GET só para os dados públicos do convite (útil para conferir se o banco está ligado).
  const isPublicGet = req.method === 'GET' && req.query && req.query.fn === 'get_public';
  if (req.method !== 'POST' && !isPublicGet) return res.status(405).json({ error: 'method_not_allowed' });
  const body = isPublicGet ? { fn: 'get_public' }
    : typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const call = CALLS[body.fn];
  if (!call) return res.status(400).json({ error: 'unknown_fn' });
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return res.status(503).json({ error: 'db_not_configured' });
  try {
    const sql = neon(url);
    await ensureSchema(sql);
    const args = body.args || {};
    const before = body.fn === 'submit_rsvp_code' && hookUrl() ? await rsvpEvent(sql, args.code) : null;
    const rows = await sql.query(call.sql, call.args(args));
    if (body.fn === 'submit_rsvp_code') await notifyRsvp(sql, args.code, before);
    return res.status(200).json(rows[0] ? rows[0].v : null);
  } catch (e) {
    if (PUBLIC_ERRORS.has(e.message)) return res.status(400).json({ error: e.message });
    console.error('rpc', body.fn, e);
    return res.status(500).json({ error: 'server_error' });
  }
};

// Aviso de confirmação para o n8n (que manda o WhatsApp). Só roda se N8N_RSVP_WEBHOOK_URL estiver definida na Vercel.
// O segredo vai no cabeçalho X-Byfest-Secret (N8N_RSVP_SECRET). Se o n8n falhar ou demorar, a resposta do convidado já foi gravada.
const SITE_URL = 'https://myfest.blogdapriscila.com.br/';
function hookUrl() { return /^https:\/\//.test(process.env.N8N_RSVP_WEBHOOK_URL || '') ? process.env.N8N_RSVP_WEBHOOK_URL : ''; }
async function rsvpEvent(sql, code) {
  try { const r = await sql.query('select rsvp_event($1) as v', [str(code, 400)]); return r[0] ? r[0].v : null; }
  catch (e) { return null; }
}
async function notifyRsvp(sql, code, before) {
  const url = hookUrl();
  if (!url) return;
  try {
    const ev = await rsvpEvent(sql, code);
    if (!ev || !ev.guest || !ev.guest.code) return;
    let base = String(ev.party.inviteUrl || SITE_URL).split('#')[0].split('?')[0].replace(/\/convite\/.*$/, '/');
    if (!base.endsWith('/')) base += '/';
    const g = ev.guest;
    const payload = {
      event: 'rsvp', at: new Date().toISOString(),
      previousStatus: before && before.guest ? before.guest.status : '',
      people: g.status === 'no' ? 0 : 1 + (g.companions || []).length,
      inviteLink: base + 'convite/' + g.code, menuLink: base + 'convite/' + g.code + '#cardapio',
      guest: g, party: ev.party,
    };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(url, { method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'X-Byfest-Secret': process.env.N8N_RSVP_SECRET || '' },
        body: JSON.stringify(payload) });
      if (!r.ok) console.error('n8n rsvp', r.status);
    } finally { clearTimeout(t); }
  } catch (e) { console.error('n8n rsvp', e && e.name === 'AbortError' ? 'timeout' : e); }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
