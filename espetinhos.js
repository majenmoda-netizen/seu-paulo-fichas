"use strict";

// Espetinhos do Seu Paulo: cardápio, pedidos, comandas e recibos.
// Usa a conexão `db` (Supabase) criada em app.js. Estes dados são online: sem internet, a tela avisa.

const ES = { produtos: [], bairros: [], clientes: [], pedidos: [], filtroPedidos: "hoje", filtroTipo: "todos", acao: null, acaoProduto: null };
const ESP = { itens: {}, tipo: "mesa", clienteId: null, forma: "Dinheiro" }; // pedido em montagem

const esFmt = (n) => money(Number(n) || 0);
const esNum = (v) => { const n = parseMoney(v); return Number.isFinite(n) ? n : NaN; };
const esMsg = (sel, texto) => { const el = $(sel); if (el) el.textContent = texto; };

async function esOnline() {
  if (!db) { esMsg("#es-aviso", "Sem conexão com o banco. Confira o config.js."); return false; }
  return true;
}

// ---------- Leitura ----------
async function esCarregar() {
  if (!(await esOnline())) return;
  const [prod, bai, cli, ped] = await Promise.all([
    db.from("sp_produtos").select("*").eq("ativo", true).order("nome"),
    db.from("sp_bairros").select("*").order("nome"),
    db.from("sp_clientes").select("*").order("nome"),
    db.from("sp_pedidos").select("*").order("criado_em", { ascending: false }).limit(300),
  ]);
  const erro = [prod, bai, cli, ped].find((r) => r.error);
  if (erro) { esMsg("#es-aviso", "Erro ao ler o banco: " + erro.error.message); return; }
  ES.produtos = prod.data;
  ES.bairros = bai.data; ES.clientes = cli.data; ES.pedidos = ped.data;
  esRenderTudo();
}

// ---------- Cardápio ----------
const temEstoque = (p) => p.estoque !== null && p.estoque !== undefined;
const fmtQtd = (n) => String(Number(n)).replace(".", ",");

function esRenderCardapio() {
  const controlados = ES.produtos.filter(temEstoque);
  const zerados = controlados.filter((p) => Number(p.estoque) <= 0);
  const baixos = controlados.filter((p) => Number(p.estoque) > 0 && Number(p.estoque_minimo) > 0 && Number(p.estoque) <= Number(p.estoque_minimo));
  $("#estoque-resumo").innerHTML = `<div class="kpi"><span class="muted small">Produtos</span><b>${ES.produtos.length}</b></div>
    <div class="kpi"><span class="muted small">Com estoque controlado</span><b>${controlados.length}</b></div>
    <div class="kpi"><span class="muted small">Acabando</span><b>${baixos.length}</b></div>
    <div class="kpi"><span class="muted small">Esgotados</span><b>${zerados.length}</b></div>`;
  const cats = [...new Set(ES.produtos.map((p) => p.categoria || "Sem categoria"))];
  $("#cardapio-lista").innerHTML = ES.produtos.length ? cats.map((cat) => {
    const itens = ES.produtos.filter((p) => (p.categoria || "Sem categoria") === cat);
    return `<h3 class="cat">${esc(cat)}</h3>` + itens.map((p) => {
      const id = esc(p.id);
      const esgotado = temEstoque(p) && Number(p.estoque) <= 0;
      const acabando = temEstoque(p) && !esgotado && Number(p.estoque_minimo) > 0 && Number(p.estoque) <= Number(p.estoque_minimo);
      const aviso = esgotado ? ' · <b style="color:#c0392b">ESGOTADO</b>' : acabando ? ' · <b style="color:#c0392b">acabando</b>' : "";
      const confirmar = ES.acaoProduto === p.id
        ? `<span class="small muted">Excluir?</span> <button class="btn" data-remover-ok="${id}" type="button">Sim</button><button class="link" data-remover-nao="1" type="button">Não</button>`
        : `<button class="link" data-editar-produto="${id}" type="button">Editar</button><button class="link danger" data-remover-produto="${id}" type="button">Excluir</button>`;
      return `<div class="linha cardapio-item">
        <div class="info"><div class="titulo">${esc(p.nome)}</div>
          <div class="small muted">${esFmt(p.preco)}${temEstoque(p) ? ` · estoque ${fmtQtd(p.estoque)}` : " · sem controle de estoque"}${aviso}</div></div>
        <div class="acoes">
          <label class="mini">Estoque<input type="text" inputmode="decimal" value="${temEstoque(p) ? fmtQtd(p.estoque) : ""}" placeholder="—" data-estoque="${id}"></label>
          ${confirmar}
        </div></div>`;
    }).join("");
  }).join("") : '<p class="muted">Nenhum produto. Cadastre o primeiro acima.</p>';
}

async function esSalvarEstoque(produtoId, texto) {
  const t = String(texto).trim();
  const valor = t === "" ? null : esNum(t);
  if (valor !== null && !Number.isFinite(valor)) return esMsg("#cardapio-msg", "Estoque inválido.");
  const { error } = await db.from("sp_produtos").update({ estoque: valor, atualizado_em: new Date().toISOString() }).eq("id", produtoId);
  if (error) return esMsg("#cardapio-msg", "Erro ao salvar o estoque (rodou o SQL 04?): " + error.message);
  await esCarregar();
}

