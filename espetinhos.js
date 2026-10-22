"use strict";

// Espetinhos do Seu Paulo: cardápio com markup, estoque de insumos, pedidos e comandas.
// Usa a conexão `db` (Supabase) criada em app.js. Estes dados são online: sem internet, a tela avisa.

const ES = { insumos: [], produtos: [], fichas: [], bairros: [], clientes: [], pedidos: [], filtroPedidos: "hoje" };
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
  const [ins, prod, fich, bai, cli, ped] = await Promise.all([
    db.from("sp_insumos").select("*").eq("ativo", true).order("nome"),
    db.from("sp_produtos").select("*").eq("ativo", true).order("nome"),
    db.from("sp_ficha_tecnica").select("*"),
    db.from("sp_bairros").select("*").order("nome"),
    db.from("sp_clientes").select("*").order("nome"),
    db.from("sp_pedidos").select("*").order("criado_em", { ascending: false }).limit(300),
  ]);
  const erro = [ins, prod, fich, bai, cli, ped].find((r) => r.error);
  if (erro) { esMsg("#es-aviso", "Erro ao ler o banco: " + erro.error.message); return; }
  ES.insumos = ins.data; ES.produtos = prod.data; ES.fichas = fich.data;
  ES.bairros = bai.data; ES.clientes = cli.data; ES.pedidos = ped.data;
  esRenderTudo();
}

// Ficha técnica -> custo do produto (soma de quantidade x custo do insumo).
const custoDoProduto = (produtoId) =>
  ES.fichas.filter((f) => f.produto_id === produtoId).reduce((soma, f) => {
    const insumo = ES.insumos.find((i) => i.id === f.insumo_id);
    return soma + (insumo ? Number(f.quantidade) * Number(insumo.custo_unitario) : 0);
  }, 0);

const markupDe = (preco, custo) => (custo > 0 ? ((preco - custo) / custo) * 100 : null);

// ---------- Cardápio ----------
function esRenderCardapio() {
  const cats = [...new Set(ES.produtos.map((p) => p.categoria || "Sem categoria"))];
  $("#cardapio-lista").innerHTML = ES.produtos.length ? cats.map((cat) => {
    const itens = ES.produtos.filter((p) => (p.categoria || "Sem categoria") === cat);
    return `<h3 class="cat">${esc(cat)}</h3>` + itens.map((p) => {
      const custo = custoDoProduto(p.id);
      const m = markupDe(Number(p.preco), custo);
      return `<div class="linha cardapio-item">
        <div class="info"><div class="titulo">${esc(p.nome)}</div>
          <div class="small muted">Custo ${esFmt(custo)} · margem ${m === null ? "sem ficha técnica" : m.toFixed(0) + "% de markup"}</div></div>
        <div class="acoes">
          <label class="mini">Preço<input type="text" inputmode="decimal" value="${Number(p.preco).toFixed(2).replace(".", ",")}" data-preco="${esc(p.id)}" data-custo="${custo}"></label>
          <label class="mini">Markup %<input type="text" inputmode="decimal" value="${m === null ? "" : m.toFixed(0)}" data-markup="${esc(p.id)}" data-custo="${custo}"></label>
          <button class="link" data-ficha="${esc(p.id)}" type="button">Ficha técnica</button>
        </div></div>`;
    }).join("");
  }).join("") : '<p class="muted">Nenhum produto. Cadastre o primeiro acima.</p>';
}

// Editar o preço recalcula o markup, e editar o markup recalcula o preço. Os dois podem ser alterados à vontade.
async function esSalvarPreco(produtoId, preco) {
  const { error } = await db.from("sp_produtos").update({ preco: round2(preco), atualizado_em: new Date().toISOString() }).eq("id", produtoId);
  if (error) { esMsg("#es-aviso", "Erro ao salvar preço: " + error.message); return; }
  await esCarregar();
}

