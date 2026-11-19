-- To'lovlar (do'kon pul berishi) bulutga saqlanishi uchun.
-- Supabase → SQL Editor → bu kodni qo'yib "Run" bosing (bir martalik).
-- Buni ishga tushirmaguncha ham dastur ishlaydi — to'lovlar faqat shu kompyuterda qoladi.

create table if not exists public.payments (
  owner_id   uuid        not null references auth.users(id) on delete cascade,
  id         text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

alter table public.payments enable row level security;

drop policy if exists "payments own rows" on public.payments;
create policy "payments own rows" on public.payments
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- har o'zgarishda updated_at yangilanadi (sinxron buning orqali ishlaydi)
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists payments_touch on public.payments;
create trigger payments_touch
  before update on public.payments
  for each row execute function public.touch_updated_at();
