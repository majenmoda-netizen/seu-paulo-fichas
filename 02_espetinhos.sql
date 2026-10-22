-- =====================================================================
-- Espetinhos do Seu Paulo - 02_espetinhos.sql
-- Acrescenta ao projeto atual (mesmo Supabase das fichas): estoque, ficha
-- tecnica, markup, clientes, pedidos (mesa / entrega / pessoa X), fila de
-- impressao. Rode uma vez no SQL Editor. Pode rodar de novo sem problema.
-- Acesso: aberto, como o restante do sistema (so Victor e Paulo usam o link).
-- =====================================================================

-- Produtos ganham custo e markup (o preco continua sendo editavel).
alter table public.sp_produtos add column if not exists custo numeric(10,2) not null default 0;
alter table public.sp_produtos add column if not exists tipo text not null default 'produto';  -- produto | insumo_pronto

-- Insumos: carne, pao, acai, chopp, bebidas, embalagens...
create table if not exists public.sp_insumos (
  id text primary key,
  nome text not null,
  unidade text not null default 'un',         -- un, kg, g, l, ml, pct
  categoria text,                             -- carne, pao, bebida, acai, embalagem, outros
  custo_unitario numeric(10,4) not null default 0,
  estoque_atual numeric(12,3) not null default 0,
  estoque_minimo numeric(12,3) not null default 0,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

-- Ficha tecnica: quanto de cada insumo sai em 1 unidade do produto.
create table if not exists public.sp_ficha_tecnica (
  id text primary key,
  produto_id text not null,
  insumo_id text not null,
  quantidade numeric(12,4) not null,
  atualizado_em timestamptz not null default now(),
  unique (produto_id, insumo_id)
);

-- Movimentos de estoque: entrada, saida manual, ajuste e venda (baixa automatica).
create table if not exists public.sp_movimentos_estoque (
  id text primary key,
  insumo_id text not null,
  tipo text not null check (tipo in ('entrada','saida','ajuste','venda')),
  quantidade numeric(12,3) not null,          -- positiva; o sinal vem do tipo
  custo_unitario numeric(10,4),
  observacao text,
  pedido_id text,
  criado_em timestamptz not null default now()
);

-- Clientes (para entrega).
create table if not exists public.sp_clientes (
  id text primary key,
  nome text not null,
  telefone text,
  endereco text,
  bairro text,
  observacao text,
  atualizado_em timestamptz not null default now()
);

-- Tarifario de entrega por bairro (editavel).
create table if not exists public.sp_bairros (
  id text primary key,
  nome text not null unique,
  taxa numeric(10,2) not null default 0,
  atualizado_em timestamptz not null default now()
);

-- Pedidos: mesa, entrega ou pessoa X (balcao).
create table if not exists public.sp_pedidos (
  id text primary key,
  tipo text not null check (tipo in ('mesa','entrega','balcao')),
  mesa text,
  cliente_id text,
  cliente_nome text,
  endereco text,
  bairro text,
  taxa_entrega numeric(10,2) not null default 0,
  itens jsonb not null default '[]'::jsonb,   -- [{produto_id, nome, qtd, preco, custo, obs}]
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  forma_pagamento text,
  status text not null default 'aberto' check (status in ('aberto','entregue','pago','cancelado')),
  observacao text,
  criado_em timestamptz not null default now(),
  fechado_em timestamptz,
  atualizado_em timestamptz not null default now()
);

-- Fila de impressao: o site grava aqui e o programa do caixa imprime.
create table if not exists public.sp_impressao_fila (
  id text primary key,
  pedido_id text,
  via text not null check (via in ('cozinha','caixa')),
  conteudo text not null,                     -- texto ja formatado (80 mm)
  status text not null default 'pendente' check (status in ('pendente','impresso','erro')),
  erro text,
  criado_em timestamptz not null default now(),
  impresso_em timestamptz
);

create index if not exists sp_pedidos_criado_idx on public.sp_pedidos (criado_em);
create index if not exists sp_fila_status_idx on public.sp_impressao_fila (status, criado_em);
create index if not exists sp_mov_insumo_idx on public.sp_movimentos_estoque (insumo_id, criado_em);

alter table public.sp_insumos enable row level security;
alter table public.sp_ficha_tecnica enable row level security;
alter table public.sp_movimentos_estoque enable row level security;
alter table public.sp_clientes enable row level security;
alter table public.sp_bairros enable row level security;
alter table public.sp_pedidos enable row level security;
alter table public.sp_impressao_fila enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sp_insumos','sp_ficha_tecnica','sp_movimentos_estoque','sp_clientes','sp_bairros','sp_pedidos','sp_impressao_fila'] loop
    execute format('drop policy if exists %I on public.%I', t || '_aberto', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', t || '_aberto', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;

-- Tarifario inicial (da imagem de entregas). So cria se ainda nao existir.
insert into public.sp_bairros (id, nome, taxa) values
  ('b-oliveiras','Oliveiras',5), ('b-tenorios',U&'Ten\00F3rios',10), ('b-furrinhas','Furrinhas',10),
  ('b-furnas','Furnas',15), ('b-pocos',U&'Bairro dos Po\00E7os',15), ('b-campininha','Campininha',20)
on conflict (nome) do nothing;
