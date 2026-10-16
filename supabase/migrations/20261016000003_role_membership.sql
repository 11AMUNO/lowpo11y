-- Make sure the connecting role can switch to the RLS roles. Replaces the
-- error-swallowing grant in the core migration: on hosts where the grant is
-- genuinely refused, deployment should fail loudly here rather than at the
-- first request with "permission denied to set role".
do $$
begin
  if not pg_has_role(current_user, 'lp_anon', 'MEMBER') then
    execute format('grant lp_anon to %I', current_user);
  end if;
  if not pg_has_role(current_user, 'lp_authenticated', 'MEMBER') then
    execute format('grant lp_authenticated to %I', current_user);
  end if;
end $$;
