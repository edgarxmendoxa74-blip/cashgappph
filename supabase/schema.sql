-- =====================================================================
-- CashG Inventory App — Supabase database schema
--
-- Run this once in Supabase → SQL Editor → New query → Run.
-- It creates the tables, security rules, storage bucket and the
-- functions the app and the admin dashboard use.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- One row per login account (created automatically for each auth user)
create table if not exists public.profiles (
    id            uuid primary key references auth.users (id) on delete cascade,
    email         text,
    full_name     text not null default '',
    phone         text not null default '',
    business_name text not null default '',
    role          text not null default 'user'   check (role in ('user', 'admin')),
    status        text not null default 'active' check (status in ('active', 'disabled')),
    created_at    timestamptz not null default now()
);

-- Prices and payment details shown in the app (single row, id = 1)
create table if not exists public.app_settings (
    id                   int primary key default 1 check (id = 1),
    monthly_price        numeric(10, 2) not null default 199,
    yearly_price         numeric(10, 2) not null default 1999,
    payment_gcash_name   text not null default '',
    payment_gcash_number text not null default '',
    payment_instructions text not null default '',
    updated_at           timestamptz not null default now()
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- A user's "I paid, please activate my plan" form
create table if not exists public.subscription_requests (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references public.profiles (id) on delete cascade,
    plan              text not null check (plan in ('monthly', 'yearly')),
    amount            numeric(10, 2) not null default 0,
    full_name         text not null,
    phone             text not null,
    email             text,
    business_name     text not null default '',
    address           text not null default '',
    payment_reference text not null,
    proof_path        text not null,
    status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    admin_note        text,
    reviewed_by       uuid references public.profiles (id) on delete set null,
    reviewed_at       timestamptz,
    created_at        timestamptz not null default now()
);

-- Only one request per user can wait for review at a time
create unique index if not exists subscription_requests_one_pending
    on public.subscription_requests (user_id) where status = 'pending';

create index if not exists subscription_requests_created_idx
    on public.subscription_requests (created_at desc);

-- Paid (or granted) periods. A user's access runs until their latest ends_at.
create table if not exists public.subscriptions (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.profiles (id) on delete cascade,
    plan       text not null check (plan in ('monthly', 'yearly', 'trial')),
    amount     numeric(10, 2) not null default 0,
    starts_at  timestamptz not null,
    ends_at    timestamptz not null,
    request_id uuid references public.subscription_requests (id) on delete set null,
    created_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default now(),
    check (ends_at > starts_at)
);

create index if not exists subscriptions_user_ends_idx
    on public.subscriptions (user_id, ends_at desc);

-- In-app notifications
create table if not exists public.notifications (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.profiles (id) on delete cascade,
    title      text not null,
    body       text not null default '',
    type       text not null default 'info' check (type in ('info', 'success', 'warning', 'error')),
    read_at    timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
    on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin' and status = 'active'
    );
$$;

create or replace function public.plan_interval(p_plan text, p_days int default null)
returns interval
language sql
immutable
as $$
    select case p_plan
        when 'monthly' then interval '1 month'
        when 'yearly'  then interval '1 year'
        else make_interval(days => coalesce(p_days, 7))
    end;
$$;

create or replace function public.plan_label(p_plan text)
returns text
language sql
immutable
as $$
    select case p_plan
        when 'monthly' then 'Monthly'
        when 'yearly'  then 'Yearly'
        else 'Trial'
    end;
$$;

-- Create a profile row whenever a login account is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, full_name, phone, business_name)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', ''),
        coalesce(new.raw_user_meta_data ->> 'phone', ''),
        coalesce(new.raw_user_meta_data ->> 'business_name', '')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- New requests: price comes from app_settings, never from the client