function esEditarProduto(id) {
  const p = ES.produtos.find((x) => x.id === id);
  if (!p) return;
  const f = $("#cardapio-form");
  f.elements.id.value = p.id;
  f.elements.nome.value = p.nome;
  f.elements.categoria.value = p.categoria || "";
  f.elements.preco.value = Number(p.preco).toFixed(2).replace(".", ",");
  f.elements.estoque.value = temEstoque(p) ? fmtQtd(p.estoque) : "";
  f.elements.minimo.value = Number(p.estoque_minimo) ? fmtQtd(p.estoque_minimo) : "";
  $("#cardapio-titulo").textContent = "Editar produto";
  $("#cardapio-salvar").textContent = "Salvar alterações";
  $("#cardapio-cancelar").hidden = false;
  f.scrollIntoView({ behavior: "smooth", block: "start" });
}

function esCancelarEdicaoProduto() {
  const f = $("#cardapio-form");
  f.reset();
  f.elements.id.value = "";
  $("#cardapio-titulo").textContent = "Novo produto";
  $("#cardapio-salvar").textContent = "Cadastrar produto";
  $("#cardapio-cancelar").hidden = true;
}

async function esNovoProduto(form) {
  const nome = form.nome.value.trim();
  const preco = esNum(form.preco.value);
  if (!nome || !(preco >= 0)) return esMsg("#cardapio-msg", "Informe o nome e o preço.");
  const txtEstoque = form.estoque.value.trim();
  const estoque = txtEstoque === "" ? null : esNum(txtEstoque);
  if (estoque !== null && !Number.isFinite(estoque)) return esMsg("#cardapio-msg", "Estoque inválido.");
  const dados = {
    nome, preco: round2(preco), categoria: form.categoria.value.trim() || null,
    estoque, estoque_minimo: esNum(form.minimo.value) || 0, atualizado_em: new Date().toISOString(),
  };
  const editando = form.elements.id.value;
  const { error } = editando
    ? await db.from("sp_produtos").update(dados).eq("id", editando)
    : await db.from("sp_produtos").insert({ id: uid(), ativo: true, tipo: "produto", custo: 0, ...dados });
  if (error) return esMsg("#cardapio-msg", "Erro (rodou o SQL 04?): " + error.message);
  esCancelarEdicaoProduto();
  esMsg("#cardapio-msg", editando ? "Produto atualizado." : "Produto cadastrado.");
  await esCarregar();
}

// Excluir produto: some da lista, mas os pedidos antigos continuam com o nome e o preço da época.
async function esRemoverProduto(id) {
  if (!ES.produtos.some((x) => x.id === id)) return;
  await db.from("sp_produtos").update({ ativo: false, atualizado_em: new Date().toISOString() }).eq("id", id);
  ES.acaoProduto = null;
  await esCarregar();
}

// Baixa e devolução de estoque dos pedidos (só nos produtos que controlam estoque).
async function esAjustarEstoque(pedido, sinal) {
  for (const it of pedido.itens || []) {
    const { data: prod } = await db.from("sp_produtos").select("estoque").eq("id", it.produto_id).single();
    if (!prod || prod.estoque === null || prod.estoque === undefined) continue;
    await db.from("sp_produtos").update({ estoque: Number(prod.estoque) + sinal * Number(it.qtd), atualizado_em: new Date().toISOString() }).eq("id", it.produto_id);
  }
}

// ---------- Pedidos ----------
const esTotalPedido = () => Object.values(ESP.itens).reduce((s, it) => s + it.qtd * it.preco, 0);
const esTaxa = () => {
  if (ESP.tipo !== "entrega") return 0;
  const n = esNum($("#pedido-form").elements.taxa.value);
  return n > 0 ? n : 0;
};

