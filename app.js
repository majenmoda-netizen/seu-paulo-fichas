"use strict";

// Hamburgueria do Seu Paulo: vendas por fichas nos eventos.
// Funciona sem internet: tudo é gravado primeiro no aparelho e enviado ao banco (Supabase) quando houver sinal.

const KEY = "seu-paulo:v1";
const TABELAS = { fichas: "sp_fichas", produtos: "sp_produtos", eventos: "sp_eventos", vendas: "sp_vendas" };
const COLUNAS = {
  fichas: ["id", "valor", "cor", "ativa", "atualizado_em"],
  produtos: ["id", "nome", "preco", "categoria", "ficha_valor", "fichas_valores", "ativo", "atualizado_em"],
  eventos: ["id", "nome", "data", "aberto", "atualizado_em"],
  vendas: ["id", "evento_id", "criado_em", "total", "forma_pagamento", "itens", "fichas", "resto", "cancelada", "atualizado_em"],
};
const CORES = { branca: "Branca", verde: "Verde", azul: "Azul", vermelha: "Vermelha", amarela: "Amarela", laranja: "Laranja", roxa: "Roxa", rosa: "Rosa", preta: "Preta", cinza: "Cinza" };
const FICHAS_INICIAIS = [[3, "branca"], [6, "verde"], [9, "azul"], [10, "vermelha"], [15, "amarela"]];
const FORMAS = ["Dinheiro", "Pix", "Cartão"];

// ---------- Utilidades ----------

const $ = (selector) => document.querySelector(selector);
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (n) => brl.format(n).replace(/ /g, " ");
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

// Aceita "6,50", "6.50" e "1.234,50".
function parseMoney(text) {
  let s = String(text ?? "").trim().replace(/\s/g, "");
  if (!s) return NaN;
  s = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const formatDate = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const formatTime = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// ---------- Estado (guardado no aparelho) ----------

function blank() {
  return { fichas: [], produtos: [], eventos: [], vendas: [], outbox: [], eventoAtivo: null, semente: false, ultimoSync: null };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && Array.isArray(saved.fichas)) return { ...blank(), ...saved };
  } catch (error) {
    // Armazenamento indisponível: começa vazio.
  }
  return blank();
}

let state = load();
const ui = { tab: "pedidos", forma: "Dinheiro", modo: "total", editProduto: null, editFicha: null };
let cart = {}; // produto_id -> quantidade

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (error) {
    // Sem espaço ou bloqueado: o app continua funcionando nesta sessão.
  }
}

// ---------- Banco (Supabase) ----------

const config = window.SP_CONFIG || {};
let db = config.supabaseUrl && config.supabaseAnonKey && window.supabase
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;
let sincronizando = false;
let refazerSync = false;
let ultimoErro = "";
let timerSync = null;

function upsertLocal(tabela, dados) {
  const lista = state[tabela];
  const i = lista.findIndex((x) => x.id === dados.id);
  if (i >= 0) lista[i] = { ...lista[i], ...dados };
  else lista.push(dados);
}

// Grava no aparelho na hora e coloca na fila para enviar ao banco.
function salvar(tabela, dados, { silencioso = false } = {}) {
  dados.atualizado_em = new Date().toISOString();
  upsertLocal(tabela, dados);
  const i = state.outbox.findIndex((o) => o.tabela === tabela && o.dados.id === dados.id);
  if (i >= 0) state.outbox.splice(i, 1);
  state.outbox.push({ tabela, dados: { ...state[tabela].find((x) => x.id === dados.id) } });
  save();
  if (!silencioso) {
    render();
    agendarSync();
  }
}

function agendarSync() {
  clearTimeout(timerSync);
  timerSync = setTimeout(sync, 400);
}

const paraBanco = (tabela, dados) => Object.fromEntries(COLUNAS[tabela].filter((c) => c in dados).map((c) => [c, dados[c]]));

function normalizar(tabela, linha) {
  const out = { ...linha };
  ["valor", "preco", "ficha_valor", "total", "resto"].forEach((c) => {
    if (c in out && out[c] !== null && out[c] !== undefined) out[c] = Number(out[c]);
  });
  return out;
}

