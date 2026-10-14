-- byfest: armazenamento da festa + confirmações públicas (Postgres / Neon).
-- Executado automaticamente pela API (idempotente). Blocos separados por "-- @@".
-- O navegador nunca fala com o banco: só a função /api/rpc, que chama estas funções.
create extension if not exists pgcrypto;
-- @@
create table if not exists app_state (
  id int primary key default 1 check (id = 1),
  data jsonb,
  pin_hash text not null,
  version int not null default 0,
  fails int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
-- @@
create table if not exists rsvps (
  phone text primary key,
  name text not null,
  status text not null check (status in ('yes','no','maybe')),
  companions text[] not null default '{}',
  diet text not null default '',
  notes text not null default '',
  updated_at timestamptz not null default now()
);
-- @@
-- Album privado da festa e fotos aprovadas/revisadas pelo anfitrião.
create table if not exists party_album (
  id int primary key default 1 check (id = 1),
  access_token text not null unique,
  publish_immediately boolean not null default false
);
-- @@
create table if not exists party_photos (
  id uuid primary key default gen_random_uuid(),
  sender_name text not null check (length(sender_name) between 2 and 80),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  image_data bytea not null check (octet_length(image_data) <= 3145728),
  status text not null default 'pending' check (status in ('pending','approved','hidden')),
  created_at timestamptz not null default now()
);
-- @@
create index if not exists party_photos_status_created_idx on party_photos (status, created_at desc);
-- @@
create index if not exists party_photos_created_idx on party_photos (created_at desc);
-- @@
create or replace function norm_phone(p text) returns text language sql immutable as $$
  select case when length(d) > 11 and left(d, 2) = '55' then substr(d, 3) else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s
$$;
-- @@
-- Confere o PIN, com bloqueio de 30s após 5 erros seguidos.
create or replace function check_pin(p_pin text) returns boolean language plpgsql as $$
declare s app_state;
begin
  select * into s from app_state where id = 1 for update;
  if not found then raise exception 'not_configured'; end if;
  if s.locked_until is not null and s.locked_until > now() then raise exception 'locked'; end if;
  if s.pin_hash = crypt(coalesce(p_pin, ''), s.pin_hash) then
    update app_state set fails = 0, locked_until = null where id = 1;
    return true;
  end if;
  update app_state
     set fails = case when s.fails + 1 >= 5 then 0 else s.fails + 1 end,
         locked_until = case when s.fails + 1 >= 5 then now() + interval '30 seconds' else null end
   where id = 1;
  return false;
end $$;
-- @@
-- Dados públicos do convite: só a festa, sem orçamento.
create or replace function get_public() returns jsonb language sql stable as $$
  select coalesce((select (data -> 'party') - 'budget' from app_state where id = 1), '{}'::jsonb)
$$;
-- @@
create or replace function rsvp_limit(p_phone text) returns int language sql stable as $$
  select coalesce(
    (select (g ->> 'allowed')::int
       from app_state s, jsonb_array_elements(coalesce(s.data -> 'guests', '[]')) g
      where s.id = 1 and norm_phone(p_phone) <> '' and norm_phone(g ->> 'phone') = norm_phone(p_phone)
      limit 1),
    (select (data -> 'party' ->> 'maxCompanions')::int from app_state where id = 1),
    0)
$$;
-- @@
create or replace function submit_rsvp(p_name text, p_phone text, p_status text, p_companions text[], p_diet text, p_notes text)
returns jsonb language plpgsql as $$
declare
  ph text := norm_phone(p_phone);
  party jsonb;
  lim int;
  comps text[] := coalesce(p_companions, '{}');
  c text;
begin
  select data -> 'party' into party from app_state where id = 1;
  if party is null then raise exception 'not_configured'; end if;
  if coalesce((party ->> 'rsvpOpen')::boolean, true) = false then raise exception 'closed'; end if;
  if coalesce(party ->> 'rsvpDeadline', '') <> ''
     and (party ->> 'rsvpDeadline')::date < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'closed';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 80 then raise exception 'invalid_name'; end if;
  if length(ph) not between 10 and 11 then raise exception 'invalid_phone'; end if;
  if p_status is null or p_status not in ('yes','no','maybe') then raise exception 'invalid_status'; end if;
  if p_status = 'no' then comps := '{}'; end if;
  lim := rsvp_limit(ph);
  if coalesce(array_length(comps, 1), 0) > lim then raise exception 'too_many_companions'; end if;
  foreach c in array comps loop
    if length(trim(c)) not between 2 and 80 then raise exception 'invalid_companion'; end if;
  end loop;
  if length(coalesce(p_diet, '')) > 160 or length(coalesce(p_notes, '')) > 400 then raise exception 'too_long'; end if;
  if (select count(*) from rsvps) >= 2000 and not exists (select 1 from rsvps where phone = ph) then
    raise exception 'full';
  end if;
  insert into rsvps (phone, name, status, companions, diet, notes, updated_at)
  values (ph, trim(p_name), p_status, comps, coalesce(trim(p_diet), ''), coalesce(trim(p_notes), ''), now())
  on conflict (phone) do update set name = excluded.name, status = excluded.status,
    companions = excluded.companions, diet = excluded.diet, notes = excluded.notes, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
-- @@
create or replace function admin_load(p_pin text) returns jsonb language plpgsql as $$
declare s app_state;
begin
  if not check_pin(p_pin) then return jsonb_build_object('ok', false, 'error', 'bad_pin'); end if;
  select * into s from app_state where id = 1;
  return jsonb_build_object('ok', true, 'data', s.data, 'version', s.version,
    'rsvps', coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at) from rsvps r), '[]'::jsonb));