async function esSalvarMarkup(produtoId, markup, custo) {
  const preco = round2(custo * (1 + markup / 100));
  await esSalvarPreco(produtoId, preco);
}

async function esNovoProduto(form) {
  const nome = form.nome.value.trim();
  const preco = esNum(form.preco.value);
  if (!nome || !(preco >= 0)) return esMsg("#cardapio-msg", "Informe o nome e o preço.");
  const id = uid();
  const { error } = await db.from("sp_produtos").insert({
    id, nome, preco: round2(preco), categoria: form.categoria.value.trim() || null, ativo: true, tipo: "produto", custo: 0,
  });
  if (error) return esMsg("#cardapio-msg", "Erro: " + error.message);
  form.reset();
  esMsg("#cardapio-msg", "Produto cadastrado. Agora monte a ficha técnica.");
  await esCarregar();
}

// Ficha técnica: quanto de cada insumo sai em 1 unidade do produto.
function esAbrirFicha(produtoId) {
  const p = ES.produtos.find((x) => x.id === produtoId);
  const linhas = ES.fichas.filter((f) => f.produto_id === produtoId);
  const opcoes = ES.insumos.map((i) => `<option value="${esc(i.id)}">${esc(i.nome)} (${esc(i.unidade)})</option>`).join("");
  $("#ficha-tecnica-box").hidden = false;
  $("#ficha-tecnica-box").innerHTML = `
    <h2>Ficha técnica: ${esc(p.nome)}</h2>
    <p class="muted small">Informe quanto de cada insumo sai em <b>1 unidade</b> deste produto. Ex.: 1 pão, 150 g de carne, 1 fatia de queijo.</p>
    ${linhas.map((f) => {
      const i = ES.insumos.find((x) => x.id === f.insumo_id);
      return `<div class="linha"><div class="info">${esc(i ? i.nome : "?")}</div>
        <div class="acoes"><span>${Number(f.quantidade)} ${esc(i ? i.unidade : "")}</span>
        <button class="link danger" data-del-ficha="${esc(f.id)}" type="button">Remover</button></div></div>`;
    }).join("") || '<p class="muted">Ainda sem insumos nesta ficha.</p>'}
    <form id="ficha-linha-form" class="form-row" data-produto="${esc(produtoId)}">
      <select name="insumo">${opcoes}</select>
      <input type="text" name="qtd" inputmode="decimal" placeholder="Quantidade (ex.: 150)" required>
      <button class="btn" type="submit">Adicionar</button>
    </form>
    <p class="muted small">Custo atual deste produto: <b>${esFmt(custoDoProduto(produtoId))}</b></p>
    <button class="link" type="button" id="ficha-fechar">Fechar</button>`;
}

async function esAdicionarFichaLinha(form, produtoId) {
  const qtd = esNum(form.qtd.value);
  if (!(qtd > 0)) return alert("Informe uma quantidade maior que zero.");
  const id = uid();
  const { error } = await db.from("sp_ficha_tecnica").upsert({ id, produto_id: produtoId, insumo_id: form.insumo.value, quantidade: qtd }, { onConflict: "produto_id,insumo_id" });
  if (error) return alert("Erro: " + error.message);
  await esRecalcularCustos();
  await esCarregar();
  esAbrirFicha(produtoId);
}

async function esRemoverFichaLinha(fichaId, produtoId) {
  await db.from("sp_ficha_tecnica").delete().eq("id", fichaId);
  await esRecalcularCustos();
  await esCarregar();
  esAbrirFicha(produtoId);
}

// Guarda o custo calculado em cada produto (para o cardápio e para o markup ficarem sempre certos).
async function esRecalcularCustos() {
  for (const p of ES.produtos) {
    const custo = round2(custoDoProduto(p.id));
    if (Number(p.custo) !== custo) await db.from("sp_produtos").update({ custo }).eq("id", p.id);
  }
}