// Traz o que veio do banco, sem pisar no que ainda não foi enviado deste aparelho.
function mergeServidor(tabela, linhas) {
  const pendentes = new Set(state.outbox.filter((o) => o.tabela === tabela).map((o) => o.dados.id));
  state[tabela] = [...linhas.filter((l) => !pendentes.has(l.id)), ...state[tabela].filter((l) => pendentes.has(l.id))];
}

let syncAtual = null;
function sync() {
  if (sincronizando) {
    refazerSync = true;
    return syncAtual;
  }
  syncAtual = rodarSync();
  return syncAtual;
}

async function rodarSync() {
  if (!db) {
    renderStatus();
    return;
  }
  sincronizando = true;
  renderStatus();
  try {
    while (state.outbox.length > 0) {
      const op = state.outbox[0];
      const { error } = await db.from(TABELAS[op.tabela]).upsert(paraBanco(op.tabela, op.dados));
      if (error) throw error;
      state.outbox.shift();
      save();
    }
    for (const tabela of Object.keys(TABELAS)) {
      const { data, error } = await db.from(TABELAS[tabela]).select("*");
      if (error) throw error;
      mergeServidor(tabela, data.map((linha) => normalizar(tabela, linha)));
    }
    state.ultimoSync = new Date().toISOString();
    ultimoErro = "";
  } catch (error) {
    ultimoErro = (error && error.message) || String(error);
  } finally {
    sincronizando = false;
    save();
    render();
    if (refazerSync) {
      refazerSync = false;
      return sync();
    }
  }
}

// ---------- Fichas: quais entregar ----------

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Monta o valor com o MENOR número de fichas possível. Se o valor não fecha exato com as fichas
// que existem, usa o maior valor que cabe e devolve o resto para cobrar em dinheiro.
function montarFichas(total, valores) {
  const cents = Math.round(total * 100);
  const denoms = [...new Set(valores.map((v) => Math.round(v * 100)).filter((d) => d > 0))].sort((a, b) => b - a);
  if (cents <= 0) return { fichas: [], resto: 0 };
  if (denoms.length === 0) return { fichas: [], resto: cents / 100 };

  const unit = denoms.reduce(gcd);
  const alvo = Math.floor(cents / unit);
  const ds = denoms.map((d) => d / unit);
  const contagem = new Map();

  if (alvo > 2000000) {
    // Valor enorme: método simples (maior ficha primeiro).
    let sobra = cents;
    denoms.forEach((d) => {
      const q = Math.floor(sobra / d);
      if (q > 0) contagem.set(d, q);
      sobra -= q * d;
    });
    return { fichas: [...contagem.entries()].map(([d, q]) => ({ valor: d / 100, quantidade: q })), resto: sobra / 100 };
  }

  const melhor = new Array(alvo + 1).fill(Infinity);
  const usa = new Array(alvo + 1).fill(0);
  melhor[0] = 0;
  for (let i = 1; i <= alvo; i++) {
    for (const d of ds) {
      // "<" estrito + fichas da maior para a menor: no empate, vence a ficha maior.
      if (d <= i && melhor[i - d] + 1 < melhor[i]) {
        melhor[i] = melhor[i - d] + 1;
        usa[i] = d;
      }
    }
  }
  let i = alvo;
  while (i > 0 && melhor[i] === Infinity) i--;
  const alcancado = i;
  while (i > 0) {
    const d = usa[i] * unit;
    contagem.set(d, (contagem.get(d) || 0) + 1);
    i -= usa[i];
  }
  return {
    fichas: [...contagem.entries()].sort((a, b) => b[0] - a[0]).map(([d, q]) => ({ valor: d / 100, quantidade: q })),
    resto: round2((cents - alcancado * unit) / 100),
  };
}

// Modo "por produto": cada produto tem uma ficha (cerveja = ficha de R$ 6). Se o preço não for múltiplo da
// ficha do produto, ou se ele não tiver ficha, aquele item é montado pelo total.
// Fichas que o produto aceita (pode ser mais de uma).
const fichasDoProduto = (p) => (Array.isArray(p.fichas_valores) && p.fichas_valores.length ? p.fichas_valores.map(Number) : p.ficha_valor ? [Number(p.ficha_valor)] : []);

