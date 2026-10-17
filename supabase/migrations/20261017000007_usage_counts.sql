-- Cookieless usage counts for the plan's success metrics (search-to-download,
-- tool exports, 3D preview errors, Scene Builder sessions, Core Web Vitals).
-- One row per day, event and subject (a page section, tool or format): no
-- visitor identifiers, addresses, user agents or full URLs are stored.
create table if not exists public.usage_daily (
  day date not null,
  event text not null check (event ~ '^[a-z_]{2,32}$'),
  subject text not null default '' check (subject ~ '^[a-z0-9:_-]{0,64}$'),
  count integer not null default 0,
  -- Web Vitals: the sum of the reported values and how many were rated good.
  value_sum double precision not null default 0,
  good integer not null default 0,
  primary key (day, event, subject)
);
create index if not exists usage_daily_event_idx on public.usage_daily (event, day);

alter table public.usage_daily enable row level security;
drop policy if exists usage_daily_staff on public.usage_daily;
create policy usage_daily_staff on public.usage_daily for select to lp_authenticated using (app.is_staff());
grant select on public.usage_daily to lp_authenticated;
