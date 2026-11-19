-- Sklad hisobi: Supabase sxemasi.
-- Supabase → SQL Editor → New query → shu faylni to'liq qo'yib, "Run" bosing. Qayta ishga tushirsa ham zarar qilmaydi.
--
-- Har bir foydalanuvchi faqat o'z ma'lumotini ko'radi (owner_id = kirgan odam).
-- Har bir yozuv to'liq holda "data" ustunida saqlanadi; o'chirilganlar "deleted = true" bo'lib qoladi,
-- shunda boshqa qurilmalar ham o'chganini biladi.

create or replace function public.sklad_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

-- Skladlar
create table if not exists public.warehouses (
  owner_id   uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  name       text generated always as (data->>'name') stored,
  primary key (owner_id, id)
);

-- Tovarlar
create table if not exists public.products (
  owner_id   uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  name       text generated always as (data->>'name') stored,
  primary key (owner_id, id)
);

-- Do'konlar
create table if not exists public.people (
  owner_id   uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  name       text generated always as (data->>'name') stored,
  primary key (owner_id, id)
);

-- Hujjatlar (kirim, chiqim, qaytish, ko'chirish, inventarizatsiya) — qatorlari bilan birga
create table if not exists public.docs (
  owner_id   uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  no         integer generated always as ((data->>'no')::integer) stored,
  type       text    generated always as (data->>'type') stored,
  date       text    generated always as (data->>'date') stored,
  primary key (owner_id, id)
);
-- Bir odamda bir xil raqamli ikkita hujjat bo'lmasin
create unique index if not exists docs_owner_no on public.docs (owner_id, no) where not deleted;

-- Sozlamalar (pul belgisi, oxirgi hujjat raqami)
create table if not exists public.settings (
  owner_id   uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, id)
);

-- O'zgarishlarni tez topish uchun indeks, vaqt belgisi trigger'i va xavfsizlik qoidalari
do $$
declare t text;
begin
  foreach t in array array['warehouses', 'products', 'people', 'docs', 'settings'] loop
    execute format('create index if not exists %I on public.%I (owner_id, updated_at)', t || '_updated', t);
    execute format('drop trigger if exists sklad_touch on public.%I', t);
    execute format('create trigger sklad_touch before insert or update on public.%I for each row execute function public.sklad_touch()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "faqat o''zimniki" on public.%I', t);
    execute format('create policy "faqat o''zimniki" on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