// Menor quantidade de fichas (das escolhidas no produto) que soma exatamente o valor. null se não for possível.
function combinacaoExata(total, valores) {
  const alvo = Math.round(total * 100);
  const moedas = [...new Set(valores.map((v) => Math.round(v * 100)))].filter((v) => v > 0);
  if (!moedas.length || alvo < 0) return null;
  const INF = 1e9;
  const melhor = new Array(alvo + 1).fill(INF);
  const usa = new Array(alvo + 1).fill(-1);
  melhor[0] = 0;
  for (let a = 1; a <= alvo; a++) {
    for (const m of moedas) if (m <= a && melhor[a - m] + 1 < melhor[a]) { melhor[a] = melhor[a - m] + 1; usa[a] = m; }
  }
  if (melhor[alvo] >= INF) return null;
  const out = new Map();
  for (let a = alvo; a > 0; a -= usa[a]) out.set(usa[a] / 100, (out.get(usa[a] / 100) || 0) + 1);
  return out;
}

function fichasPorProduto(itens, valores) {
  const soma = new Map();
  let resto = 0;
  const add = (valor, q) => soma.set(valor, (soma.get(valor) || 0) + q);
  itens.forEach((it) => {
    const combo = combinacaoExata(it.preco * it.quantidade, it.fichas || []);
    if (combo) {
      combo.forEach((q, valor) => add(valor, q));
    } else {
      const r = montarFichas(it.preco * it.quantidade, valores);
      r.fichas.forEach((x) => add(x.valor, x.quantidade));
      resto += r.resto;
    }
  });
  return {
    fichas: [...soma.entries()].sort((a, b) => b[0] - a[0]).map(([valor, quantidade]) => ({ valor, quantidade })),
    resto: round2(resto),
  };
}

const valoresAtivos = () => state.fichas.filter((f) => f.ativa !== false).map((f) => f.valor);

function calcularFichas(itens) {
  const total = round2(itens.reduce((s, i) => s + i.preco * i.quantidade, 0));
  return ui.modo === "produto" ? fichasPorProduto(itens, valoresAtivos()) : montarFichas(total, valoresAtivos());
}

function fichaCor(valor) {
  const f = state.fichas.find((x) => Math.abs(x.valor - valor) < 0.001);
  return f ? f.cor : "cinza";
}

const fichaChip = (valor, quantidade) => {
  const cor = fichaCor(valor);
  return `<span class="ficha ${cor}">${quantidade !== undefined ? `<small>${quantidade}×</small>` : ""}${money(valor)}<em>${CORES[cor] || ""}</em></span>`;
};

// ---------- Dados de apoio ----------

function semearFichas() {
  if (state.semente || state.fichas.length > 0) return;
  state.semente = true;
  // Ids fixos: se dois aparelhos criarem as fichas iniciais, o banco recebe a mesma linha (sem duplicar).
  FICHAS_INICIAIS.forEach(([valor, cor]) => salvar("fichas", { id: `ficha-${valor * 100}`, valor, cor, ativa: true }, { silencioso: true }));
}

// Não cria mais eventos sozinho: o evento só existe quando você cadastra na aba Evento.
function garantirEvento() {
  if (state.eventoAtivo && state.eventos.some((e) => e.id === state.eventoAtivo)) return;
  const recente = [...state.eventos].sort((a, b) => (a.data < b.data ? 1 : -1))[0];
  state.eventoAtivo = recente ? recente.id : null;
}

const eventoAtivo = () => state.eventos.find((e) => e.id === state.eventoAtivo);
const produtosAtivos = () => state.produtos.filter((p) => p.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
const vendasDoEvento = () => state.vendas.filter((v) => v.evento_id === state.eventoAtivo).sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1));

function cartItens() {
  return Object.entries(cart)
    .filter(([, q]) => q > 0)
    .map(([id, quantidade]) => {
      const p = state.produtos.find((x) => x.id === id);
      return p ? { produto_id: p.id, nome: p.nome, preco: p.preco, quantidade, fichas: fichasDoProduto(p) } : null;
    })
    .filter(Boolean);
}

// ---------- Tela ----------

let toastTimer = null;
function toast(texto) {
  const el = $("#toast");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3500);
}