function esRenderPedido() {
  // Lista de produtos para escolher
  $("#pedido-produtos").innerHTML = ES.produtos.map((p) => {
    const qtd = ESP.itens[p.id] ? ESP.itens[p.id].qtd : 0;
    return `<button type="button" class="prod ${qtd ? "sel" : ""}" data-add="${esc(p.id)}">
      <span>${esc(p.nome)}</span><span class="small">${esFmt(p.preco)}</span>${temEstoque(p) ? `<span class="small" style="color:${Number(p.estoque) <= 0 ? "#c0392b" : "#777"}">${Number(p.estoque) <= 0 ? "Esgotado" : "Restam " + fmtQtd(p.estoque)}</span>` : ""}${qtd ? `<b class="badge-qtd">${qtd}</b><span data-sub="${esc(p.id)}" style="display:inline-block;margin-top:6px;padding:4px 12px;border:1px solid #c0392b;border-radius:999px;color:#c0392b;font-size:13px;font-weight:700;background:#fff">− Tirar 1</span>` : ""}</button>`;
  }).join("");
  // Carrinho
  const linhas = Object.entries(ESP.itens).map(([id, it]) => `<div class="linha">
      <div class="info">${it.qtd}x ${esc(it.nome)}</div>
      <div class="acoes"><span>${esFmt(it.qtd * it.preco)}</span><button class="link danger" data-rem="${esc(id)}" type="button">−1</button></div></div>`).join("");
  const taxa = esTaxa();
  $("#pedido-carrinho").innerHTML = (linhas || '<p class="muted">Toque nos produtos para adicionar.</p>') +
    (taxa ? `<div class="linha"><div class="info">Taxa de entrega</div><div class="acoes"><span>${esFmt(taxa)}</span></div></div>` : "") +
    `<div class="total"><span>Total</span><b>${esFmt(esTotalPedido() + taxa)}</b></div>`;
  // Tipo do pedido
  document.querySelectorAll("[data-tipo]").forEach((b) => b.classList.toggle("active", b.dataset.tipo === ESP.tipo));
  $("#campo-mesa").hidden = ESP.tipo !== "mesa";
  $("#campo-entrega").hidden = ESP.tipo !== "entrega";
  $("#campo-balcao").hidden = ESP.tipo !== "balcao";
  // Clientes para entrega
  // Guarda a escolha atual antes de redesenhar a lista (senão o bairro volta para "Escolha o bairro").
  const clienteAtual = $("#pedido-cliente").value;
  const bairroAtual = $("#pedido-bairro").value;
  $("#pedido-cliente").innerHTML = '<option value="">Novo cliente</option>' + ES.clientes.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}${c.bairro ? " · " + esc(c.bairro) : ""}</option>`).join("");
  $("#pedido-cliente").value = clienteAtual;
  $("#pedido-bairro").innerHTML = '<option value="">Sem bairro / outro</option>' + ES.bairros.map((b) => `<option value="${esc(b.nome)}">${esc(b.nome)} (${esFmt(b.taxa)})</option>`).join("");
  $("#pedido-bairro").value = bairroAtual;
}

async function esEnviarPedido() {
  if (!Object.keys(ESP.itens).length) return esMsg("#pedido-msg", "Adicione pelo menos um produto.");
  const f = $("#pedido-form");
  let cliente = null, bairro = null, endereco = null;
  if (ESP.tipo === "entrega") {
    if (ESP.clienteId) cliente = ES.clientes.find((c) => c.id === ESP.clienteId);
    else {
      const nome = f.elements.clienteNome.value.trim();
      if (!nome) return esMsg("#pedido-msg", "Informe o nome do cliente.");
      // Não cadastra o mesmo telefone duas vezes: confere no banco antes de finalizar.
      const soDigitos = (t) => String(t || "").replace(/\D/g, "");
      const tel = soDigitos(f.elements.telefone.value);
      if (tel) {
        const { data: existentes, error: erroBusca } = await db.from("sp_clientes").select("id,nome,telefone");
        if (erroBusca) return esMsg("#pedido-msg", "Não consegui conferir o telefone: " + erroBusca.message);
        const dup = existentes.find((c) => soDigitos(c.telefone) === tel);
        if (dup) return esMsg("#pedido-msg", `Este telefone já está cadastrado para ${dup.nome}. Escolha esse cliente na lista "Cliente".`);
      }
      cliente = { id: uid(), nome, telefone: f.elements.telefone.value.trim() || null, endereco: f.elements.endereco.value.trim() || null, bairro: $("#pedido-bairro").value || null };
      const { error: erroCliente } = await db.from("sp_clientes").insert(cliente);
      if (erroCliente) return esMsg("#pedido-msg", "Erro ao cadastrar o cliente: " + erroCliente.message);
    }
    bairro = $("#pedido-bairro").value || (cliente && cliente.bairro) || null;
    endereco = cliente && cliente.endereco;
  }
  const taxa = esTaxa();
  const subtotal = round2(esTotalPedido());
  const itens = Object.entries(ESP.itens).map(([id, it]) => ({ produto_id: id, nome: it.nome, qtd: it.qtd, preco: it.preco, custo: 0 }));
  const pedido = {
    id: uid(), tipo: ESP.tipo, mesa: ESP.tipo === "mesa" ? f.elements.mesa.value.trim() || null : null,
    cliente_id: cliente ? cliente.id : null, cliente_nome: ESP.tipo === "balcao" ? (f.elements.pessoaX.value.trim() || "Retirada") : (cliente ? cliente.nome : null),
    endereco, bairro, taxa_entrega: round2(taxa), itens, subtotal, total: round2(subtotal + taxa), status: "aberto",
    observacao: f.elements.obs.value.trim() || null,
  };
  const { error } = await db.from("sp_pedidos").insert(pedido);
  if (error) return esMsg("#pedido-msg", "Erro: " + error.message);
  await esAjustarEstoque(pedido, -1);
  await esImprimir(pedido);
  ESP.itens = {}; ESP.clienteId = null; f.reset();
  esMsg("#pedido-msg", "Pedido enviado para a cozinha e o caixa.");
  await esCarregar();
}

// ---------- Comanda (texto de 42 colunas, sem acento: a impressora de rede não usa acento) ----------
const LARG = 42;
const linha2 = (esq, dir) => { const e = String(esq); const d = String(dir); return e + " ".repeat(Math.max(1, LARG - e.length - d.length)) + d; };
const traco = "-".repeat(LARG);
const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const brNum = (n) => Number(n).toFixed(2).replace(".", ",");

function comandaTexto(p, via) {
  const data = new Date(p.criado_em || Date.now());
  const hora = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const cab = [
    "ESPETINHOS DO SEU PAULO",
    traco,
    linha2(`PEDIDO ${p.id.slice(0, 6).toUpperCase()}`, hora),
    p.tipo === "mesa" ? `MESA ${p.mesa || "-"}` : p.tipo === "entrega" ? "ENTREGA" : `RETIRADA: ${p.cliente_nome || ""}`,
  ];
  if (p.tipo === "entrega") {
    cab.push(`Cliente: ${p.cliente_nome || ""}`);
    if (p.endereco) cab.push(`End.: ${p.endereco}`);
    if (p.bairro) cab.push(`Bairro: ${p.bairro}`);
  }
  cab.push(traco);
  const corpo = (p.itens || []).map((i) => {
    const txt = `${i.qtd}x ${i.nome}`;
    return via === "cozinha" ? txt : linha2(txt, brNum(i.qtd * i.preco));
  });
  const rodape = via === "caixa"
    ? [traco, p.taxa_entrega ? linha2("Taxa de entrega", brNum(p.taxa_entrega)) : "", linha2("TOTAL", brNum(p.total)), p.observacao ? `Obs.: ${p.observacao}` : ""]
    : [p.observacao ? `OBS.: ${p.observacao}` : ""];
  return [...cab, ...corpo, ...rodape, "", `=== VIA ${via.toUpperCase()} ===`].map(semAcento).join("\n");
}

async function esImprimir(p) {
  const jobs = ["cozinha", "caixa"].map((via) => ({ id: uid(), pedido_id: p.id, via, conteudo: comandaTexto({ ...p, criado_em: new Date().toISOString() }, via), status: "pendente" }));
  const { error } = await db.from("sp_impressao_fila").insert(jobs);
  if (error) esMsg("#pedido-msg", "Pedido salvo, mas a impressão não foi enfileirada: " + error.message);
}

async function esMudarStatus(pedidoId, status, forma) {
  const p = ES.pedidos.find((x) => x.id === pedidoId);
  if (!p) return;
  const era = p.status;
  const upd = { status, atualizado_em: new Date().toISOString() };
  if (status === "pago") { upd.forma_pagamento = forma || "Dinheiro"; upd.fechado_em = new Date().toISOString(); }
  const { error } = await db.from("sp_pedidos").update(upd).eq("id", pedidoId);
  if (error) return alert("Erro: " + error.message);
  if (era === "aberto" && status === "cancelado") await esAjustarEstoque(p, +1);
  ES.acao = null;
  await esCarregar();
}

// Receber e Cancelar pedem a escolha na própria tela (o navegador pode bloquear caixas de diálogo).
function esAcoesPedido(p) {
  if (p.status !== "aberto") return "";
  const a = ES.acao && ES.acao.id === p.id ? ES.acao.tipo : null;
  const id = esc(p.id);
  if (a === "receber") return `<span class="small muted">Forma de pagamento:</span>
    ${["Dinheiro", "Pix"].map((f) => `<button class="btn" data-pagar="${id}" data-forma="${f}" type="button">${f}</button>`).join("")}
    <button class="btn" data-cartao="${id}" type="button">Cartão</button>
    <button class="link" data-voltar="1" type="button">Voltar</button>`;
  if (a === "cartao") return `<span class="small muted">Cartão:</span>
    ${["Débito", "Crédito"].map((f) => `<button class="btn" data-pagar="${id}" data-forma="Cartão ${f}" type="button">${f}</button>`).join("")}
    <button class="link" data-voltar="1" type="button">Voltar</button>`;
  if (a === "cancelar") return `<span class="small muted">Cancelar este pedido?</span>
    <button class="btn" data-cancelar-ok="${id}" type="button">Sim, cancelar</button><button class="link" data-voltar="1" type="button">Voltar</button>`;
  return `<button class="btn" data-pago="${id}" type="button">Receber</button>
    ${p.tipo === "entrega" ? `<button class="link" data-entregue="${id}" type="button">Entregue</button>` : ""}
    <button class="link danger" data-cancelar="${id}" type="button">Cancelar</button>`;
}

const dataLocal = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

function esRenderPedidos() {
  const hoje = dataLocal(new Date());
  const doPeriodo = ES.pedidos.filter((p) => ES.filtroPedidos === "todos" || dataLocal(p.criado_em) === hoje);
  const validos = doPeriodo.filter((p) => p.status !== "cancelado");
  const soma = (l) => l.reduce((t, p) => t + Number(p.total), 0);
  const porTipo = (t) => validos.filter((p) => p.tipo === t);
  const totalPago = soma(validos.filter((p) => p.status === "pago"));
  const taxas = validos.reduce((t, p) => t + Number(p.taxa_entrega || 0), 0);
  $("#pedidos-resumo").innerHTML = `<div class="kpi"><span class="muted small">Pedidos</span><b>${validos.length}</b></div>
    <div class="kpi"><span class="muted small">Vendido</span><b>${esFmt(soma(validos))}</b></div>
    <div class="kpi"><span class="muted small">Recebido</span><b>${esFmt(totalPago)}</b></div>
    <div class="kpi"><span class="muted small">Mesas (${porTipo("mesa").length})</span><b>${esFmt(soma(porTipo("mesa")))}</b></div>
    <div class="kpi"><span class="muted small">Entregas (${porTipo("entrega").length})</span><b>${esFmt(soma(porTipo("entrega")))}</b></div>
    <div class="kpi"><span class="muted small">Retiradas (${porTipo("balcao").length})</span><b>${esFmt(soma(porTipo("balcao")))}</b></div>
    <div class="kpi"><span class="muted small">Taxas de entrega</span><b>${esFmt(taxas)}</b></div>`;
  document.querySelectorAll("[data-filtro-tipo]").forEach((b) => b.classList.toggle("active", b.dataset.filtroTipo === ES.filtroTipo));
  document.querySelectorAll("[data-filtro-ped]").forEach((b) => b.classList.toggle("active", b.dataset.filtroPed === ES.filtroPedidos));
  const lista = doPeriodo.filter((p) => ES.filtroTipo === "todos" || p.tipo === ES.filtroTipo);
  $("#pedidos-lista").innerHTML = lista.length ? lista.map((p) => {
    const rotulo = p.tipo === "mesa" ? `Mesa ${p.mesa || "-"}` : p.tipo === "entrega" ? `Entrega · ${p.cliente_nome || ""}` : `Retirada · ${p.cliente_nome || ""}`;
    const frete = p.tipo === "entrega" && Number(p.taxa_entrega) ? ` · taxa ${esFmt(p.taxa_entrega)}` : "";
    return `<div class="linha pedido ${p.status}">
      <div class="info"><div class="titulo">${esc(rotulo)}</div>
        <div class="small muted">${esc((p.itens || []).map((i) => i.qtd + "x " + i.nome).join(", "))}</div>
        <div class="small muted">${new Date(p.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${esc(p.status)}${esc(frete)}${p.forma_pagamento ? " · " + esc(p.forma_pagamento) : ""}</div></div>
      <div class="acoes"><span class="preco">${esFmt(p.total)}</span>
        ${esAcoesPedido(p)}
        <button class="link" data-imprimir-recibo="${esc(p.id)}" type="button">Imprimir recibo</button>
        <button class="link" data-baixar-pdf="${esc(p.id)}" type="button">Baixar PDF</button></div></div>`;
  }).join("") : '<p class="muted">Nenhum pedido nesta visão.</p>';
}

// ---------- Impressão do recibo: bobina de 80 mm, preto e branco, centralizado ----------
// Classes com prefixo "rc-" para não se misturar com o CSS do app.
const RC_CSS = `
  #print-area { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; font-size: 12px; width: 72mm; padding: 3mm 0; margin: 0 auto; }
  #print-area .rc-c { text-align: center; }
  #print-area .rc-b { font-weight: 700; }
  #print-area .rc-tit { text-align: center; font-size: 15px; font-weight: 900; }
  #print-area .rc-sep { border-top: 1px dashed #000; margin: 5px 0; height: 0; }
  #print-area .rc-row { display: flex; justify-content: space-between; gap: 6px; }
  #print-area table.rc-tab { width: 100%; border-collapse: collapse; }
  #print-area table.rc-tab td { padding: 2px 0; vertical-align: top; }
  #print-area td.rc-r { text-align: right; white-space: nowrap; }
  #print-area .rc-tot { display: flex; justify-content: space-between; font-size: 15px; font-weight: 900; border-top: 2px solid #000; margin-top: 4px; padding-top: 4px; }
  #print-area .rc-obs { font-style: italic; margin-top: 4px; text-align: center; }
  @media print {
    body * { visibility: hidden !important; }
    #print-area, #print-area * { visibility: visible !important; }
    #print-area { display: block !important; position: absolute; top: 0; left: 0; right: 0; margin: 0 auto; width: 72mm; }
  }
`;

function esDocumentoRecibo(p) {
  const rotulo = p.tipo === "mesa" ? `MESA ${p.mesa || "-"}` : p.tipo === "entrega" ? "ENTREGA" : `RETIRADA: ${p.cliente_nome || ""}`;
  const data = new Date(p.criado_em || Date.now());
  const itens = (p.itens || []).map((i) => `<tr><td>${i.qtd}x ${esc(i.nome)}</td><td class="rc-r">${esFmt(i.qtd * i.preco)}</td></tr>`).join("");
  const entrega = p.tipo === "entrega" ? `<div class="rc-c">${esc(p.cliente_nome || "")}</div>${p.endereco ? `<div class="rc-c">${esc(p.endereco)}</div>` : ""}${p.bairro ? `<div class="rc-c">${esc(p.bairro)}</div>` : ""}` : "";
  return `
    <div class="rc-tit">ESPETINHOS DO SEU PAULO</div>
    <div class="rc-c">RECIBO DE PEDIDO</div>
    <div class="rc-sep"></div>
    <div class="rc-row"><span>Pedido ${esc(p.id.slice(0, 6).toUpperCase())}</span><span>${data.toLocaleDateString("pt-BR")} ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></div>
    <div class="rc-c rc-b">${esc(rotulo)}</div>
    ${entrega}
    <div class="rc-sep"></div>
    <table class="rc-tab">${itens}</table>
    <div class="rc-sep"></div>
    ${p.taxa_entrega ? `<div class="rc-row"><span>Taxa de entrega</span><span>${esFmt(p.taxa_entrega)}</span></div>` : ""}
    <div class="rc-tot"><span>TOTAL</span><span>${esFmt(p.total)}</span></div>
    ${p.forma_pagamento ? `<div class="rc-c">Pagamento: ${esc(p.forma_pagamento)}</div>` : ""}
    ${p.observacao ? `<div class="rc-obs">Obs.: ${esc(p.observacao)}</div>` : ""}
    <div class="rc-sep"></div>
    <div class="rc-c">Obrigado e volte sempre!</div>`;
}

// Gera o PDF do recibo (bobina de 80 mm, preto e branco) e baixa direto, sem passar pela impressão.
function esGerarPdf(p) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) return null;
  const itens = p.itens || [];
  const W = 80, M = 5;
  // Mede o conteúdo antes para a página ter a altura certa (sem sobra de papel).
  const medidor = new jsPDF({ unit: "mm", format: [W, 400] });
  medidor.setFontSize(9);
  const linhasItens = itens.map((i) => medidor.splitTextToSize(`${i.qtd}x ${i.nome}`, W - 2 * M - 22));
  const extraEntrega = p.tipo === "entrega" ? 3 + (p.endereco ? 1 : 0) + (p.bairro ? 1 : 0) : 0;
  const altura = Math.max(90, 66 + linhasItens.reduce((n, l) => n + l.length * 4.2, 0) + extraEntrega * 4.2 + (p.taxa_entrega ? 5 : 0) + (p.forma_pagamento ? 5 : 0) + (p.observacao ? 9 : 0));
  // Sem isto o gerador gira a página quando a altura é menor que a largura (recibo curto sairia cortado).
  const doc = new jsPDF({ unit: "mm", format: [W, altura], orientation: "portrait" });
  let y = 8;
  const centro = (txt, tam, neg) => { doc.setFont("helvetica", neg ? "bold" : "normal"); doc.setFontSize(tam); doc.text(String(txt), W / 2, y, { align: "center" }); y += tam * 0.42 + 1.6; };
  const lado = (esq, dir, tam, neg) => { doc.setFont("helvetica", neg ? "bold" : "normal"); doc.setFontSize(tam); doc.text(String(esq), M, y); doc.text(String(dir), W - M, y, { align: "right" }); y += tam * 0.42 + 1.6; };
  const sep = () => { y += 0.6; doc.setLineDashPattern([0.8, 0.8], 0); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); doc.setLineDashPattern([], 0); y += 4; };

  const data = new Date(p.criado_em || Date.now());
  const rotulo = p.tipo === "mesa" ? `MESA ${p.mesa || "-"}` : p.tipo === "entrega" ? "ENTREGA" : `RETIRADA: ${p.cliente_nome || ""}`;
  centro("ESPETINHOS DO SEU PAULO", 13, true);
  centro("RECIBO DE PEDIDO", 9, false);
  sep();
  lado(`Pedido ${p.id.slice(0, 6).toUpperCase()}`, `${data.toLocaleDateString("pt-BR")} ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, 9, false);
  centro(rotulo, 11, true);
  if (p.tipo === "entrega") {
    if (p.cliente_nome) centro(p.cliente_nome, 9, false);
    if (p.endereco) centro(p.endereco, 9, false);
    if (p.bairro) centro(p.bairro, 9, false);
  }
  sep();
  itens.forEach((i, k) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(linhasItens[k], M, y);
    doc.text(esFmt(i.qtd * i.preco), W - M, y, { align: "right" });
    y += linhasItens[k].length * 4.2;
  });
  sep();
  if (p.taxa_entrega) lado("Taxa de entrega", esFmt(p.taxa_entrega), 9, false);
  y += 0.6; doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 4.6;
  lado("TOTAL", esFmt(p.total), 13, true);
  if (p.forma_pagamento) centro(`Pagamento: ${p.forma_pagamento}`, 9, false);
  if (p.observacao) { doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.text(doc.splitTextToSize(`Obs.: ${p.observacao}`, W - 2 * M), W / 2, y, { align: "center" }); y += 5; }
  sep();
  centro("Obrigado e volte sempre!", 9, false);
  return doc;
}

