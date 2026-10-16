-- LOWPO11Y core schema.
-- Idempotent: safe to run on PGlite, plain Postgres and Supabase, and safe to
-- re-run if Supabase's GitHub integration has already applied it.
-- Row-level security model: docs/decisions/0002-postgres-pglite-and-rls.md

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- roles ----
-- The server switches to these roles (SET LOCAL ROLE) for every request made
-- on behalf of a visitor or staff member so policies below are enforced.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lp_anon') then
    create role lp_anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'lp_authenticated') then
    create role lp_authenticated nologin;
  end if;
end $$;

do $$
begin
  execute format('grant lp_anon, lp_authenticated to %I', current_user);
exception when others then
  -- Superusers can already assume any role.
  null;
end $$;

-- ------------------------------------------------------ request claims ----
create schema if not exists app;
grant usage on schema app to lp_anon, lp_authenticated;

create or replace function app.request_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app.request_role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('app.role', true), ''), 'anon')
$$;

create or replace function app.is_staff() returns boolean
language sql stable as $$
  select app.request_role() in ('editor', 'admin')
$$;

create or replace function app.is_admin() returns boolean
language sql stable as $$
  select app.request_role() = 'admin'
$$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

grant execute on all functions in schema app to lp_anon, lp_authenticated;

-- ---------------------------------------------------------------- enums ----
do $$ begin create type public.user_role as enum ('user', 'editor', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin create type public.asset_type as enum ('model', 'texture', 'decal', 'sprite', 'ui', 'audio', 'skybox', 'animation', 'pack');
exception when duplicate_object then null; end $$;

do $$ begin create type public.publish_status as enum ('draft', 'review', 'published', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin create type public.file_purpose as enum ('source', 'delivery', 'thumbnail', 'preview', 'dependency', 'bundle');
exception when duplicate_object then null; end $$;

do $$ begin create type public.provenance_kind as enum ('original', 'commissioned', 'third_party', 'ai_assisted', 'demo');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------- accounts ----
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  display_name text not null,
  role public.user_role not null default 'user',
  avatar_key text,
  disabled_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_format check (position('@' in email) > 1 and length(email) <= 320),
  constraint users_display_name_len check (length(display_name) between 1 and 80)
);
create unique index if not exists users_email_lower_key on public.users (lower(email));

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists user_sessions_user_idx on public.user_sessions (user_id);
create index if not exists user_sessions_expires_idx on public.user_sessions (expires_at);

create table if not exists public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- ------------------------------------------------------- taxonomy ----
create table if not exists public.licences (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  human_label text not null,
  short_label text not null,
  canonical_url text,
  -- null = not stated by the licence; never inferred.
  commercial_use boolean,
  modifications boolean,
  attribution_required boolean,
  redistribution_allowed boolean,
  share_alike boolean not null default false,
  -- false blocks public downloads (e.g. the 'unknown' licence).
  allows_download boolean not null default false,
  full_text text,
  notes text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  parent_id uuid references public.categories (id) on delete set null,
  scope text not null default 'any' check (scope in ('any', 'model', 'texture')),
  description text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  facet text not null default 'general' check (facet in ('general', 'style', 'subject', 'setting', 'engine', 'material')),
  created_at timestamptz not null default now()
);
create index if not exists tags_facet_idx on public.tags (facet);

create table if not exists public.creators (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------- assets ----
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  short_description text not null default '',
  description_md text not null default '',
  asset_type public.asset_type not null,
  status public.publish_status not null default 'draft',
  category_id uuid references public.categories (id) on delete set null,
  licence_id uuid references public.licences (id) on delete restrict,
  attribution_text text,
  licence_source_url text,
  provenance_kind public.provenance_kind,
  provenance_notes text,
  ownership_attested_at timestamptz,
  ownership_attested_by uuid references public.users (id) on delete set null,
  featured boolean not null default false,
  is_demo boolean not null default false,
  version integer not null default 1,
  usage_notes_md text not null default '',
  -- Denormalised facets maintained from asset_files / asset_tags for filtering.
  formats text[] not null default '{}',
  engines text[] not null default '{}',
  triangle_count integer,
  vertex_count integer,
  texture_size integer,
  is_animated boolean not null default false,
  is_rigged boolean not null default false,
  bounds_mm integer[],
  tags_text text not null default '',
  download_count integer not null default 0,
  bundle_file_id uuid,
  thumbnail_url text,
  published_at timestamptz,
  deleted_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(tags_text, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(short_description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(description_md, '')), 'D')
  ) stored,
  constraint assets_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint assets_published_requirements check (
    status <> 'published' or (licence_id is not null and ownership_attested_at is not null and published_at is not null)
  )
);
create index if not exists assets_status_published_idx on public.assets (status, published_at desc) where deleted_at is null;
create index if not exists assets_type_idx on public.assets (asset_type);
create index if not exists assets_category_idx on public.assets (category_id);
create index if not exists assets_licence_idx on public.assets (licence_id);
create index if not exists assets_search_idx on public.assets using gin (search_tsv);
create index if not exists assets_title_trgm_idx on public.assets using gin (title gin_trgm_ops);
create index if not exists assets_formats_idx on public.assets using gin (formats);
create index if not exists assets_engines_idx on public.assets using gin (engines);
create index if not exists assets_triangles_idx on public.assets (triangle_count);
create index if not exists assets_texture_size_idx on public.assets (texture_size);