function renderStatus() {
  const el = $("#sync-badge");
  const pend = state.outbox.length;
  if (!db) {
    el.className = "sync local";
    el.textContent = "Só neste aparelho";
  } else if (!navigator.onLine || ultimoErro) {
    el.className = "sync off";
    el.textContent = pend ? `Sem sinal · ${pend} a enviar` : "Sem sinal";
  } else if (sincronizando || pend) {
    el.className = "sync off";
    el.textContent = `Enviando… ${pend}`;
  } else {
    el.className = "sync ok";
    el.textContent = "Sincronizado";
  }
}

function renderEventos() {
  const select = $("#event-select");
  const eventos = [...state.eventos].sort((a, b) => (a.data < b.data ? 1 : -1));
  select.innerHTML = eventos.map((e) => `<option value="${esc(e.id)}">${esc(e.nome)} · ${formatDate(e.data)}</option>`).join("");
  select.value = state.eventoAtivo;
}

function fillSelects() {
  document.querySelectorAll("[data-fichas]").forEach((box) => {
    const marcadas = [...box.querySelectorAll("input:checked")].map((i) => Number(i.value));
    box.innerHTML = state.fichas
      .filter((f) => f.ativa !== false)
      .sort((a, b) => a.valor - b.valor)
      .map((f) => `<label class="chk"><input type="checkbox" name="ficha" value="${f.valor}" ${marcadas.includes(f.valor) ? "checked" : ""}> Ficha de ${money(f.valor)}</label>`)
      .join("") || '<span class="muted small">Cadastre as fichas na aba Fichas.</span>';
  });
  const cor = $("#ficha-form [name=cor]");
  if (!cor.options.length) cor.innerHTML = Object.entries(CORES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
}

function renderVender() {
  const produtos = produtosAtivos();
  $("#produtos-grid").innerHTML = produtos.length
    ? produtos
        .map((p) => {
          const q = cart[p.id] || 0;
          return `<div class="prod ${q ? "on" : ""}" data-add="${esc(p.id)}">
            <div class="prod-nome">${esc(p.nome)}</div>
            <div class="prod-preco">${money(p.preco)}</div>
            ${fichasDoProduto(p).length ? `<div class="prod-ficha">fichas: ${fichasDoProduto(p).map((v) => money(v)).join(" + ")}</div>` : ""}
            <div class="qtd">
              <button type="button" data-menos="${esc(p.id)}" aria-label="Tirar um">−</button>
              <strong>${q}</strong>
              <button type="button" class="mais" data-mais="${esc(p.id)}" aria-label="Colocar um">+</button>
            </div>
          </div>`;
        })
        .join("")
    : '<p class="muted">Nenhum produto ainda. Use "+ Novo produto rápido" aqui embaixo ou a aba Produtos.</p>';

  const itens = cartItens();
  const total = round2(itens.reduce((s, i) => s + i.preco * i.quantidade, 0));
  const calc = calcularFichas(itens);
  $("#carrinho").innerHTML = `
    <div class="cart-total"><span>Total a cobrar</span><strong>${money(total)}</strong></div>
    <div class="cart-itens">${itens.length ? itens.map((i) => `${i.quantidade}× ${esc(i.nome)}`).join(" · ") : "Toque nos produtos para montar a venda"}</div>
    <div class="cart-fichas">
      <div class="titulo">Fichas a entregar</div>
      ${calc.fichas.length ? calc.fichas.map((f) => fichaChip(f.valor, f.quantidade)).join("") : '<span class="muted">—</span>'}
      ${calc.resto > 0 ? `<div class="resto">Não fecha só com fichas: cobrar ${money(calc.resto)} em dinheiro</div>` : ""}
    </div>
    <div class="cart-linha">
      <select id="cart-modo" aria-label="Como calcular as fichas">
        <option value="total" ${ui.modo === "total" ? "selected" : ""}>Pelo total</option>
        <option value="produto" ${ui.modo === "produto" ? "selected" : ""}>Por produto</option>
      </select>
      <select id="cart-forma" aria-label="Forma de pagamento">
        ${FORMAS.map((f) => `<option ${ui.forma === f ? "selected" : ""}>${f}</option>`).join("")}
      </select>
    </div>
    <div class="cart-acoes">
      <button type="button" class="btn secondary" id="cart-limpar">Limpar</button>
      <button type="button" class="btn" id="cart-registrar">Registrar venda</button>
    </div>`;
}

function resumoItens(itens) {
  return itens.map((i) => `${i.quantidade}× ${esc(i.nome)}`).join(", ");
}

function renderVendas() {
  const vendas = vendasDoEvento();
  const validas = vendas.filter((v) => !v.cancelada);
  const total = round2(validas.reduce((s, v) => s + v.total, 0));
  $("#vendas-resumo").innerHTML = `
    <div class="kpi"><span>Total vendido</span><strong>${money(total)}</strong></div>
    <div class="kpi"><span>Vendas</span><strong>${validas.length}</strong></div>`;
  $("#vendas-lista").innerHTML = vendas.length
    ? vendas
        .map(
          (v) => `<div class="linha ${v.cancelada ? "cancelada" : ""}">
            <div class="info">
              <div class="titulo">${formatTime(v.criado_em)} · ${esc(v.forma_pagamento)}</div>
              <div class="small">${resumoItens(v.itens)}</div>
              <div>${v.fichas.map((f) => fichaChip(f.valor, f.quantidade)).join("")}${v.resto > 0 ? `<span class="small muted">resto ${money(v.resto)}</span>` : ""}</div>
            </div>
            <div class="acoes">
              <span class="preco">${money(v.total)}</span>
              ${v.cancelada ? '<span class="small muted">cancelada</span>' : `<button class="link danger" data-cancelar="${esc(v.id)}" type="button">Cancelar venda</button>`}
            </div>
          </div>`
        )
        .join("")
    : '<p class="muted">Nenhuma venda neste evento ainda.</p>';
}

function renderProdutos() {
  const lista = produtosAtivos();
  $("#produtos-lista").innerHTML = lista.length
    ? lista
        .map(
          (p) => `<div class="linha">
            <div class="info">
              <div class="titulo">${esc(p.nome)}</div>
              <div class="small muted">${esc(p.categoria || "")}</div>
              ${fichasDoProduto(p).map((v) => fichaChip(v)).join("")}
            </div>
            <div class="acoes">
              <span class="preco">${money(p.preco)}</span>
              <button class="link" data-edit-produto="${esc(p.id)}" type="button">Editar</button>
              <button class="link danger" data-del-produto="${esc(p.id)}" type="button">Remover</button>
            </div>
          </div>`
        )
        .join("")
    : '<p class="muted">Nenhum produto cadastrado.</p>';
}

function renderFichas() {
  const lista = state.fichas.filter((f) => f.ativa !== false).sort((a, b) => a.valor - b.valor);
  $("#fichas-lista").innerHTML = lista.length
    ? lista
        .map(
          (f) => `<div class="linha">
            <div class="info">${fichaChip(f.valor)}</div>
            <div class="acoes">
              <button class="link" data-edit-ficha="${esc(f.id)}" type="button">Editar</button>
              <button class="link danger" data-del-ficha="${esc(f.id)}" type="button">Remover</button>
            </div>
          </div>`
        )
        .join("")
    : '<p class="muted">Nenhuma ficha cadastrada.</p>';
}

// Totais do evento: o que vendeu, quantas fichas de cada valor foram entregues e quanto de cada produto.
function totaisDoEvento() {
  const validas = vendasDoEvento().filter((v) => !v.cancelada);
  const porForma = new Map();
  const porProduto = new Map();
  const fichas = new Map();
  let total = 0;
  let resto = 0;
  validas.forEach((v) => {
    total += v.total;
    resto += v.resto || 0;
    porForma.set(v.forma_pagamento, (porForma.get(v.forma_pagamento) || 0) + v.total);
    v.itens.forEach((i) => {
      const atual = porProduto.get(i.nome) || { quantidade: 0, valor: 0 };
      atual.quantidade += i.quantidade;
      atual.valor += i.quantidade * i.preco;
      porProduto.set(i.nome, atual);
    });
    v.fichas.forEach((f) => fichas.set(f.valor, (fichas.get(f.valor) || 0) + f.quantidade));
  });
  return { validas, total: round2(total), resto: round2(resto), porForma, porProduto, fichas };
}

function renderFechamento() {
  const evento = eventoAtivo();
  const t = totaisDoEvento();
  const totalFichas = [...t.fichas.entries()].reduce((s, [v, q]) => s + v * q, 0);
  $("#fechamento").innerHTML = `
    <div class="card">
      <h2>Fechamento: ${esc(evento ? evento.nome : "")}</h2>
      <div class="chips-row">
        <div class="kpi"><span>Total vendido</span><strong>${money(t.total)}</strong></div>
        <div class="kpi"><span>Vendas</span><strong>${t.validas.length}</strong></div>
        <div class="kpi"><span>Ticket médio</span><strong>${money(t.validas.length ? t.total / t.validas.length : 0)}</strong></div>
        <div class="kpi"><span>Em fichas</span><strong>${money(totalFichas)}</strong></div>
      </div>
      <h2>Fichas entregues</h2>
      <div>${t.fichas.size ? [...t.fichas.entries()].sort((a, b) => b[0] - a[0]).map(([v, q]) => fichaChip(v, q)).join("") : '<span class="muted">Nenhuma ficha entregue.</span>'}</div>
      ${t.resto > 0 ? `<p class="small muted">Cobrado em dinheiro por não fechar com fichas: ${money(t.resto)}</p>` : ""}
      <h2>Por produto</h2>
      ${
        t.porProduto.size
          ? `<table><thead><tr><th>Produto</th><th class="num">Qtd</th><th class="num">Total</th></tr></thead><tbody>${[...t.porProduto.entries()]
              .sort((a, b) => b[1].valor - a[1].valor)
              .map(([nome, x]) => `<tr><td>${esc(nome)}</td><td class="num">${x.quantidade}</td><td class="num">${money(x.valor)}</td></tr>`)
              .join("")}</tbody></table>`
          : '<p class="muted">Sem vendas.</p>'
      }
      <h2>Por forma de pagamento</h2>
      ${
        t.porForma.size
          ? `<table><tbody>${[...t.porForma.entries()].map(([forma, valor]) => `<tr><td>${esc(forma)}</td><td class="num">${money(valor)}</td></tr>`).join("")}</tbody></table>`
          : '<p class="muted">Sem vendas.</p>'
      }
      <button type="button" class="btn secondary" id="baixar-csv">Baixar vendas em planilha (CSV)</button>
    </div>`;
}

function csvCell(value) {
  const s = String(value ?? "");
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function baixarCsv() {
  const evento = eventoAtivo();
  const linhas = [["Data e hora", "Evento", "Itens", "Total", "Pagamento", "Fichas", "Resto em dinheiro", "Situação"]];
  vendasDoEvento()
    .slice()
    .reverse()
    .forEach((v) =>
      linhas.push([
        new Date(v.criado_em).toLocaleString("pt-BR"),
        evento ? evento.nome : "",
        v.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(" + "),
        String(v.total).replace(".", ","),
        v.forma_pagamento,
        v.fichas.map((f) => `${f.quantidade}x ${CORES[fichaCor(f.valor)] || ""} R$ ${String(f.valor).replace(".", ",")}`).join(" + "),
        String(v.resto || 0).replace(".", ","),
        v.cancelada ? "Cancelada" : "Válida",
      ])
    );
  const blob = new Blob([`﻿${linhas.map((l) => l.map(csvCell).join(";")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vendas-${(evento ? evento.nome : "evento").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderTabs() {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.dataset.screen === ui.tab));
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === ui.tab));
}

function render() {
  renderStatus();
  renderEventos();
  fillSelects();
  renderTabs();
  renderVender();
  renderVendas();
  renderProdutos();
  renderFichas();
  renderFechamento();
}

// ---------- Ações ----------

// Confirmação sem janelinha: o 1º toque pede confirmação no próprio botão, o 2º toque executa.
let armado = null;
function confirmarToque(botao, textoAviso, executar) {
  if (armado && armado.botao === botao) {
    clearTimeout(armado.timer);
    armado = null;
    executar();
    return;
  }
  if (armado) {
    clearTimeout(armado.timer);
    armado.botao.textContent = armado.original;
    armado.botao.classList.remove("perigo");
  }
  const original = botao.textContent;
  botao.textContent = textoAviso;
  botao.classList.add("perigo");
  armado = {
    botao,
    original,
    timer: setTimeout(() => {
      botao.textContent = original;
      botao.classList.remove("perigo");
      armado = null;
    }, 4000),
  };
}

function registrarVenda() {
  if (!state.eventoAtivo) {
    toast("Crie um evento na aba Evento antes de vender");
    return;
  }
  const itens = cartItens();
  if (itens.length === 0) {
    toast("Escolha pelo menos um produto");
    return;
  }
  const calc = calcularFichas(itens);
  const total = round2(itens.reduce((s, i) => s + i.preco * i.quantidade, 0));
  salvar("vendas", {
    id: uid(),
    evento_id: state.eventoAtivo,
    criado_em: new Date().toISOString(),
    total,
    forma_pagamento: ui.forma,
    itens: itens.map(({ produto_id, nome, preco, quantidade }) => ({ produto_id, nome, preco, quantidade })),
    fichas: calc.fichas,
    resto: calc.resto,
    cancelada: false,
  });
  cart = {};
  render();
  toast(db && (!navigator.onLine || ultimoErro) ? `Venda de ${money(total)} salva. Será enviada quando voltar o sinal.` : `Venda de ${money(total)} registrada`);
}

function salvarProduto(form, { rapido = false } = {}) {
  const nome = form.elements.nome.value.trim();
  const preco = parseMoney(form.elements.preco.value);
  const mensagem = $(rapido ? "#quick-message" : "#produto-message");
  if (!nome || !(preco >= 0)) {
    mensagem.textContent = "Informe o nome e o preço (ex.: 6,00).";
    return false;
  }
  const fichas = [...form.querySelectorAll("input[name=ficha]:checked")].map((i) => Number(i.value));
  const id = !rapido && form.elements.id.value ? form.elements.id.value : uid();
  const categoria = !rapido && form.elements.categoria ? form.elements.categoria.value.trim() || null : null;
  const existente = state.produtos.find((p) => p.id === id);
  salvar("produtos", { id, nome, preco: round2(preco), categoria: categoria ?? (existente ? existente.categoria : null), fichas_valores: fichas, ficha_valor: fichas[0] ?? null, ativo: true });
  mensagem.textContent = "Produto salvo.";
  return true;
}

function resetProdutoForm() {
  const form = $("#produto-form");
  form.reset();
  form.querySelectorAll("input[name=ficha]").forEach((i) => (i.checked = false));
  form.elements.id.value = "";
  $("#produto-titulo").textContent = "Novo produto";
  $("#produto-cancelar").hidden = true;
}

function resetFichaForm() {
  const form = $("#ficha-form");
  form.reset();
  form.elements.id.value = "";
  $("#ficha-titulo").textContent = "Nova ficha";
  $("#ficha-cancelar").hidden = true;
}

function ligarEventos() {
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      ui.tab = b.dataset.tab;
      render();
      window.scrollTo({ top: 0 });
    })
  );

  $("#event-select").addEventListener("change", (e) => {
    state.eventoAtivo = e.target.value;
    save();
    render();
  });

  // Tela de venda
  $("#produtos-grid").addEventListener("click", (e) => {
    const menos = e.target.closest("[data-menos]");
    const mais = e.target.closest("[data-mais]");
    const card = e.target.closest("[data-add]");
    if (menos) {
      const id = menos.dataset.menos;
      cart[id] = Math.max(0, (cart[id] || 0) - 1);
    } else if (mais) {
      cart[mais.dataset.mais] = (cart[mais.dataset.mais] || 0) + 1;
    } else if (card) {
      cart[card.dataset.add] = (cart[card.dataset.add] || 0) + 1;
    } else {
      return;
    }
    renderVender();
  });

  $("#carrinho").addEventListener("change", (e) => {
    if (e.target.id === "cart-modo") ui.modo = e.target.value;
    if (e.target.id === "cart-forma") ui.forma = e.target.value;
    renderVender();
  });
  $("#carrinho").addEventListener("click", (e) => {
    if (e.target.id === "cart-limpar") {
      cart = {};
      renderVender();
    }
    if (e.target.id === "cart-registrar") registrarVenda();
  });

  $("#quick-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (salvarProduto(e.target, { rapido: true })) e.target.reset();
  });

  // Vendas do evento
  $("#vendas-lista").addEventListener("click", (e) => {
    const id = e.target.dataset.cancelar;
    if (!id) return;
    const v = state.vendas.find((x) => x.id === id);
    if (!v) return;
    confirmarToque(e.target, "Toque para confirmar", () => {
      salvar("vendas", { ...v, cancelada: true });
      toast("Venda cancelada");
    });
  });

  // Produtos
  $("#produto-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (salvarProduto(e.target)) resetProdutoForm();
  });
  $("#produto-cancelar").addEventListener("click", resetProdutoForm);
  $("#produtos-lista").addEventListener("click", (e) => {
    const edit = e.target.dataset.editProduto;
    const del = e.target.dataset.delProduto;
    if (edit) {
      const p = state.produtos.find((x) => x.id === edit);
      const f = $("#produto-form");
      f.elements.id.value = p.id;
      f.elements.nome.value = p.nome;
      f.elements.preco.value = String(p.preco).replace(".", ",");
      f.elements.categoria.value = p.categoria || "";
      f.querySelectorAll("input[name=ficha]").forEach((i) => (i.checked = fichasDoProduto(p).includes(Number(i.value))));
      $("#produto-titulo").textContent = "Editar produto";
      $("#produto-cancelar").hidden = false;
      f.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (del) {
      const p = state.produtos.find((x) => x.id === del);
      if (p)
        confirmarToque(e.target, "Toque para confirmar", () => {
          salvar("produtos", { ...p, ativo: false });
          delete cart[p.id];
          render();
          toast(`"${p.nome}" removido`);
        });
    }
  });

  // Fichas
  $("#ficha-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const valor = parseMoney(f.elements.valor.value);
    const mensagem = $("#ficha-message");
    if (!(valor > 0)) {
      mensagem.textContent = "Informe o valor da ficha (ex.: 12,00).";
      return;
    }
    const id = f.elements.id.value || `ficha-${Math.round(valor * 100)}`;
    const repetida = state.fichas.find((x) => x.ativa !== false && Math.abs(x.valor - valor) < 0.001 && x.id !== id);
    if (repetida) {
      mensagem.textContent = "Já existe uma ficha com esse valor.";
      return;
    }
    salvar("fichas", { id, valor: round2(valor), cor: f.elements.cor.value, ativa: true });
    mensagem.textContent = "Ficha salva.";
    resetFichaForm();
  });
  $("#ficha-cancelar").addEventListener("click", resetFichaForm);
  $("#fichas-lista").addEventListener("click", (e) => {
    const edit = e.target.dataset.editFicha;
    const del = e.target.dataset.delFicha;
    if (edit) {
      const x = state.fichas.find((y) => y.id === edit);
      const f = $("#ficha-form");
      f.elements.id.value = x.id;
      f.elements.valor.value = String(x.valor).replace(".", ",");
      f.elements.cor.value = x.cor;
      $("#ficha-titulo").textContent = "Editar ficha";
      $("#ficha-cancelar").hidden = false;
      f.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (del) {
      const x = state.fichas.find((y) => y.id === del);
      if (x)
        confirmarToque(e.target, "Toque para confirmar", () => {
          salvar("fichas", { ...x, ativa: false });
          toast("Ficha removida");
        });
    }
  });

  // Eventos
  $("#evento-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = f.elements.data.value;
    if (!data) {
      $("#evento-message").textContent = "Informe a data.";
      return;
    }
    const nome = f.elements.nome.value.trim() || `Evento ${formatDate(data)}`;
    const id = uid();
    salvar("eventos", { id, nome, data, aberto: true });
    state.eventoAtivo = id;
    save();
    f.reset();
    f.elements.data.value = todayISO();
    $("#evento-message").textContent = "Evento criado.";
    render();
  });
  $("#fechamento").addEventListener("click", (e) => {
    if (e.target.id === "baixar-csv") baixarCsv();
  });

  window.addEventListener("online", sync);
  window.addEventListener("offline", renderStatus);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) sync();
  });
}

function iniciar() {
  semearFichas();
  garantirEvento();
  save();
  ligarEventos();
  $("#evento-form").elements.data.value = todayISO();
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  sync();
  // Atualiza a cada 60 s, só quando a página está aberta na tela (economiza internet e deixa o app mais leve).
  setInterval(() => { if (document.visibilityState === "visible") sync(); }, 60000);
}

iniciar();
