// Única porta de entrada do navegador para o banco (Neon/Postgres).
// Só as funções listadas em CALLS podem ser chamadas; as do painel exigem e-mail e senha.
const { neon } = require('@neondatabase/serverless');
const SCHEMA = require('../lib/schema');

const CALLS = {
  get_public: { sql: 'select get_public() as v', args: () => [] },
  rsvp_limit: { sql: 'select rsvp_limit($1) as v', args: a => [str(a.phone, 30)] },
  submit_rsvp: {
    sql: 'select submit_rsvp($1, $2, $3, $4::text[], $5, $6) as v',
    args: a => [str(a.name, 200), str(a.phone, 30), str(a.status, 10),
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
const PUBLIC_ERRORS = new Set(['not_configured', 'locked', 'closed', 'invalid_name', 'invalid_phone',
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
    const rows = await sql.query(call.sql, call.args(body.args || {}));
    return res.status(200).json(rows[0] ? rows[0].v : null);
  } catch (e) {
    if (PUBLIC_ERRORS.has(e.message)) return res.status(400).json({ error: e.message });
    console.error('rpc', body.fn, e);
    return res.status(500).json({ error: 'server_error' });
  }
};

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
