-- Run once in the Supabase SQL editor if your project was created before
-- the monthly plan was removed. Existing monthly rows stay as they are
-- (the new checks are NOT VALID, so they only apply to new rows).

alter table public.subscription_requests drop constraint if exists subscription_requests_plan_check;
alter table public.subscription_requests add constraint subscription_requests_plan_check
    check (plan = 'yearly') not valid;

alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions add constraint subscriptions_plan_check
    check (plan in ('yearly', 'trial')) not valid;

-- Re-run the "create or replace function" blocks for plan_interval, plan_label,
-- the request price trigger and admin_grant_subscription from schema.sql
-- so new requests are priced at the yearly price only.
