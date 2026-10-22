-- Hamburgueria do Seu Paulo - tabelas do sistema de fichas.
-- Rode uma vez no SQL Editor do projeto Supabase (pode rodar de novo sem problema).
-- ATENCAO: o acesso e aberto (sem login), como combinado. Quem tiver o link e a chave publica consegue ler e alterar os dados.

create table if not exists public.sp_fichas (
  id text primary key,
  valor numeric(10,2) not null,
  cor text not null default 'cinza',
  ativa boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.sp_produtos (
  id text primary key,
  nome text not null,
  preco numeric(10,2) not null,
  categoria text,
  ficha_valor numeric(10,2),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.sp_eventos (
  id text primary key,
  nome text not null,
  data date not null,
  aberto boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.sp_vendas (
  id text primary key,
  evento_id text not null,
  criado_em timestamptz not null default now(),
  total numeric(10,2) not null,
  forma_pagamento text not null default 'Dinheiro',
  itens jsonb not null default '[]'::jsonb,
  fichas jsonb not null default '[]'::jsonb,
  resto numeric(10,2) not null default 0,
  cancelada boolean not null default false,
  atualizado_em timestamptz not null default now()
);

create index if not exists sp_vendas_evento_idx on public.sp_vendas (evento_id, criado_em);

alter table public.sp_fichas enable row level security;
alter table public.sp_produtos enable row level security;
alter table public.sp_eventos enable row level security;
alter table public.sp_vendas enable row level security;

drop policy if exists sp_fichas_aberto on public.sp_fichas;
drop policy if exists sp_produtos_aberto on public.sp_produtos;
drop policy if exists sp_eventos_aberto on public.sp_eventos;
drop policy if exists sp_vendas_aberto on public.sp_vendas;

create policy sp_fichas_aberto on public.sp_fichas for all to anon, authenticated using (true) with check (true);
create policy sp_produtos_aberto on public.sp_produtos for all to anon, authenticated using (true) with check (true);
create policy sp_eventos_aberto on public.sp_eventos for all to anon, authenticated using (true) with check (true);
create policy sp_vendas_aberto on public.sp_vendas for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.sp_fichas, public.sp_produtos, public.sp_eventos, public.sp_vendas to anon, authenticated;
