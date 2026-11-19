-- Shaxsiy (hashlangan) link uchun: token bo'yicha loginsiz (anon) o'qish.
-- Supabase → SQL Editor ga qo'yib, bir marta "Run" qiling.
-- Xavfsizlik: faqat token to'g'ri kelgan ODAMNING hisob-kitobi qaytadi.
-- security definer — RLS ni chetlab o'tadi, lekin faqat shu funksiya ichida va faqat o'sha odam uchun.

create or replace function public.share_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_person jsonb;
begin
  -- Tokenga mos odamni topamiz (o'chirilmagan)
  select owner_id, data into v_owner, v_person
  from people
  where deleted = false and data->>'token' = p_token
  limit 1;

  if v_owner is null then
    return null;
  end if;

  return jsonb_build_object(
    'person', v_person,
    'settings', coalesce((select data from settings where owner_id = v_owner and id = 'main' limit 1), '{}'::jsonb),
    'products', coalesce((select jsonb_agg(data) from products
        where owner_id = v_owner and deleted = false), '[]'::jsonb),
    'warehouses', coalesce((select jsonb_agg(data) from warehouses
        where owner_id = v_owner and deleted = false), '[]'::jsonb),
    'docs', coalesce((select jsonb_agg(data) from docs
        where owner_id = v_owner and deleted = false and data->>'personId' = v_person->>'id'), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(data) from payments
        where owner_id = v_owner and deleted = false and data->>'personId' = v_person->>'id'), '[]'::jsonb)
  );
end;
$$;

-- Loginsiz (anon) foydalanuvchiga shu funksiyani chaqirishga ruxsat
grant execute on function public.share_get(text) to anon;
revoke all on function public.share_get(text) from public;
grant execute on function public.share_get(text) to anon, authenticated;
