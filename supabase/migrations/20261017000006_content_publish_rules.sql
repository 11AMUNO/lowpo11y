-- M06: shaders, starter projects, the Learn directory and external resources.
-- Columns for provenance and testing notes, slug formats, and database-level
-- publishing rules so nothing incomplete or untested can go live.

alter table public.shader_resources add column if not exists tested_notes text;
alter table public.shader_resources add column if not exists tags text[] not null default '{}';
alter table public.starter_projects add column if not exists tested_notes text;
alter table public.tutorials add column if not exists review_notes text;
alter table public.external_resources add column if not exists review_notes text;
alter table public.external_resources add column if not exists featured boolean not null default false;
alter table public.shader_resources add column if not exists download_count integer not null default 0;
alter table public.starter_projects add column if not exists download_count integer not null default 0;

do $$
declare t text;
begin
  foreach t in array array['shader_resources', 'starter_projects', 'tutorial_creators', 'tutorials', 'external_resources']
  loop
    if not exists (select 1 from pg_constraint where conname = t || '_slug_format') then
      execute format($c$alter table public.%I add constraint %I check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')$c$, t, t || '_slug_format');
    end if;
  end loop;
end $$;

create or replace function app.known_licence(lic uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.licences where id = lic and code <> 'unknown')
$$;

-- Shaders: tested, licensed, explained, with setup steps and limitations, and code or a file.
create or replace function app.check_shader_publishable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' then
    if not app.known_licence(new.licence_id) then
      raise exception 'Shader % needs a known licence before it is published', new.slug using errcode = 'check_violation';
    end if;
    if new.tested_at is null then
      raise exception 'Shader % must record when and how it was tested before it is published', new.slug using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.code), '') = '' and new.file_key is null then
      raise exception 'Shader % needs code or a download file', new.slug using errcode = 'check_violation';
    end if;
    if btrim(new.explanation_md) = '' or btrim(new.setup_md) = '' or btrim(new.limitations_md) = '' then
      raise exception 'Shader % needs an explanation, setup steps and limitations', new.slug using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists shader_resources_publishable on public.shader_resources;
create trigger shader_resources_publishable before insert or update on public.shader_resources
  for each row execute function app.check_shader_publishable();

-- Starter projects: licensed, tested, described, with a download file.
create or replace function app.check_starter_publishable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' then
    if not app.known_licence(new.licence_id) then
      raise exception 'Starter project % needs a known licence before it is published', new.slug using errcode = 'check_violation';
    end if;
    if new.tested_at is null then
      raise exception 'Starter project % must record when it was tested before it is published', new.slug using errcode = 'check_violation';
    end if;
    if new.file_key is null then
      raise exception 'Starter project % needs a download file', new.slug using errcode = 'check_violation';
    end if;
    if btrim(new.description_md) = '' then
      raise exception 'Starter project % needs a description', new.slug using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists starter_projects_publishable on public.starter_projects;
create trigger starter_projects_publishable before insert or update on public.starter_projects
  for each row execute function app.check_starter_publishable();

-- Creators: approval needs a description, a link and a review date.
create or replace function app.check_creator_approvable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.approved then
    if btrim(new.description) = '' then
      raise exception 'Creator % needs a description before approval', new.slug using errcode = 'check_violation';
    end if;
    if new.youtube_channel_url is null and new.website_url is null then
      raise exception 'Creator % needs a channel or website link before approval', new.slug using errcode = 'check_violation';
    end if;
    if new.last_reviewed_at is null then
      raise exception 'Creator % needs a review date before approval', new.slug using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tutorial_creators_approvable on public.tutorial_creators;
create trigger tutorial_creators_approvable before insert or update on public.tutorial_creators
  for each row execute function app.check_creator_approvable();

-- Tutorials: a video or link, a summary, a review date, and an approved creator.
create or replace function app.check_tutorial_publishable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' then
    if new.youtube_video_id is null and new.external_url is null then
      raise exception 'Tutorial % needs a YouTube video or a link', new.slug using errcode = 'check_violation';
    end if;
    if btrim(new.summary) = '' then
      raise exception 'Tutorial % needs a summary of what viewers will learn', new.slug using errcode = 'check_violation';
    end if;
    if new.last_reviewed_at is null then
      raise exception 'Tutorial % needs a review date before it is published', new.slug using errcode = 'check_violation';
    end if;
    if new.creator_id is null or not exists (select 1 from public.tutorial_creators c where c.id = new.creator_id and c.approved) then
      raise exception 'Tutorial % needs an approved creator', new.slug using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tutorials_publishable on public.tutorials;
create trigger tutorials_publishable before insert or update on public.tutorials
  for each row execute function app.check_tutorial_publishable();

-- External resources: an https link, a description and a review date.
create or replace function app.check_resource_publishable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' then
    if new.url !~ '^https://' then
      raise exception 'Resource % needs an https link', new.slug using errcode = 'check_violation';
    end if;
    if btrim(new.description) = '' then
      raise exception 'Resource % needs a description', new.slug using errcode = 'check_violation';
    end if;
    if new.last_reviewed_at is null then
      raise exception 'Resource % needs a review date before it is published', new.slug using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists external_resources_publishable on public.external_resources;
create trigger external_resources_publishable before insert or update on public.external_resources
  for each row execute function app.check_resource_publishable();

-- Unapproving a creator takes their tutorials down with them.
create or replace function app.unpublish_creator_tutorials() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.approved and not new.approved then
    update public.tutorials set status = 'draft', published_at = null where creator_id = new.id and status = 'published';
  end if;
  return new;
end $$;
drop trigger if exists tutorial_creators_unapprove on public.tutorial_creators;
create trigger tutorial_creators_unapprove after update of approved on public.tutorial_creators
  for each row execute function app.unpublish_creator_tutorials();

-- Deleting a creator does the same before their tutorials lose the link.
create or replace function app.unpublish_deleted_creator_tutorials() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.tutorials set status = 'draft', published_at = null where creator_id = old.id and status = 'published';
  return old;
end $$;
drop trigger if exists tutorial_creators_delete on public.tutorial_creators;
create trigger tutorial_creators_delete before delete on public.tutorial_creators
  for each row execute function app.unpublish_deleted_creator_tutorials();

-- Editors curate drafts; admins publish. Tutorials, resources and creator
-- approval follow the same rule as assets, shaders and starter projects.
do $$
declare t text;
begin
  foreach t in array array['tutorials', 'external_resources']
  loop
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($p$create policy %I_write on public.%I for all to lp_authenticated
      using (app.is_admin() or (app.is_staff() and status in ('draft', 'review')))
      with check (app.is_admin() or (app.is_staff() and status in ('draft', 'review')))$p$, t, t);
  end loop;
end $$;
drop policy if exists tutorial_creators_write on public.tutorial_creators;
create policy tutorial_creators_write on public.tutorial_creators for all to lp_authenticated
  using (app.is_admin() or (app.is_staff() and not approved))
  with check (app.is_admin() or (app.is_staff() and not approved));