end $$;
-- @@
create or replace function admin_save(p_pin text, p_data jsonb, p_version int) returns jsonb language plpgsql as $$
declare v int;
begin
  if not check_pin(p_pin) then return jsonb_build_object('ok', false, 'error', 'bad_pin'); end if;
  update app_state set data = p_data, version = version + 1, updated_at = now()
   where id = 1 and version = p_version returning version into v;
  if v is null then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
  return jsonb_build_object('ok', true, 'version', v);
end $$;
-- @@
create or replace function admin_set_pin(p_pin text, p_new text) returns jsonb language plpgsql as $$
begin
  if not check_pin(p_pin) then return jsonb_build_object('ok', false, 'error', 'bad_pin'); end if;
  if p_new !~ '^\d{4,8}$' then return jsonb_build_object('ok', false, 'error', 'invalid_pin'); end if;
  update app_state set pin_hash = crypt(p_new, gen_salt('bf')) where id = 1;
  return jsonb_build_object('ok', true);
end $$;
-- @@
-- Login com e-mail e senha (substitui o PIN). A senha usa o mesmo hash (pin_hash);
-- a senha inicial é o ADMIN_PIN. Enquanto admin_email estiver vazio, o primeiro
-- login com a senha certa grava o e-mail usado.
alter table app_state add column if not exists admin_email text;
-- @@
create or replace function check_login(p_email text, p_pw text) returns boolean language plpgsql as $$
declare s app_state; e text := lower(trim(coalesce(p_email, '')));
begin
  select * into s from app_state where id = 1 for update;
  if not found then raise exception 'not_configured'; end if;
  if s.locked_until is not null and s.locked_until > now() then raise exception 'locked'; end if;
  if e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     and (s.admin_email is null or s.admin_email = e)
     and s.pin_hash = crypt(coalesce(p_pw, ''), s.pin_hash) then
    update app_state set fails = 0, locked_until = null, admin_email = coalesce(admin_email, e) where id = 1;
    return true;
  end if;
  update app_state
     set fails = case when s.fails + 1 >= 5 then 0 else s.fails + 1 end,
         locked_until = case when s.fails + 1 >= 5 then now() + interval '30 seconds' else null end
   where id = 1;
  return false;
end $$;
-- @@
create or replace function admin_load(p_email text, p_pw text) returns jsonb language plpgsql as $$
declare s app_state;
begin
  if not check_login(p_email, p_pw) then return jsonb_build_object('ok', false, 'error', 'bad_login'); end if;
  select * into s from app_state where id = 1;
  return jsonb_build_object('ok', true, 'data', s.data, 'version', s.version, 'email', s.admin_email,
    'rsvps', coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at) from rsvps r), '[]'::jsonb));
