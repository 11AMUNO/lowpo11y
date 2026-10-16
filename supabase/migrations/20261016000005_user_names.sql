-- Display names for audit trails and "handled by" columns. The users table
-- stays service-only; this view exposes id and display name to staff only.
create or replace view public.user_names as
  select u.id, u.display_name from public.users u where app.is_staff();

revoke all on public.user_names from public;
grant select on public.user_names to lp_authenticated;