create or replace function public.prepare_subscription_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    s public.app_settings;
begin
    select * into s from public.app_settings where id = 1;
    new.amount      := case new.plan when 'monthly' then s.monthly_price else s.yearly_price end;
    new.email       := (select email from public.profiles where id = new.user_id);
    new.status      := 'pending';
    new.admin_note  := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.created_at  := now();
    return new;
end;
$$;

drop trigger if exists before_subscription_request_insert on public.subscription_requests;
create trigger before_subscription_request_insert
    before insert on public.subscription_requests
    for each row execute function public.prepare_subscription_request();

-- Start a new period right after the user's current one (or now, if none/expired)
create or replace function public.add_subscription_period(
    p_user_id uuid, p_plan text, p_amount numeric, p_request_id uuid, p_days int default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_start timestamptz;
    v_row   public.subscriptions;
begin
    select greatest(now(), coalesce(max(ends_at), now())) into v_start
    from public.subscriptions where user_id = p_user_id;

    insert into public.subscriptions (user_id, plan, amount, starts_at, ends_at, request_id, created_by)
    values (p_user_id, p_plan, coalesce(p_amount, 0), v_start, v_start + public.plan_interval(p_plan, p_days), p_request_id, auth.uid())
    returning * into v_row;

    return v_row;
end;
$$;

revoke execute on function public.add_subscription_period(uuid, text, numeric, uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Admin actions (called from the admin dashboard)
-- ---------------------------------------------------------------------

create or replace function public.approve_subscription_request(p_request_id uuid, p_note text default null)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
    r     public.subscription_requests;
    v_sub public.subscriptions;
begin
    if not public.is_admin() then
        raise exception 'Only admins can approve payments';
    end if;

    select * into r from public.subscription_requests where id = p_request_id for update;
    if not found then
        raise exception 'Request not found';
    end if;
    if r.status <> 'pending' then
        raise exception 'This request was already %', r.status;
    end if;

    v_sub := public.add_subscription_period(r.user_id, r.plan, r.amount, r.id);

    update public.subscription_requests
    set status = 'approved', admin_note = nullif(trim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
    where id = r.id;

    insert into public.notifications (user_id, title, body, type)
    values (
        r.user_id,
        'Payment approved',
        format('Your %s plan is active until %s.', public.plan_label(r.plan),
               to_char(v_sub.ends_at at time zone 'Asia/Manila', 'FMMon FMDD, YYYY')),
        'success'
    );

    return v_sub;
end;
$$;

create or replace function public.reject_subscription_request(p_request_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    r public.subscription_requests;
begin
    if not public.is_admin() then
        raise exception 'Only admins can reject payments';
    end if;

    select * into r from public.subscription_requests where id = p_request_id for update;
    if not found then
        raise exception 'Request not found';
    end if;
    if r.status <> 'pending' then
        raise exception 'This request was already %', r.status;
    end if;

    update public.subscription_requests
    set status = 'rejected', admin_note = nullif(trim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
    where id = r.id;

    insert into public.notifications (user_id, title, body, type)
    values (
        r.user_id,
        'Payment not approved',
        coalesce(nullif(trim(p_note), ''), 'Please check your payment details and submit again.'),
        'error'
    );
end;
$$;

-- Give time without a payment request (cash payment, free trial, goodwill)
create or replace function public.admin_grant_subscription(
    p_user_id uuid, p_plan text, p_days int default null, p_amount numeric default 0
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_sub public.subscriptions;
begin
    if not public.is_admin() then
        raise exception 'Only admins can grant subscriptions';
    end if;
    if p_plan not in ('monthly', 'yearly', 'trial') then
        raise exception 'Unknown plan %', p_plan;
    end if;

    v_sub := public.add_subscription_period(p_user_id, p_plan, p_amount, null, p_days);

    insert into public.notifications (user_id, title, body, type)
    values (
        p_user_id,
        case when p_plan = 'trial' then 'Free trial started' else 'Subscription activated' end,
        format('Your %s access is active until %s.', public.plan_label(p_plan),
               to_char(v_sub.ends_at at time zone 'Asia/Manila', 'FMMon FMDD, YYYY')),
        'success'
    );

    return v_sub;
end;
$$;

-- End a user's access now (e.g. refund or abuse)
create or replace function public.admin_end_subscription(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Only admins can end subscriptions';
    end if;

    update public.subscriptions set ends_at = greatest(starts_at + interval '1 second', now())
    where user_id = p_user_id and ends_at > now();

    delete from public.subscriptions where user_id = p_user_id and starts_at > now();
end;
$$;

-- Users mark their own notifications as read
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = public
as $$
    update public.notifications
    set read_at = now()
    where user_id = auth.uid()
      and read_at is null
      and (p_ids is null or id = any (p_ids));
$$;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------

alter table public.profiles              enable row level security;
alter table public.app_settings          enable row level security;
alter table public.subscription_requests enable row level security;
alter table public.subscriptions         enable row level security;
alter table public.notifications         enable row level security;

drop policy if exists "profiles: read own or admin"   on public.profiles;
drop policy if exists "profiles: admin updates"       on public.profiles;
create policy "profiles: read own or admin" on public.profiles
    for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles: admin updates" on public.profiles
    for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "settings: signed-in users read" on public.app_settings;
drop policy if exists "settings: admin updates"        on public.app_settings;
create policy "settings: signed-in users read" on public.app_settings
    for select to authenticated using (true);
create policy "settings: admin updates" on public.app_settings
    for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "requests: read own or admin" on public.subscription_requests;
drop policy if exists "requests: users submit own"  on public.subscription_requests;
create policy "requests: read own or admin" on public.subscription_requests
    for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "requests: users submit own" on public.subscription_requests
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
    );

drop policy if exists "subscriptions: read own or admin" on public.subscriptions;
create policy "subscriptions: read own or admin" on public.subscriptions
    for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "notifications: read own or admin" on public.notifications;
drop policy if exists "notifications: admin sends"       on public.notifications;
create policy "notifications: read own or admin" on public.notifications
    for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "notifications: admin sends" on public.notifications
    for insert to authenticated with check (public.is_admin());

-- The public (signed-out) role gets nothing
revoke all on public.profiles, public.app_settings, public.subscription_requests,
              public.subscriptions, public.notifications from anon;

-- ---------------------------------------------------------------------
-- Payment proof storage (private bucket, one folder per user)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

drop policy if exists "proofs: users upload to own folder" on storage.objects;
drop policy if exists "proofs: read own or admin"          on storage.objects;
create policy "proofs: users upload to own folder" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "proofs: read own or admin" on storage.objects
    for select to authenticated
    using (bucket_id = 'payment-proofs'
           and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------
-- Announcements (Admin → Notifications)
--
-- An announcement is sent as one notification row per matching user, so
-- it shows in the app's bell like any other notification. Deleting an
-- announcement removes it from every user's list.
-- ---------------------------------------------------------------------

create table if not exists public.announcements (
    id              uuid primary key default gen_random_uuid(),
    title           text not null,
    body            text not null default '',
    type            text not null default 'info' check (type in ('info', 'success', 'warning', 'error')),
    audience        text not null default 'all' check (audience in ('all', 'active', 'expired', 'no_plan')),
    recipient_count int  not null default 0,
    created_by      uuid references public.profiles (id) on delete set null,
    created_at      timestamptz not null default now()
);

create index if not exists announcements_created_idx
    on public.announcements (created_at desc);

alter table public.notifications
    add column if not exists announcement_id uuid references public.announcements (id) on delete cascade;

create index if not exists notifications_announcement_idx
    on public.notifications (announcement_id) where announcement_id is not null;

alter table public.announcements enable row level security;

drop policy if exists "announcements: admin reads"   on public.announcements;
drop policy if exists "announcements: admin deletes" on public.announcements;
create policy "announcements: admin reads" on public.announcements
    for select to authenticated using (public.is_admin());
create policy "announcements: admin deletes" on public.announcements
    for delete to authenticated using (public.is_admin());

revoke all on public.announcements from anon;

-- Send to every active user account in the chosen audience:
--   all      everyone
--   active   has access right now (paid or trial)
--   expired  had a plan before, none right now
--   no_plan  never had a plan
create or replace function public.admin_send_announcement(
    p_title text, p_body text default '', p_type text default 'info', p_audience text default 'all'
)
returns public.announcements
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row   public.announcements;
    v_count int;
begin
    if not public.is_admin() then
        raise exception 'Only admins can send announcements';
    end if;
    if coalesce(trim(p_title), '') = '' then
        raise exception 'Title is required';
    end if;
    if p_type not in ('info', 'success', 'warning', 'error') then
        raise exception 'Unknown type %', p_type;
    end if;
    if p_audience not in ('all', 'active', 'expired', 'no_plan') then
        raise exception 'Unknown audience %', p_audience;
    end if;

    insert into public.announcements (title, body, type, audience, created_by)
    values (left(trim(p_title), 120), left(coalesce(trim(p_body), ''), 1000), p_type, p_audience, auth.uid())
    returning * into v_row;

    insert into public.notifications (user_id, title, body, type, announcement_id)
    select p.id, v_row.title, v_row.body, v_row.type, v_row.id
    from public.profiles p
    where p.role = 'user'
      and p.status = 'active'
      and case p_audience
            when 'active' then exists (
                select 1 from public.subscriptions s
                where s.user_id = p.id and s.starts_at <= now() and s.ends_at > now())
            when 'expired' then exists (
                select 1 from public.subscriptions s where s.user_id = p.id)
              and not exists (
                select 1 from public.subscriptions s
                where s.user_id = p.id and s.starts_at <= now() and s.ends_at > now())
            when 'no_plan' then not exists (
                select 1 from public.subscriptions s where s.user_id = p.id)
            else true
          end;

    get diagnostics v_count = row_count;

    update public.announcements set recipient_count = v_count
    where id = v_row.id
    returning * into v_row;

    return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- Make yourself admin (run once, after creating your own login in
-- Supabase → Authentication → Users → Add user):
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Payment methods & generated receipts
--
-- Users pay by GCash (e-wallet) or bank transfer, then generate a PNG
-- receipt in the app. The receipt image is uploaded to ImageKit
-- (receipt_url) or, if ImageKit isn't set up, to the payment-proofs
-- bucket (proof_path). The screenshot upload is no longer required.
-- ---------------------------------------------------------------------

alter table public.app_settings
    add column if not exists payment_bank_name           text not null default '',
    add column if not exists payment_bank_account_name   text not null default '',
    add column if not exists payment_bank_account_number text not null default '';

alter table public.subscription_requests
    add column if not exists payment_method text not null default 'gcash',
    add column if not exists sender_name    text not null default '',
    add column if not exists sender_account text not null default '',
    add column if not exists sender_bank    text not null default '',
    add column if not exists receipt_no     text,
    add column if not exists receipt_url    text;

alter table public.subscription_requests alter column proof_path drop not null;

alter table public.subscription_requests drop constraint if exists subscription_requests_payment_method_check;
alter table public.subscription_requests add constraint subscription_requests_payment_method_check
    check (payment_method in ('gcash', 'bank'));

alter table public.subscription_requests drop constraint if exists subscription_requests_has_proof;
alter table public.subscription_requests add constraint subscription_requests_has_proof
    check (proof_path is not null or receipt_url is not null);

alter table public.subscription_requests drop constraint if exists subscription_requests_receipt_url_check;
alter table public.subscription_requests add constraint subscription_requests_receipt_url_check
    check (receipt_url is null or receipt_url like 'https://ik.imagekit.io/%');