// ---------- Estoque ----------
const chaveNome = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Bebida vendida como está (ex.: Ref Vedete 2 L): o insumo de mesmo nome vira a ficha de 1 unidade.
async function esVincularPorNome(insumoId, nome) {
  for (const p of ES.produtos) {
    if (chaveNome(p.nome) === chaveNome(nome) && !ES.fichas.some((f) => f.produto_id === p.id)) {
      await db.from("sp_ficha_tecnica").insert({ id: uid(), produto_id: p.id, insumo_id: insumoId, quantidade: 1 });
    }
  }
}
function esRenderEstoque() {
  const baixos = ES.insumos.filter((i) => Number(i.estoque_atual) <= Number(i.estoque_minimo) && Number(i.estoque_minimo) > 0);
  $("#estoque-alerta").innerHTML = baixos.length ? `<div class="aviso">Abaixo do mínimo: ${baixos.map((i) => esc(i.nome)).join(", ")}</div>` : "";
  const valorTotal = ES.insumos.reduce((soma, i) => soma + Number(i.estoque_atual) * Number(i.custo_unitario), 0);
  const cabecalho = ES.insumos.length ? `<div class="kpi" style="margin-bottom:12px"><span class="muted small">Valor total em estoque</span><b>${esFmt(valorTotal)}</b></div>` : "";
  $("#estoque-lista").innerHTML = ES.insumos.length ? cabecalho + ES.insumos.map((i) => {
    const baixo = Number(i.estoque_minimo) > 0 && Number(i.estoque_atual) <= Number(i.estoque_minimo);
    const custo = Number(i.custo_unitario);
    const valor = Number(i.estoque_atual) * custo;
    const prod = ES.produtos.find((p) => chaveNome(p.nome) === chaveNome(i.nome));
    const markup = prod && custo > 0 ? ((Number(prod.preco) - custo) / custo) * 100 : null;
    const venda = prod ? `<div class="small"><b>Vendido a ${esFmt(prod.preco)}</b>${markup === null ? "" : ` · markup ${markup.toFixed(0)}%`}</div>` : "";
    return `<div class="linha ${baixo ? "alerta" : ""}">
      <div class="info"><div class="titulo">${esc(i.nome)}</div>
        <div class="small muted">${esc(i.categoria || "")} · custo ${esFmt(custo)} por ${esc(i.unidade)} · em estoque ${esFmt(valor)}</div>
        ${venda}</div>
      <div class="acoes"><span class="preco">${Number(i.estoque_atual)} ${esc(i.unidade)}</span>
        <button class="link" data-editar-insumo="${esc(i.id)}" type="button">Editar</button>
        <button class="link" data-mov="${esc(i.id)}" type="button">Movimentar</button></div></div>`;
  }).join("") : '<p class="muted">Nenhum insumo. Cadastre carne, pão, açaí, chopp, bebidas, embalagens...</p>';
}

// Preenche o formulário de cima com os dados do insumo, para editar.
function esEditarInsumo(id) {
  const i = ES.insumos.find((x) => x.id === id);
  const f = $("#estoque-form");
  f.elements.id.value = i.id;
  f.elements.nome.value = i.nome;
  f.elements.unidade.value = i.unidade;
  f.elements.categoria.value = i.categoria || "";
  f.elements.custo.value = String(Number(i.custo_unitario)).replace(".", ",");
  f.elements.inicial.value = "";
  f.elements.minimo.value = String(Number(i.estoque_minimo)).replace(".", ",");
  $("#estoque-titulo").textContent = "Editar insumo";
  $("#estoque-salvar").textContent = "Salvar alterações";
  $("#estoque-cancelar").hidden = false;
  $("#estoque-msg").textContent = "Para mudar a quantidade em estoque, use Movimentar.";
  f.scrollIntoView({ behavior: "smooth", block: "start" });
}

