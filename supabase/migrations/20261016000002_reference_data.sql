-- Reference data every environment needs. Upserts by natural key so it is
-- safe to re-run; editing these rows later happens in the admin CMS.

-- Licences. Clause flags are taken from each licence's published text; null
-- means "not stated" and is shown as such, never inferred.
insert into public.licences
  (code, human_label, short_label, canonical_url, commercial_use, modifications, attribution_required,
   redistribution_allowed, share_alike, allows_download, notes, sort_order)
values
  ('cc0-1.0', 'Creative Commons Zero 1.0 Universal', 'CC0', 'https://creativecommons.org/publicdomain/zero/1.0/',
   true, true, false, true, false, true, 'Public domain dedication. Credit appreciated, not required.', 10),
  ('cc-by-4.0', 'Creative Commons Attribution 4.0 International', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
   true, true, true, true, false, true, 'Credit the creator as described on the asset page.', 20),
  ('cc-by-sa-4.0', 'Creative Commons Attribution-ShareAlike 4.0 International', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/',
   true, true, true, true, true, true, 'Adaptations of the asset must be shared under the same licence.', 30),
  ('cc-by-nc-4.0', 'Creative Commons Attribution-NonCommercial 4.0 International', 'CC BY-NC 4.0', 'https://creativecommons.org/licenses/by-nc/4.0/',
   false, true, true, true, false, true, 'Not for commercial projects.', 40),
  ('mit', 'MIT License', 'MIT', 'https://opensource.org/license/mit',
   true, true, true, true, false, true, 'For code. Keep the copyright and licence notice in copies.', 50),
  ('unknown', 'Licence unknown', 'Unknown', null,
   null, null, null, null, false, false, 'Rights not confirmed. Downloads are blocked and the asset cannot be published.', 999)
on conflict (code) do nothing;

-- Categories.
insert into public.categories (slug, name, scope, sort_order) values
  ('props', 'Props', 'model', 10),
  ('furniture-interior', 'Furniture & interior', 'model', 20),
  ('electronics', 'Electronics & appliances', 'model', 30),
  ('vehicles', 'Vehicles', 'model', 40),
  ('transit', 'Transit & stations', 'model', 50),
  ('street', 'Street & market', 'model', 60),
  ('architecture', 'Architecture & modular', 'model', 70),
  ('nature', 'Nature & creatures', 'model', 80),
  ('characters', 'Characters', 'model', 90),
  ('wood', 'Wood', 'texture', 110),
  ('metal', 'Metal', 'texture', 120),
  ('stone-concrete', 'Stone & concrete', 'texture', 130),
  ('brick', 'Brick', 'texture', 140),
  ('ground', 'Ground', 'texture', 150),
  ('floor-tiles', 'Floors & tiles', 'texture', 160),
  ('fabric', 'Fabric', 'texture', 170),
  ('utility', 'Utility & test', 'texture', 180),
  ('decals', 'Decals & signage', 'any', 190)
on conflict (slug) do nothing;

-- Tags with facets used by catalogue filters.
insert into public.tags (slug, name, facet) values
  ('psx-inspired', 'PSX-inspired', 'style'),
  ('n64-inspired', 'N64-inspired', 'style'),
  ('ps2-inspired', 'PS2-inspired', 'style'),
  ('general-low-poly', 'General low-poly', 'style'),
  ('industrial', 'Industrial', 'setting'),
  ('urban', 'Urban', 'setting'),
  ('horror', 'Horror', 'setting'),
  ('domestic', 'Domestic', 'setting'),
  ('sci-fi', 'Sci-fi', 'setting'),
  ('derelict', 'Derelict', 'setting'),
  ('brutalist', 'Brutalist', 'setting'),
  ('transit', 'Transit', 'setting'),
  ('market', 'Market', 'setting'),
  ('nature', 'Nature', 'setting'),
  ('godot', 'Godot', 'engine'),
  ('blender', 'Blender', 'engine'),
  ('unity', 'Unity', 'engine'),
  ('unreal', 'Unreal', 'engine')
on conflict (slug) do nothing;

-- Publishing guard: a published asset must carry a known licence.
create or replace function app.check_asset_publishable() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lic_code text;
begin
  if new.status = 'published' then
    select code into lic_code from public.licences where id = new.licence_id;
    if lic_code is null or lic_code = 'unknown' then
      raise exception 'Asset % cannot be published without a known licence', new.slug using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists assets_publishable on public.assets;
create trigger assets_publishable before insert or update of status, licence_id on public.assets
  for each row execute function app.check_asset_publishable();