function esBaixarPdf(p) {
  const doc = esGerarPdf(p);
  if (!doc) return esMsg("#pedido-msg", "Não consegui carregar o gerador de PDF. Confira a internet e tente de novo.");
  doc.save(`Recibo-${p.id.slice(0, 6).toUpperCase()}.pdf`);
}

// Imprime sem abrir janela nova: usa a área de impressão da própria página.
// A altura da bobina acompanha o tamanho do pedido, para não gastar papel à toa.
function esImprimirDoc(p) {
  const area = document.getElementById("print-area");
  // A altura nunca pode ser menor que a largura (80 mm): se for, o navegador gira a página e o recibo sai cortado.
  const altura = Math.max(90, 50 + (p.itens || []).length * 9 + (p.tipo === "entrega" ? 28 : 0) + (p.observacao ? 8 : 0));
  area.innerHTML = `<style>@page { size: 80mm ${altura}mm; margin: 0; }${RC_CSS}</style>` + esDocumentoRecibo(p);
  setTimeout(() => window.print(), 50);
}

// ---------- Relatórios ----------
const csvTexto = (linhas) => "\ufeff" + linhas.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
function esBaixarCsv(nome, linhas) {
  const url = URL.createObjectURL(new Blob([csvTexto(linhas)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const brData = (iso) => new Date(iso).toLocaleDateString("pt-BR");
const brHora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const nomeTipo = (t) => (t === "mesa" ? "Mesa" : t === "entrega" ? "Entrega" : "Retirada");

async function esPedidosDoPeriodo() {
  const de = $("#rel-de").value, ate = $("#rel-ate").value;
  const ini = new Date(de + "T00:00:00").toISOString();
  const fim = new Date(ate + "T23:59:59.999").toISOString();
  const { data, error } = await db.from("sp_pedidos").select("*").gte("criado_em", ini).lte("criado_em", fim).order("criado_em");
  if (error) { esMsg("#rel-msg", "Erro: " + error.message); return null; }
  return data.filter((p) => p.status !== "cancelado");
}

function esDefinirPeriodo(dias) {
  const fim = new Date(), ini = new Date();
  ini.setDate(ini.getDate() - dias);
  $("#rel-de").value = dataLocal(ini); $("#rel-ate").value = dataLocal(fim);
  esRenderRelatorio();
}

async function esRenderRelatorio() {
  if (!$("#rel-de").value) { $("#rel-de").value = dataLocal(new Date()); $("#rel-ate").value = dataLocal(new Date()); }
  const ped = await esPedidosDoPeriodo();
  if (!ped) return;
  const soma = (l) => l.reduce((t, p) => t + Number(p.total), 0);
  const taxas = ped.reduce((t, p) => t + Number(p.taxa_entrega || 0), 0);
  const porPag = {};
  ped.filter((p) => p.status === "pago").forEach((p) => { const f = p.forma_pagamento || "Dinheiro"; porPag[f] = (porPag[f] || 0) + Number(p.total); });
  const prods = {};
  ped.forEach((p) => (p.itens || []).forEach((i) => { const r = prods[i.nome] || (prods[i.nome] = { qtd: 0, total: 0 }); r.qtd += Number(i.qtd); r.total += Number(i.qtd) * Number(i.preco); }));
  const top = Object.entries(prods).sort((a, b) => b[1].qtd - a[1].qtd).slice(0, 10);
  $("#rel-resumo").innerHTML = `<div class="chips-row">
      <div class="kpi"><span class="muted small">Pedidos</span><b>${ped.length}</b></div>
      <div class="kpi"><span class="muted small">Vendido</span><b>${esFmt(soma(ped))}</b></div>
      <div class="kpi"><span class="muted small">Taxas de entrega</span><b>${esFmt(taxas)}</b></div>
      ${["mesa", "entrega", "balcao"].map((t) => `<div class="kpi"><span class="muted small">${nomeTipo(t)}s (${ped.filter((p) => p.tipo === t).length})</span><b>${esFmt(soma(ped.filter((p) => p.tipo === t)))}</b></div>`).join("")}
    </div>
    <h2 class="sub">Recebido por forma de pagamento</h2>
    <div class="chips-row">${Object.keys(porPag).length ? Object.entries(porPag).map(([f, v]) => `<div class="kpi"><span class="muted small">${esc(f)}</span><b>${esFmt(v)}</b></div>`).join("") : '<span class="muted small">Nada recebido no período.</span>'}</div>
    <h2 class="sub">Mais vendidos</h2>
    ${top.length ? top.map(([n, r]) => `<div class="linha"><div class="info">${esc(n)}</div><div class="acoes"><span>${fmtQtd(r.qtd)} un · ${esFmt(r.total)}</span></div></div>`).join("") : '<p class="muted">Sem vendas no período.</p>'}`;
}

async function esBaixarRelatorio(tipo) {
  const periodo = `${$("#rel-de").value}_a_${$("#rel-ate").value}`;
  if (tipo === "estoque") {
    return esBaixarCsv(`estoque-${dataLocal(new Date())}.csv`, [["Produto", "Categoria", "Preço", "Estoque", "Avisar em"],
      ...ES.produtos.map((p) => [p.nome, p.categoria || "", brNum(p.preco), temEstoque(p) ? fmtQtd(p.estoque) : "sem controle", Number(p.estoque_minimo) ? fmtQtd(p.estoque_minimo) : ""])]);
  }
  const ped = await esPedidosDoPeriodo();
  if (!ped) return;
  if (tipo === "vendas") {
    esBaixarCsv(`vendas-${periodo}.csv`, [["Data", "Hora", "Pedido", "Tipo", "Mesa", "Cliente", "Endereço", "Bairro", "Itens", "Subtotal", "Taxa de entrega", "Total", "Pagamento", "Status"],
      ...ped.map((p) => [brData(p.criado_em), brHora(p.criado_em), p.id.slice(0, 6).toUpperCase(), nomeTipo(p.tipo), p.mesa || "", p.cliente_nome || "", p.endereco || "", p.bairro || "",
        (p.itens || []).map((i) => `${i.qtd}x ${i.nome}`).join(" + "), brNum(p.subtotal), brNum(p.taxa_entrega || 0), brNum(p.total), p.forma_pagamento || "", p.status])]);
  } else if (tipo === "produtos") {
    const prods = {};
    ped.forEach((p) => (p.itens || []).forEach((i) => { const r = prods[i.nome] || (prods[i.nome] = { qtd: 0, total: 0 }); r.qtd += Number(i.qtd); r.total += Number(i.qtd) * Number(i.preco); }));
    esBaixarCsv(`produtos-vendidos-${periodo}.csv`, [["Produto", "Quantidade", "Total vendido"],
      ...Object.entries(prods).sort((a, b) => b[1].qtd - a[1].qtd).map(([n, r]) => [n, fmtQtd(r.qtd), brNum(r.total)])]);
  } else if (tipo === "clientes") {
    esBaixarCsv(`clientes-${periodo}.csv`, [["Cliente", "Telefone", "Endereço", "Bairro", "Pedidos no período", "Total gasto no período"],
      ...ES.clientes.map((c) => { const meus = ped.filter((p) => p.cliente_id === c.id); return [c.nome, c.telefone || "", c.endereco || "", c.bairro || "", meus.length, brNum(meus.reduce((t, p) => t + Number(p.total), 0))]; })]);
  }
  esMsg("#rel-msg", "Arquivo baixado. Abra no Excel ou no Numbers.");
}

// ---------- Renderização geral e eventos ----------
function esRenderTudo() {
  esRenderCardapio(); esRenderPedido(); esRenderPedidos();
}

function esLigarEventos() {
  $("#cardapio-lista").addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.estoque) esSalvarEstoque(t.dataset.estoque, t.value);
  });
  $("#cardapio-lista").addEventListener("click", (e) => {
    const d = e.target.dataset;
    if (d.editarProduto) esEditarProduto(d.editarProduto);
    if (d.removerProduto) { ES.acaoProduto = d.removerProduto; esRenderCardapio(); }
    if (d.removerNao) { ES.acaoProduto = null; esRenderCardapio(); }
    if (d.removerOk) esRemoverProduto(d.removerOk);
  });
  $("#cardapio-salvar").addEventListener("click", () => esNovoProduto($("#cardapio-form")));
  $("#cardapio-cancelar").addEventListener("click", () => esCancelarEdicaoProduto());
  document.querySelector('.tabs button[data-tab="relatorios"]').addEventListener("click", () => esRenderRelatorio());
  $("#rel-de").addEventListener("change", () => esRenderRelatorio());
  $("#rel-ate").addEventListener("change", () => esRenderRelatorio());
  document.querySelectorAll("[data-rel-atalho]").forEach((b) => b.addEventListener("click", () => esDefinirPeriodo({ hoje: 0, semana: 6, mes: new Date().getDate() - 1 }[b.dataset.relAtalho])));
  document.querySelectorAll("[data-rel-baixar]").forEach((b) => b.addEventListener("click", () => esBaixarRelatorio(b.dataset.relBaixar)));
  document.querySelectorAll("[data-filtro-tipo]").forEach((b) => b.addEventListener("click", () => { ES.filtroTipo = b.dataset.filtroTipo; esRenderPedidos(); }));
  document.querySelectorAll("[data-tipo]").forEach((b) => b.addEventListener("click", () => { ESP.tipo = b.dataset.tipo; esRenderPedido(); }));
  $("#pedido-produtos").addEventListener("click", (e) => {
    const sub = e.target.closest("[data-sub]");
    if (sub) { const it = ESP.itens[sub.dataset.sub]; if (it) { it.qtd -= 1; if (it.qtd <= 0) delete ESP.itens[sub.dataset.sub]; } return esRenderPedido(); }
    const b = e.target.closest("[data-add]"); if (!b) return;
    const p = ES.produtos.find((x) => x.id === b.dataset.add);
    const it = ESP.itens[p.id] || { nome: p.nome, qtd: 0, preco: Number(p.preco) };
    it.qtd += 1; ESP.itens[p.id] = it; esRenderPedido();
  });
  $("#pedido-carrinho").addEventListener("click", (e) => {
    const id = e.target.dataset.rem; if (!id) return;
    ESP.itens[id].qtd -= 1; if (ESP.itens[id].qtd <= 0) delete ESP.itens[id]; esRenderPedido();
  });
  $("#pedido-cliente").addEventListener("change", (e) => {
    ESP.clienteId = e.target.value || null;
    const c = ES.clientes.find((x) => x.id === ESP.clienteId);
    if (c) { $("#pedido-bairro").value = c.bairro || ""; $("#pedido-form").elements.endereco.value = c.endereco || ""; }
    esRenderPedido();
  });
  $("#pedido-bairro").addEventListener("change", (e) => {
    // Escolher o bairro sugere a taxa cadastrada; o valor continua editável.
    const b = ES.bairros.find((x) => x.nome === e.target.value);
    if (b) $("#pedido-form").elements.taxa.value = Number(b.taxa).toFixed(2).replace(".", ",");
    esRenderPedido();
  });
  $("#pedido-form").elements.taxa.addEventListener("input", () => esRenderPedido());
  $("#pedido-enviar").addEventListener("click", () => esEnviarPedido());
  $("#pedidos-lista").addEventListener("click", (e) => {
    const t = e.target;
    if (t.dataset.pago) { ES.acao = { id: t.dataset.pago, tipo: "receber" }; esRenderPedidos(); }
    if (t.dataset.cancelar) { ES.acao = { id: t.dataset.cancelar, tipo: "cancelar" }; esRenderPedidos(); }
    if (t.dataset.cartao) { ES.acao = { id: t.dataset.cartao, tipo: "cartao" }; esRenderPedidos(); }
    if (t.dataset.voltar) { ES.acao = null; esRenderPedidos(); }
    if (t.dataset.pagar) esMudarStatus(t.dataset.pagar, "pago", t.dataset.forma);
    if (t.dataset.cancelarOk) esMudarStatus(t.dataset.cancelarOk, "cancelado");
    if (t.dataset.entregue) esMudarStatus(t.dataset.entregue, "entregue");
    if (t.dataset.baixarPdf) { const p = ES.pedidos.find((x) => x.id === t.dataset.baixarPdf); if (p) esBaixarPdf(p); }
    if (t.dataset.imprimirRecibo) { const p = ES.pedidos.find((x) => x.id === t.dataset.imprimirRecibo); if (p) esImprimirDoc(p); }
    if (t.dataset.reimprimir) { const p = ES.pedidos.find((x) => x.id === t.dataset.reimprimir); if (p) esImprimir(p).then(() => esMsg("#pedido-msg", "Comandas reenviadas para impressão.")); }
  });
  document.querySelectorAll("[data-filtro-ped]").forEach((b) => b.addEventListener("click", () => { ES.filtroPedidos = b.dataset.filtroPed; esRenderPedidos(); }));
}

function esIniciar() {
  esLigarEventos();
  esCarregar();
  // Pedidos só recarregam a cada 60 s, e só com a tela de pedidos aberta e visível.
  setInterval(() => { if (document.visibilityState === "visible" && document.querySelector('[data-screen="pedidos"].active')) esCarregar(); }, 60000);
}

esIniciar();
