-- Editors work on drafts and items in review; published and archived items
-- (and everything attached to them) are changed by admins only. Assets,
-- collections, shaders and starter projects already enforced this on their
-- own rows; their files, tags, creators, dependencies and collection members
-- now follow their parent.
create or replace function app.asset_editable(p_asset uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_admin() or (app.is_staff() and exists (
    select 1 from public.assets a where a.id = p_asset and a.status in ('draft', 'review')))
$$;
grant execute on function app.asset_editable(uuid) to lp_authenticated;

create or replace function app.collection_editable(p_collection uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_admin() or (app.is_staff() and exists (
    select 1 from public.collections c where c.id = p_collection and c.status in ('draft', 'review')))
$$;
grant execute on function app.collection_editable(uuid) to lp_authenticated;

drop policy if exists asset_files_write on public.asset_files;
create policy asset_files_write on public.asset_files for all to lp_authenticated
  using (app.asset_editable(asset_id)) with check (app.asset_editable(asset_id));

do $$
declare t text;
begin
  foreach t in array array['asset_tags', 'asset_creators', 'asset_dependencies']
  loop
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to lp_authenticated using (app.asset_editable(asset_id)) with check (app.asset_editable(asset_id))', t, t);
  end loop;
end $$;

drop policy if exists collection_assets_write on public.collection_assets;
create policy collection_assets_write on public.collection_assets for all to lp_authenticated
  using (app.collection_editable(collection_id)) with check (app.collection_editable(collection_id));