end $$;
-- @@
create or replace function admin_save(p_email text, p_pw text, p_data jsonb, p_version int) returns jsonb language plpgsql as $$
declare v int;
begin
  if not check_login(p_email, p_pw) then return jsonb_build_object('ok', false, 'error', 'bad_login'); end if;
  update app_state set data = p_data, version = version + 1, updated_at = now()
   where id = 1 and version = p_version returning version into v;
  if v is null then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
  return jsonb_build_object('ok', true, 'version', v);
end $$;
-- @@
create or replace function admin_set_login(p_email text, p_pw text, p_new_email text, p_new_pw text) returns jsonb language plpgsql as $$
declare ne text := lower(trim(coalesce(p_new_email, '')));
begin
  if not check_login(p_email, p_pw) then return jsonb_build_object('ok', false, 'error', 'bad_login'); end if;
  if ne !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'invalid_email'); end if;
  if coalesce(p_new_pw, '') <> '' and length(p_new_pw) < 6 then return jsonb_build_object('ok', false, 'error', 'weak_password'); end if;
  update app_state set admin_email = ne,
    pin_hash = case when coalesce(p_new_pw, '') <> '' then crypt(p_new_pw, gen_salt('bf')) else pin_hash end
   where id = 1;
  return jsonb_build_object('ok', true);
end $$;
-- @@
-- Vários e-mails com a mesma senha: a lista vem da variável ADMIN_EMAILS (aplicada no início
-- de cada função). Com a lista preenchida, só esses e-mails entram; sem ela vale admin_email.
alter table app_state add column if not exists admin_emails text[];
-- @@
create or replace function check_login(p_email text, p_pw text) returns boolean language plpgsql as $$
declare s app_state; e text := lower(trim(coalesce(p_email, ''))); has_list boolean;
begin
  select * into s from app_state where id = 1 for update;
  if not found then raise exception 'not_configured'; end if;
  if s.locked_until is not null and s.locked_until > now() then raise exception 'locked'; end if;
  has_list := coalesce(cardinality(s.admin_emails), 0) > 0;
  if e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     and ((has_list and e = any(s.admin_emails)) or (not has_list and (s.admin_email is null or s.admin_email = e)))
     and s.pin_hash = crypt(coalesce(p_pw, ''), s.pin_hash) then
    update app_state set fails = 0, locked_until = null,
      admin_email = case when has_list then admin_email else coalesce(admin_email, e) end where id = 1;
    return true;
  end if;
  update app_state
     set fails = case when s.fails + 1 >= 5 then 0 else s.fails + 1 end,
         locked_until = case when s.fails + 1 >= 5 then now() + interval '30 seconds' else null end
   where id = 1;
  return false;
end $$;
-- @@
create or replace function admin_load(p_email text, p_pw text) returns jsonb language plpgsql as $$
declare s app_state;
begin
  if not check_login(p_email, p_pw) then return jsonb_build_object('ok', false, 'error', 'bad_login'); end if;
  select * into s from app_state where id = 1;
  return jsonb_build_object('ok', true, 'data', s.data, 'version', s.version,
    'email', lower(trim(p_email)), 'emails', to_jsonb(coalesce(s.admin_emails, '{}'::text[])),
    'rsvps', coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at) from rsvps r), '[]'::jsonb));
end $$;
-- @@
create or replace function admin_set_login(p_email text, p_pw text, p_new_email text, p_new_pw text) returns jsonb language plpgsql as $$
declare ne text := lower(trim(coalesce(p_new_email, ''))); has_list boolean;
begin
  if not check_login(p_email, p_pw) then return jsonb_build_object('ok', false, 'error', 'bad_login'); end if;
  select coalesce(cardinality(admin_emails), 0) > 0 into has_list from app_state where id = 1;
  if not has_list and ne !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'invalid_email'); end if;
  if coalesce(p_new_pw, '') <> '' and length(p_new_pw) < 6 then return jsonb_build_object('ok', false, 'error', 'weak_password'); end if;
  update app_state set admin_email = case when has_list then admin_email else ne end,
    pin_hash = case when coalesce(p_new_pw, '') <> '' then crypt(p_new_pw, gen_salt('bf')) else pin_hash end
   where id = 1;
  return jsonb_build_object('ok', true);
end $$;