create table if not exists public.asset_files (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  version integer not null default 1,
  purpose public.file_purpose not null,
  storage_key text not null unique,
  public_key text unique,
  original_filename text not null,
  format text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer,
  height integer,
  channels integer,
  model_triangle_count integer,
  model_vertex_count integer,
  texture_count integer,
  animation_count integer,
  lod integer,
  size_variant integer,
  derived_from_file_id uuid references public.asset_files (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  is_primary boolean not null default false,
  published boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists asset_files_asset_idx on public.asset_files (asset_id, purpose);
create index if not exists asset_files_sha_idx on public.asset_files (sha256);

do $$ begin
  alter table public.assets add constraint assets_bundle_file_fk foreign key (bundle_file_id) references public.asset_files (id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.asset_tags (
  asset_id uuid not null references public.assets (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (asset_id, tag_id)
);
create index if not exists asset_tags_tag_idx on public.asset_tags (tag_id);

create table if not exists public.asset_creators (
  asset_id uuid not null references public.assets (id) on delete cascade,
  creator_id uuid not null references public.creators (id) on delete cascade,
  role text not null default 'author',
  primary key (asset_id, creator_id)
);
create index if not exists asset_creators_creator_idx on public.asset_creators (creator_id);

create table if not exists public.asset_dependencies (
  asset_id uuid not null references public.assets (id) on delete cascade,
  depends_on_asset_id uuid not null references public.assets (id) on delete cascade,
  note text,
  primary key (asset_id, depends_on_asset_id),
  check (asset_id <> depends_on_asset_id)
);

-- ---------------------------------------------------- collections ----
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text not null default '',
  description_md text not null default '',
  status public.publish_status not null default 'draft',
  featured boolean not null default false,
  sort_order integer not null default 100,
  cover_url text,
  bundle_key text,
  bundle_public_key text,
  bundle_size_bytes bigint,
  bundle_sha256 text,
  bundle_built_at timestamptz,
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create table if not exists public.collection_assets (
  collection_id uuid not null references public.collections (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  position integer not null default 0,
  primary key (collection_id, asset_id)
);
create index if not exists collection_assets_asset_idx on public.collection_assets (asset_id);

-- ------------------------------------------- shaders and starters ----
create table if not exists public.shader_resources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text not null default '',
  engine text not null,
  engine_version_min text,
  engine_version_max text,
  renderer_compatibility text,
  licence_id uuid references public.licences (id) on delete restrict,
  explanation_md text not null default '',
  setup_md text not null default '',
  limitations_md text not null default '',
  changelog_md text not null default '',
  code text,
  code_language text,
  preview_url text,
  file_key text,
  file_public_key text,
  file_name text,
  file_size_bytes bigint,
  file_sha256 text,
  source_url text,
  tested_at timestamptz,
  status public.publish_status not null default 'draft',
  featured boolean not null default false,
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.starter_projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text not null default '',
  engine text not null,
  engine_versions text,
  description_md text not null default '',
  included_features text[] not null default '{}',
  licence_id uuid references public.licences (id) on delete restrict,
  preview_url text,
  file_key text,
  file_public_key text,
  file_name text,
  file_size_bytes bigint,
  file_sha256 text,
  source_url text,
  tested_at timestamptz,
  status public.publish_status not null default 'draft',
  featured boolean not null default false,
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------- learn ----
create table if not exists public.tutorial_creators (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  youtube_channel_url text,
  channel_id text,
  website_url text,
  description text not null default '',
  categories text[] not null default '{}',
  approved boolean not null default false,
  attribution_notes text,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tutorials (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  creator_id uuid references public.tutorial_creators (id) on delete set null,
  title text not null,
  youtube_video_id text check (youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  external_url text,
  summary text not null default '',
  difficulty text check (difficulty in ('beginner', 'intermediate', 'advanced')),
  engine text,
  topic text,
  duration_minutes integer,
  featured boolean not null default false,
  status public.publish_status not null default 'draft',
  last_reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tutorials_creator_idx on public.tutorials (creator_id);

create table if not exists public.external_resources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  url text not null,
  category text not null,
  description text not null default '',
  licence_note text,
  link_only boolean not null default true,
  status public.publish_status not null default 'draft',
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --------------------------------------------- tools and settings ----
create table if not exists public.tools (
  slug text primary key,
  enabled boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete cascade,
  tool_slug text not null,
  name text not null,
  schema_version integer not null default 1,
  config_json jsonb not null,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists presets_user_idx on public.presets (user_id, tool_slug);

-- ----------------------------------------------------- operations ----
create table if not exists public.download_daily (
  file_id uuid not null references public.asset_files (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  day date not null,
  downloads integer not null default 0,
  primary key (file_id, day)
);
create index if not exists download_daily_asset_idx on public.download_daily (asset_id, day);

create table if not exists public.download_dedupe (
  key text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_target_idx on public.audit_log (target_type, target_id, created_at desc);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

create table if not exists public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.users (id) on delete cascade,
  target_type text not null check (target_type in ('asset', 'shader', 'starter', 'import')),
  target_id uuid,
  purpose public.file_purpose,
  staging_key text not null unique,
  original_filename text not null,
  declared_mime text not null,
  declared_size bigint not null check (declared_size > 0),
  status text not null default 'pending' check (status in ('pending', 'verified', 'consumed', 'failed', 'expired')),
  sha256 text,
  detected_format text,
  error text,
  result_file_id uuid references public.asset_files (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists upload_sessions_actor_idx on public.upload_sessions (actor_id, created_at desc);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  dry_run boolean not null default true,
  manifest jsonb not null,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'general' check (kind in ('general', 'takedown', 'correction', 'suggestion')),
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  page_url text,
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  handled_by uuid references public.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------- denormalisers ----
-- Keeps assets.tags_text in sync so tag names are part of full-text search.
create or replace function app.refresh_asset_tags_text() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target uuid := coalesce(new.asset_id, old.asset_id);
begin
  update public.assets a
     set tags_text = coalesce((
       select string_agg(t.name || ' ' || replace(t.slug, '-', ' '), ' ' order by t.slug)
         from public.asset_tags at join public.tags t on t.id = at.tag_id
        where at.asset_id = target), '')
   where a.id = target;
  return null;
end $$;

drop trigger if exists asset_tags_refresh_text on public.asset_tags;
create trigger asset_tags_refresh_text
  after insert or delete on public.asset_tags
  for each row execute function app.refresh_asset_tags_text();

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['users', 'licences', 'categories', 'creators', 'assets', 'collections', 'shader_resources',
                           'starter_projects', 'tutorial_creators', 'tutorials', 'external_resources', 'presets']
  loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;

-- ------------------------------------------------- row-level security ----
do $$
declare t text;
begin
  foreach t in array array['users', 'user_sessions', 'rate_limits', 'licences', 'categories', 'tags', 'creators', 'assets',
                           'asset_files', 'asset_tags', 'asset_creators', 'asset_dependencies', 'collections',
                           'collection_assets', 'shader_resources', 'starter_projects', 'tutorial_creators', 'tutorials',
                           'external_resources', 'tools', 'site_settings', 'presets', 'download_daily', 'download_dedupe',
                           'audit_log', 'upload_sessions', 'import_jobs', 'contact_messages']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Privileges. RLS policies below decide which rows each role can touch.
grant usage on schema public to lp_anon, lp_authenticated;
grant select on public.licences, public.categories, public.tags, public.creators, public.assets, public.asset_files,
                public.asset_tags, public.asset_creators, public.asset_dependencies, public.collections,
                public.collection_assets, public.shader_resources, public.starter_projects, public.tutorial_creators,
                public.tutorials, public.external_resources, public.tools, public.site_settings, public.presets
  to lp_anon, lp_authenticated;
grant insert, update, delete on public.licences, public.categories, public.tags, public.creators, public.assets,
                public.asset_files, public.asset_tags, public.asset_creators, public.asset_dependencies,
                public.collections, public.collection_assets, public.shader_resources, public.starter_projects,
                public.tutorial_creators, public.tutorials, public.external_resources, public.tools,
                public.site_settings, public.presets
  to lp_authenticated;
grant select, insert on public.audit_log to lp_authenticated;
grant select on public.download_daily, public.contact_messages, public.import_jobs, public.upload_sessions to lp_authenticated;
grant update on public.contact_messages to lp_authenticated;

-- Helper: is an asset visible to the current request?
create or replace function app.asset_visible(p_asset uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_staff() or exists (
    select 1 from public.assets a where a.id = p_asset and a.status = 'published' and a.deleted_at is null)
$$;
grant execute on function app.asset_visible(uuid) to lp_anon, lp_authenticated;

create or replace function app.collection_visible(p_collection uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_staff() or exists (
    select 1 from public.collections c where c.id = p_collection and c.status = 'published' and c.deleted_at is null)
$$;
grant execute on function app.collection_visible(uuid) to lp_anon, lp_authenticated;

-- Reference data: everyone reads, staff write (admins only for licences).
drop policy if exists licences_read on public.licences;
create policy licences_read on public.licences for select to lp_anon, lp_authenticated using (true);
drop policy if exists licences_write on public.licences;
create policy licences_write on public.licences for all to lp_authenticated using (app.is_admin()) with check (app.is_admin());

do $$
declare t text;
begin
  foreach t in array array['categories', 'tags', 'creators']
  loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to lp_anon, lp_authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to lp_authenticated using (app.is_staff()) with check (app.is_staff())', t, t);
  end loop;
end $$;

-- Assets: public sees published only. Editors work on drafts/review;
-- only admins can publish, archive or edit published assets.
drop policy if exists assets_read on public.assets;
create policy assets_read on public.assets for select to lp_anon, lp_authenticated
  using ((status = 'published' and deleted_at is null) or app.is_staff());
drop policy if exists assets_insert on public.assets;
create policy assets_insert on public.assets for insert to lp_authenticated
  with check (app.is_admin() or (app.is_staff() and status in ('draft', 'review')));
drop policy if exists assets_update on public.assets;
create policy assets_update on public.assets for update to lp_authenticated
  using (app.is_admin() or (app.is_staff() and status in ('draft', 'review')))
  with check (app.is_admin() or (app.is_staff() and status in ('draft', 'review')));
drop policy if exists assets_delete on public.assets;
create policy assets_delete on public.assets for delete to lp_authenticated using (app.is_admin());

drop policy if exists asset_files_read on public.asset_files;
create policy asset_files_read on public.asset_files for select to lp_anon, lp_authenticated
  using (app.is_staff() or (published and deleted_at is null and app.asset_visible(asset_id)));
drop policy if exists asset_files_write on public.asset_files;
create policy asset_files_write on public.asset_files for all to lp_authenticated using (app.is_staff()) with check (app.is_staff());

do $$
declare t text;
begin
  foreach t in array array['asset_tags', 'asset_creators', 'asset_dependencies']
  loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to lp_anon, lp_authenticated using (app.asset_visible(asset_id))', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to lp_authenticated using (app.is_staff()) with check (app.is_staff())', t, t);
  end loop;
end $$;

-- Collections follow the same publish rules as assets.
drop policy if exists collections_read on public.collections;
create policy collections_read on public.collections for select to lp_anon, lp_authenticated
  using ((status = 'published' and deleted_at is null) or app.is_staff());
drop policy if exists collections_write on public.collections;
create policy collections_write on public.collections for all to lp_authenticated
  using (app.is_admin() or (app.is_staff() and status in ('draft', 'review')))
  with check (app.is_admin() or (app.is_staff() and status in ('draft', 'review')));

drop policy if exists collection_assets_read on public.collection_assets;
create policy collection_assets_read on public.collection_assets for select to lp_anon, lp_authenticated
  using (app.collection_visible(collection_id) and app.asset_visible(asset_id));
drop policy if exists collection_assets_write on public.collection_assets;
create policy collection_assets_write on public.collection_assets for all to lp_authenticated using (app.is_staff()) with check (app.is_staff());

-- Shaders, starters, tutorials and resources: published rows are public.
do $$
declare t text;
begin
  foreach t in array array['shader_resources', 'starter_projects']
  loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format($p$create policy %I_read on public.%I for select to lp_anon, lp_authenticated
      using ((status = 'published' and deleted_at is null) or app.is_staff())$p$, t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($p$create policy %I_write on public.%I for all to lp_authenticated
      using (app.is_admin() or (app.is_staff() and status in ('draft', 'review')))
      with check (app.is_admin() or (app.is_staff() and status in ('draft', 'review')))$p$, t, t);
  end loop;
  foreach t in array array['tutorials', 'external_resources']
  loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format($p$create policy %I_read on public.%I for select to lp_anon, lp_authenticated
      using (status = 'published' or app.is_staff())$p$, t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to lp_authenticated using (app.is_staff()) with check (app.is_staff())', t, t);
  end loop;
end $$;

drop policy if exists tutorial_creators_read on public.tutorial_creators;
create policy tutorial_creators_read on public.tutorial_creators for select to lp_anon, lp_authenticated
  using (approved or app.is_staff());
drop policy if exists tutorial_creators_write on public.tutorial_creators;
create policy tutorial_creators_write on public.tutorial_creators for all to lp_authenticated using (app.is_staff()) with check (app.is_staff());

-- Tool overrides and site settings: everyone reads, admins write.
do $$
declare t text;
begin
  foreach t in array array['tools', 'site_settings']
  loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to lp_anon, lp_authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to lp_authenticated using (app.is_admin()) with check (app.is_admin())', t, t);
  end loop;
end $$;

-- Presets: owners read/write their own; public presets are readable by all.
drop policy if exists presets_read on public.presets;
create policy presets_read on public.presets for select to lp_anon, lp_authenticated
  using (visibility = 'public' or user_id = app.request_user_id());
drop policy if exists presets_write on public.presets;
create policy presets_write on public.presets for all to lp_authenticated
  using (user_id = app.request_user_id()) with check (user_id = app.request_user_id());

-- Operational tables: staff can read; writes happen through the server's service context.
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to lp_authenticated using (app.is_admin());
drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to lp_authenticated
  with check (app.is_staff() and actor_id = app.request_user_id());

do $$
declare t text;
begin
  foreach t in array array['download_daily', 'import_jobs', 'upload_sessions', 'contact_messages']
  loop
    execute format('drop policy if exists %I_staff_read on public.%I', t, t);
    execute format('create policy %I_staff_read on public.%I for select to lp_authenticated using (app.is_staff())', t, t);
  end loop;
end $$;
drop policy if exists contact_messages_staff_update on public.contact_messages;
create policy contact_messages_staff_update on public.contact_messages for update to lp_authenticated
  using (app.is_staff()) with check (app.is_staff());

-- users, user_sessions, rate_limits and download_dedupe have RLS enabled and no
-- policies: only the server's service context can touch them.
