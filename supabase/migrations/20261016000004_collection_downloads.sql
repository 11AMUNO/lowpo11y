-- Pack downloads are counted like file downloads: a running total and a
-- per-day count, with no visitor identifiers.
alter table public.collections add column if not exists download_count integer not null default 0;

create table if not exists public.collection_download_daily (
  collection_id uuid not null references public.collections (id) on delete cascade,
  day date not null,
  downloads integer not null default 0,
  primary key (collection_id, day)
);
alter table public.collection_download_daily enable row level security;

drop policy if exists collection_download_daily_staff on public.collection_download_daily;
create policy collection_download_daily_staff on public.collection_download_daily for select to lp_authenticated using (app.is_staff());
grant select on public.collection_download_daily to lp_authenticated;