function esCancelarEdicaoInsumo() {
  const f = $("#estoque-form");
  f.reset();
  f.elements.id.value = "";
  $("#estoque-titulo").textContent = "Novo insumo";
  $("#estoque-salvar").textContent = "Cadastrar insumo";
  $("#estoque-cancelar").hidden = true;
  $("#estoque-msg").textContent = "";
}

async function esNovoInsumo(form) {
  const editando = form.elements.id.value;
  const nome = form.nome.value.trim();
  const custo = esNum(form.custo.value) || 0;
  const inicial = esNum(form.inicial.value) || 0;
  if (!nome) return esMsg("#estoque-msg", "Informe o nome.");
  if (editando) {
    const { error: erroEdicao } = await db.from("sp_insumos").update({
      nome, unidade: form.unidade.value, categoria: form.categoria.value.trim() || null,
      custo_unitario: custo, estoque_minimo: esNum(form.minimo.value) || 0, atualizado_em: new Date().toISOString(),
    }).eq("id", editando);
    if (erroEdicao) return esMsg("#estoque-msg", "Erro: " + erroEdicao.message);
    await esCarregar();
    await esVincularPorNome(editando, nome);
    await esRecalcularCustos();
    esCancelarEdicaoInsumo();
    esMsg("#estoque-msg", "Insumo atualizado.");
    return esCarregar();
  }
  const id = uid();
  const { error } = await db.from("sp_insumos").insert({
    id, nome, unidade: form.unidade.value, categoria: form.categoria.value.trim() || null,
    custo_unitario: custo, estoque_atual: inicial, estoque_minimo: esNum(form.minimo.value) || 0, ativo: true,
  });
  if (error) return esMsg("#estoque-msg", "Erro: " + error.message);
  if (inicial > 0) await db.from("sp_movimentos_estoque").insert({ id: uid(), insumo_id: id, tipo: "entrada", quantidade: inicial, custo_unitario: custo, observacao: "Estoque inicial" });
  await esCarregar();
  await esVincularPorNome(id, nome);
  await esRecalcularCustos();
  form.reset();
  esMsg("#estoque-msg", "Insumo cadastrado.");
  await esCarregar();
}

// Movimentação: entrada soma, saída subtrai, ajuste define o valor contado.
async function esMovimentar(insumoId, tipo, quantidade, custo, observacao) {
  const i = ES.insumos.find((x) => x.id === insumoId);
  let novo = Number(i.estoque_atual);
  if (tipo === "entrada") novo += quantidade;
  if (tipo === "saida") novo -= quantidade;
  if (tipo === "ajuste") novo = quantidade;
  const atualiza = { estoque_atual: novo, atualizado_em: new Date().toISOString() };
  if (tipo === "entrada" && custo > 0) atualiza.custo_unitario = custo;
  const { error } = await db.from("sp_insumos").update(atualiza).eq("id", insumoId);
  if (error) return alert("Erro: " + error.message);
  await db.from("sp_movimentos_estoque").insert({ id: uid(), insumo_id: insumoId, tipo, quantidade: tipo === "ajuste" ? Math.abs(novo - Number(i.estoque_atual)) : quantidade, custo_unitario: custo || null, observacao: observacao || null });
  if (tipo === "entrada" && custo > 0) await esRecalcularCustos();
  await esCarregar();
}

// ---------- Pedidos ----------
const esTotalPedido = () => Object.values(ESP.itens).reduce((s, it) => s + it.qtd * it.preco, 0);
const esTaxa = () => {
  if (ESP.tipo !== "entrega") return 0;
  const b = ES.bairros.find((x) => x.nome === $("#pedido-bairro").value);
  return b ? Number(b.taxa) : 0;
};

