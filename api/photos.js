// Album da festa: imagens privadas no Neon, acessíveis pelo token do convite.
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const SCHEMA = require('../lib/schema');
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX = 3 * 1024 * 1024;
let ready;
async function init(sql) {
  if (!ready) ready = (async () => {
    for (const stmt of SCHEMA) await sql.query(stmt);
    await sql.query('insert into party_album (id, access_token) values (1, $1) on conflict (id) do nothing', [crypto.randomBytes(32).toString('hex')]);
  })().catch(e => { ready = null; throw e; });
  await ready;
}
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
function send(res, status, body) { return res.status(status).json(body); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'method_not_allowed' });
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return send(res, 503, { error: 'db_not_configured' });
  const sql = neon(url);
  try {
    await init(sql);
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}) : req.query || {};
    const action = str(body.action, 30);
    const token = str(body.token, 100);
    const album = await sql.query('select access_token, publish_immediately from party_album where id=1');
    const config = album[0];
    if (!config) return send(res, 503, { error: 'album_unavailable' });
    if (action === 'image') {
      const rows = await sql.query("select encode(image_data,'base64') as data, mime_type from party_photos where id=$1::uuid and status='approved' and $2=$3", [str(body.id, 40), token, config.access_token]);
      if (!rows[0]) return res.status(404).end();
      res.setHeader('Content-Type', rows[0].mime_type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(Buffer.from(rows[0].data, 'base64'));
    }
    if (action === 'gallery') {
      if (token !== config.access_token) return send(res, 403, { error: 'invalid_link' });
      const photos = await sql.query("select id,sender_name,created_at from party_photos where status='approved' order by created_at desc limit 500");
      return send(res, 200, { ok: true, photos });
    }
    if (action === 'upload') {
      if (!crypto.timingSafeEqual(Buffer.from(token.padEnd(64).slice(0,64)), Buffer.from(config.access_token.padEnd(64).slice(0,64))) || token.length !== config.access_token.length) return send(res, 403, { error: 'invalid_link' });
      const name = str(body.name, 80).trim();
      const mime = str(body.mime, 40);
      if (name.length < 2) return send(res, 400, { error: 'invalid_name' });
      if (!TYPES.has(mime)) return send(res, 400, { error: 'invalid_type' });
      if (typeof body.data !== 'string' || body.data.length > Math.ceil(MAX * 4 / 3) + 8) return send(res, 413, { error: 'too_large' });
      const bytes = Buffer.from(body.data, 'base64');
      if (!bytes.length || bytes.length > MAX || bytes.toString('base64') !== body.data) return send(res, 413, { error: 'too_large' });
      const signatures = { 'image/jpeg': [0xff,0xd8,0xff], 'image/png': [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a], 'image/webp': [0x52,0x49,0x46,0x46] };
      const signatureOk = bytes.length > 12 && signatures[mime].every((b, i) => bytes[i] === b) &&
        (mime !== 'image/jpeg' || (bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9)) &&
        (mime !== 'image/png' || bytes.toString('ascii', 12, 16) === 'IHDR') &&
        (mime !== 'image/webp' || bytes.toString('ascii', 8, 12) === 'WEBP');
      if (!signatureOk) return send(res, 400, { error: 'invalid_image' });
      const count = await sql.query("select count(*)::int as n from party_photos where created_at > now()-interval '1 hour'");
      if (count[0].n >= 60) return send(res, 429, { error: 'rate_limited' });
      const total = await sql.query('select count(*)::int as n from party_photos');
      if (total[0].n >= 500) return send(res, 409, { error: 'album_full' });
      const status = config.publish_immediately ? 'approved' : 'pending';
      const rows = await sql.query('insert into party_photos(sender_name,mime_type,image_data,status) values ($1,$2,decode($3,$4),$5) returning id,status', [name, mime, bytes.toString('base64'), 'base64', status]);
      return send(res, 201, { ok: true, status: rows[0].status });
    }
    const email = str(body.email, 200), password = str(body.password, 200);
    const auth = await sql.query('select check_login($1,$2) as ok', [email, password]);
    if (!auth[0].ok) return send(res, 401, { error: 'unauthorized' });
    if (action === 'admin_image') {
      const rows = await sql.query("select encode(image_data,'base64') as data,mime_type from party_photos where id=$1::uuid", [str(body.id,40)]);
      if (!rows[0]) return send(res, 404, { error: 'not_found' });
      return send(res, 200, { ok: true, mime: rows[0].mime_type, data: rows[0].data });
    }
    if (action === 'admin_load') {
      const photos = await sql.query('select id,sender_name,status,created_at,mime_type from party_photos order by created_at desc limit 500');
      return send(res, 200, { ok: true, photos, token: config.access_token, publishImmediately: config.publish_immediately });
    }
    if (action === 'settings' && req.method === 'POST') {
      const value = body.publishImmediately === true;
      await sql.query('update party_album set publish_immediately=$1 where id=1', [value]);
      return send(res, 200, { ok: true, publishImmediately: value });
    }
    if (action === 'moderate' && req.method === 'POST') {
      const status = str(body.status, 20);
      if (!['approved','hidden','pending'].includes(status)) return send(res, 400, { error: 'invalid_status' });
      const result = await sql.query('update party_photos set status=$1 where id=$2::uuid returning id', [status, str(body.id, 40)]);
      return send(res, result.length ? 200 : 404, { ok: !!result.length });
    }
    if (action === 'delete' && req.method === 'POST') {
      const result = await sql.query('delete from party_photos where id=$1::uuid returning id', [str(body.id, 40)]);
      return send(res, result.length ? 200 : 404, { ok: !!result.length });
    }
    if (action === 'download' && req.method === 'POST') {
      const rows = await sql.query("select id,sender_name,mime_type from party_photos where status='approved' and ($1::uuid is null or id=$1::uuid) order by created_at", [body.id ? str(body.id,40) : null]);
      return send(res, 200, { ok: true, photos: rows });
    }
    if (action === 'rotate' && req.method === 'POST') {
      const next = crypto.randomBytes(32).toString('hex');
      await sql.query('update party_album set access_token=$1 where id=1', [next]);
      return send(res, 200, { ok: true, token: next });
    }
    return send(res, 400, { error: 'unknown_action' });
  } catch (e) {
    if (e instanceof SyntaxError) return send(res, 400, { error: 'invalid_json' });
    console.error('photos', e);
    return send(res, 500, { error: 'server_error' });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '4.4mb' } } };
