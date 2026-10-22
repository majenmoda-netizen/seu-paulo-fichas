-- Permite mais de uma ficha por produto (ex.: um produto que se paga com 10 + 15).
-- Rode uma vez no SQL Editor do projeto. Pode rodar de novo sem problema.
alter table public.sp_produtos add column if not exists fichas_valores jsonb not null default '[]'::jsonb;
update public.sp_produtos set fichas_valores = jsonb_build_array(ficha_valor)
  where ficha_valor is not null and fichas_valores = '[]'::jsonb;