function esRenderPedido() {
  // Lista de produtos para escolher
  $("#pedido-produtos").innerHTML = ES.produtos.map((p) => {
    const qtd = ESP.itens[p.id] ? ESP.itens[p.id].qtd : 0;
    return `<button type="button" class="prod ${qtd ? "sel" : ""}" data-add="${esc(p.id)}">
      <span>${esc(p.nome)}</span><span class="small">${esFmt(p.preco)}</span>${qtd ? `<b class="badge-qtd">${qtd}</b>` : ""}</button>`;
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
  $("#pedido-bairro").innerHTML = '<option value="">Escolha o bairro</option>' + ES.bairros.map((b) => `<option value="${esc(b.nome)}">${esc(b.nome)} (${esFmt(b.taxa)})</option>`).join("");
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
    bairro = $("#pedido-bairro").value || (cliente && cliente.bairro);
    if (!bairro) return esMsg("#pedido-msg", "Escolha o bairro para calcular a taxa.");
    endereco = cliente && cliente.endereco;
  }
  const taxa = esTaxa() || (ESP.tipo === "entrega" ? Number((ES.bairros.find((b) => b.nome === bairro) || {}).taxa || 0) : 0);
  const subtotal = round2(esTotalPedido());
  const itens = Object.entries(ESP.itens).map(([id, it]) => ({ produto_id: id, nome: it.nome, qtd: it.qtd, preco: it.preco, custo: custoDoProduto(id) }));
  const pedido = {
    id: uid(), tipo: ESP.tipo, mesa: ESP.tipo === "mesa" ? f.elements.mesa.value.trim() || null : null,
    cliente_id: cliente ? cliente.id : null, cliente_nome: ESP.tipo === "balcao" ? (f.elements.pessoaX.value.trim() || "Retirada") : (cliente ? cliente.nome : null),
    endereco, bairro, taxa_entrega: round2(taxa), itens, subtotal, total: round2(subtotal + taxa), status: "aberto",
    observacao: f.elements.obs.value.trim() || null,
  };
  const { error } = await db.from("sp_pedidos").insert(pedido);
  if (error) return esMsg("#pedido-msg", "Erro: " + error.message);
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
  // Baixa de estoque só uma vez, quando o pedido sai de "aberto" para entregue ou pago.
  if (era === "aberto" && (status === "entregue" || status === "pago")) await esBaixarEstoque(p);
  await esCarregar();
}

async function esBaixarEstoque(pedido) {
  for (const it of pedido.itens || []) {
    for (const f of ES.fichas.filter((x) => x.produto_id === it.produto_id)) {
      const insumo = ES.insumos.find((i) => i.id === f.insumo_id);
      if (!insumo) continue;
      const qtd = Number(f.quantidade) * it.qtd;
      await db.from("sp_insumos").update({ estoque_atual: Number(insumo.estoque_atual) - qtd, atualizado_em: new Date().toISOString() }).eq("id", insumo.id);
      await db.from("sp_movimentos_estoque").insert({ id: uid(), insumo_id: insumo.id, tipo: "venda", quantidade: qtd, custo_unitario: Number(insumo.custo_unitario), pedido_id: pedido.id, observacao: `Pedido ${pedido.id.slice(0, 6)}` });
    }
  }
}

function esRenderPedidos() {
  const hoje = new Date().toISOString().slice(0, 10);
  const lista = ES.pedidos.filter((p) => ES.filtroPedidos === "todos" || (p.criado_em || "").slice(0, 10) === hoje);
  const totalPago = lista.filter((p) => p.status === "pago").reduce((s, p) => s + Number(p.total), 0);
  $("#pedidos-resumo").innerHTML = `<div class="kpi"><span class="muted small">Pedidos</span><b>${lista.length}</b></div>
    <div class="kpi"><span class="muted small">Recebido</span><b>${esFmt(totalPago)}</b></div>`;
  $("#pedidos-lista").innerHTML = lista.length ? lista.map((p) => {
    const rotulo = p.tipo === "mesa" ? `Mesa ${p.mesa || "-"}` : p.tipo === "entrega" ? `Entrega · ${p.cliente_nome || ""}` : `Retirada · ${p.cliente_nome || ""}`;
    return `<div class="linha pedido ${p.status}">
      <div class="info"><div class="titulo">${esc(rotulo)}</div>
        <div class="small muted">${esc((p.itens || []).map((i) => i.qtd + "x " + i.nome).join(", "))}</div>
        <div class="small muted">${new Date(p.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${esc(p.status)}</div></div>
      <div class="acoes"><span class="preco">${esFmt(p.total)}</span>
        ${p.status === "aberto" ? `<button class="btn" data-pago="${esc(p.id)}" type="button">Receber</button>` : ""}
        ${p.status === "aberto" && p.tipo === "entrega" ? `<button class="link" data-entregue="${esc(p.id)}" type="button">Entregue</button>` : ""}
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

// ---------- Renderização geral e eventos ----------
function esRenderTudo() {
  esRenderCardapio(); esRenderEstoque(); esRenderPedido(); esRenderPedidos();
}

function esLigarEventos() {
  $("#cardapio-lista").addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.preco) esSalvarPreco(t.dataset.preco, esNum(t.value));
    if (t.dataset.markup) esSalvarMarkup(t.dataset.markup, esNum(t.value), Number(t.dataset.custo));
  });
  $("#cardapio-lista").addEventListener("click", (e) => { if (e.target.dataset.ficha) esAbrirFicha(e.target.dataset.ficha); });
  $("#cardapio-salvar").addEventListener("click", () => esNovoProduto($("#cardapio-form")));
  $("#ficha-tecnica-box").addEventListener("submit", (e) => { if (e.target.id === "ficha-linha-form") { e.preventDefault(); esAdicionarFichaLinha(e.target, e.target.dataset.produto); } });
  $("#ficha-tecnica-box").addEventListener("click", (e) => {
    if (e.target.dataset.delFicha) esRemoverFichaLinha(e.target.dataset.delFicha, $("#ficha-linha-form").dataset.produto);
    if (e.target.id === "ficha-fechar") $("#ficha-tecnica-box").hidden = true;
  });
  $("#estoque-salvar").addEventListener("click", () => esNovoInsumo($("#estoque-form")));
  $("#estoque-cancelar").addEventListener("click", () => esCancelarEdicaoInsumo());
  $("#estoque-lista").addEventListener("click", (e) => {
    if (e.target.dataset.editarInsumo) return esEditarInsumo(e.target.dataset.editarInsumo);
    const id = e.target.dataset.mov; if (!id) return;
    const insumo = ES.insumos.find((x) => x.id === id);
    const tipo = prompt(`${insumo.nome}: digite entrada, saida ou ajuste`, "entrada");
    if (!["entrada", "saida", "ajuste"].includes(tipo)) return;
    const qtd = esNum(prompt(tipo === "ajuste" ? `Quantidade contada (${insumo.unidade})` : `Quantidade (${insumo.unidade})`, ""));
    if (!(qtd >= 0)) return;
    const custo = tipo === "entrada" ? esNum(prompt("Custo unitário desta compra (opcional)", String(insumo.custo_unitario).replace(".", ","))) || 0 : 0;
    esMovimentar(id, tipo, qtd, custo, "");
  });
  document.querySelectorAll("[data-tipo]").forEach((b) => b.addEventListener("click", () => { ESP.tipo = b.dataset.tipo; esRenderPedido(); }));
  $("#pedido-produtos").addEventListener("click", (e) => {
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
  $("#pedido-bairro").addEventListener("change", () => esRenderPedido());
  $("#pedido-enviar").addEventListener("click", () => esEnviarPedido());
  $("#pedidos-lista").addEventListener("click", (e) => {
    const t = e.target;
    if (t.dataset.pago) { const forma = prompt("Forma de pagamento: Dinheiro, Pix ou Cartão", "Dinheiro"); if (forma) esMudarStatus(t.dataset.pago, "pago", forma); }
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
