(function (root) {
  'use strict';

  const CATEGORIES = Object.freeze(['Escritório', 'Tecnologia', 'Embalagens', 'Limpeza', 'Copa']);
  const UNITS = Object.freeze({ un: 'Unidade', cx: 'Caixa', pct: 'Pacote' });
  const MAX_QUANTITY = 1000000000;
  const MAX_COST = 1000000000;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = message => { throw new Error(message); };

  function text(value, label, min, max) {
    if (typeof value !== 'string') fail(`${label} inválido.`);
    const result = value.trim();
    if (result.length < min || result.length > max) fail(`${label} deve ter entre ${min} e ${max} caracteres.`);
    return result;
  }
  function optional(value, label, max) { return text(value == null ? '' : value, label, 0, max); }
  function integer(value, label, min = 0, max = MAX_QUANTITY) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} deve ser um número inteiro entre ${min} e ${max}.`);
    return value;
  }
  function iso(value, label = 'Data') {
    if (value === '' || value === null || typeof value === 'boolean') fail(`${label} inválida.`);
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) fail(`${label} inválida.`);
    return date.toISOString();
  }
  function nowISO(now) { return iso(now === undefined ? Date.now() : now); }
  function storedDate(value, label) {
    if (typeof value !== 'string' || iso(value, label) !== value) fail(`${label} inválida.`);
  }
  function byId(items, id, label) { return items.find(item => item.id === id) || fail(`${label} não encontrado.`); }
  function productOf(state, id) { return byId(state.products, id, 'Produto'); }
  function supplierOf(state, id) { return byId(state.suppliers, id, 'Fornecedor'); }
  function activeProduct(state, id) {
    const product = productOf(state, id);
    if (product.archived) fail('Reative o produto antes de registrar uma movimentação.');
    return product;
  }
  function activeSupplier(state, id) {
    const supplier = supplierOf(state, id);
    if (supplier.archived) fail('Escolha um fornecedor ativo.');
    return supplier;
  }
  function nextId(items, prefix) {
    let number = 1;
    const ids = new Set(items.map(item => item.id));
    while (ids.has(`${prefix}-${number}`)) number += 1;
    return `${prefix}-${number}`;
  }
  function saved(next) { validateState(next); return next; }
  function checkEditDate(item, now) {
    if (now < item.updatedAt) fail('A data da alteração não pode ser anterior à última atualização.');
  }
  function normalizeSupplier(input) {
    const email = optional(input.email, 'E-mail', 160);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Informe um e-mail válido.');
    return {
      name: text(input.name, 'Nome do fornecedor', 3, 100),
      email,
      phone: optional(input.phone, 'Telefone', 40),
      contact: optional(input.contact, 'Contato', 100)
    };
  }
  function normalizeProduct(state, input, currentId) {
    const sku = text(input.sku, 'SKU', 2, 40).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(sku)) fail('Use apenas letras, números, ponto, barra, hífen e sublinhado no SKU.');
    if (state.products.some(product => product.id !== currentId && product.sku === sku)) fail('Este SKU já está cadastrado, inclusive entre os produtos arquivados.');
    if (!CATEGORIES.includes(input.category)) fail('Escolha uma categoria válida.');
    if (!own(UNITS, input.unit)) fail('Escolha uma unidade válida.');
    const supplierId = input.supplierId || null;
    const current = currentId ? productOf(state, currentId) : null;
    if (supplierId) {
      if (current && current.archived && current.supplierId === supplierId) supplierOf(state, supplierId);
      else activeSupplier(state, supplierId);
    }
    return {
      sku,
      name: text(input.name, 'Nome do produto', 3, 120),
      category: input.category,
      unit: input.unit,
      supplierId,
      minStock: integer(input.minStock, 'Estoque mínimo'),
      unitCostCents: integer(input.unitCostCents, 'Custo em centavos', 0, MAX_COST),
      location: optional(input.location, 'Localização', 80)
    };
  }

  function getStock(state, productId) {
    productOf(state, productId);
    return state.movements.reduce((balance, movement) => movement.productId === productId
      ? balance + (movement.type === 'entry' ? movement.quantity : -movement.quantity) : balance, 0);
  }
  function getStatus(state, productId) {
    const product = productOf(state, productId);
    const balance = getStock(state, productId);
    return balance === 0 ? 'empty' : balance <= product.minStock ? 'low' : 'healthy';
  }
  function metrics(state, now) {
    const date = nowISO(now);
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
    const month = formatter.format(new Date(date));
    const active = state.products.filter(product => !product.archived);
    const result = { activeProducts: active.length, totalUnits: 0, inventoryValueCents: 0, lowCount: 0, emptyCount: 0, entriesMonth: 0, exitsMonth: 0 };
    for (const product of active) {
      const balance = getStock(state, product.id);
      result.totalUnits += balance;
      result.inventoryValueCents += balance * product.unitCostCents;
      if (balance <= product.minStock) result.lowCount += 1;
      if (balance === 0) result.emptyCount += 1;
    }
    for (const movement of state.movements) {
      if (formatter.format(new Date(movement.occurredAt)) === month) {
        result[movement.type === 'entry' ? 'entriesMonth' : 'exitsMonth'] += movement.quantity;
      }
    }
    return result;
  }

  function createSupplier(state, input, now) {
    validateState(state);
    const date = nowISO(now);
    const next = clone(state);
    next.suppliers.push({ id: nextId(state.suppliers, 'sup'), ...normalizeSupplier(input), archived: false, createdAt: date, updatedAt: date });
    return saved(next);
  }
  function updateSupplier(state, id, input, now) {
    validateState(state);
    const current = supplierOf(state, id);
    const date = nowISO(now);
    checkEditDate(current, date);
    const fields = normalizeSupplier({ ...current, ...input });
    const next = clone(state);
    Object.assign(supplierOf(next, id), fields, { updatedAt: date });
    return saved(next);
  }
  function setSupplierArchived(state, id, archived, now) {
    validateState(state);
    const current = supplierOf(state, id);
    if (typeof archived !== 'boolean') fail('Situação do fornecedor inválida.');
    if (archived && state.products.some(product => !product.archived && product.supplierId === id)) fail('Altere o fornecedor dos produtos ativos vinculados antes de arquivar.');
    const date = nowISO(now);
    checkEditDate(current, date);
    const next = clone(state);
    Object.assign(supplierOf(next, id), { archived, updatedAt: date });
    return saved(next);
  }
  function createProduct(state, input, now) {
    validateState(state);
    const date = nowISO(now);
    const fields = normalizeProduct(state, input);
    const next = clone(state);
    next.products.push({ id: nextId(state.products, 'prod'), ...fields, archived: false, createdAt: date, updatedAt: date });
    return saved(next);
  }
  function updateProduct(state, id, input, now) {
    validateState(state);
    const current = productOf(state, id);
    const date = nowISO(now);
    checkEditDate(current, date);
    const fields = normalizeProduct(state, { ...current, ...input }, id);
    if ((fields.sku !== current.sku || fields.unit !== current.unit) && state.movements.some(movement => movement.productId === id)) fail('SKU e unidade não podem mudar após a primeira movimentação. Cadastre um novo produto.');
    const next = clone(state);
    Object.assign(productOf(next, id), fields, { updatedAt: date });
    return saved(next);
  }
  function setProductArchived(state, id, archived, now) {
    validateState(state);
    const current = productOf(state, id);
    if (typeof archived !== 'boolean') fail('Situação do produto inválida.');
    if (archived && getStock(state, id) !== 0) fail('O saldo precisa estar zerado para arquivar o produto.');
    if (!archived && current.supplierId) activeSupplier(state, current.supplierId);
    const date = nowISO(now);
    checkEditDate(current, date);
    const next = clone(state);
    Object.assign(productOf(next, id), { archived, updatedAt: date });
    return saved(next);
  }
  function recordMovement(state, input, now) {
    validateState(state);
    const product = activeProduct(state, input.productId);
    if (!['entry', 'exit'].includes(input.type)) fail('Escolha entrada ou saída.');
    const quantity = integer(input.quantity, 'Quantidade', 1);
    if (input.type === 'exit' && quantity > getStock(state, product.id)) fail('Saldo insuficiente. A saída não pode deixar o estoque negativo.');
    const recordedAt = nowISO(now);
    const occurredAt = input.occurredAt === undefined || input.occurredAt === '' ? recordedAt : iso(input.occurredAt, 'Data da movimentação');
    if (occurredAt > recordedAt) fail('A movimentação não pode ter uma data futura.');
    if (recordedAt < product.createdAt) fail('O registro não pode ser anterior ao cadastro do produto.');
    const supplierId = input.type === 'entry' ? (input.supplierId || product.supplierId) : product.supplierId;
    if (input.type === 'entry' && !supplierId) fail('Selecione um fornecedor para a entrada.');
    const supplier = supplierId ? activeSupplier(state, supplierId) : null;
    const number = state.movements.reduce((max, movement) => Math.max(max, movement.number), 0) + 1;
    const next = clone(state);
    next.movements.push({
      id: `mov-${number}`, number, type: input.type,
      productId: product.id, productName: product.name, sku: product.sku, unit: product.unit, quantity,
      unitCostCents: integer(input.type === 'entry' && input.unitCostCents !== undefined ? input.unitCostCents : product.unitCostCents, 'Custo em centavos', 0, MAX_COST),
      supplierId: supplier ? supplier.id : null, supplierName: supplier ? supplier.name : '',
      reason: text(input.reason, 'Motivo', 3, 120),
      reference: optional(input.reference, 'Referência', 80),
      note: optional(input.note, 'Observação', 1000),
      occurredAt, recordedAt, actor: text(input.actor === undefined ? 'Alex Sander' : input.actor, 'Responsável', 2, 100), reversalOf: null
    });
    return saved(next);
  }
  function reverseMovement(state, id, input, now) {
    validateState(state);
    const original = byId(state.movements, id, 'Movimentação');
    activeProduct(state, original.productId);
    if (original.reversalOf) fail('Um estorno não pode ser estornado. Registre uma nova movimentação.');
    if (state.movements.some(movement => movement.reversalOf === id)) fail('Esta movimentação já foi estornada.');
    if (original.type === 'entry' && original.quantity > getStock(state, original.productId)) fail('Saldo insuficiente para estornar esta entrada.');
    const date = nowISO(now);
    if (date < original.recordedAt) fail('O estorno não pode ser anterior ao registro original.');
    const number = state.movements.reduce((max, movement) => Math.max(max, movement.number), 0) + 1;
    const next = clone(state);
    next.movements.push({
      ...clone(original), id: `mov-${number}`, number,
      type: original.type === 'entry' ? 'exit' : 'entry',
      reason: text(input && input.reason, 'Motivo do estorno', 3, 120),
      note: `Estorno da movimentação #${original.number}. Motivo original: ${original.reason}`,
      occurredAt: date, recordedAt: date,
      actor: text(input && input.actor !== undefined ? input.actor : 'Alex Sander', 'Responsável', 2, 100), reversalOf: original.id
    });
    return saved(next);
  }

  function validateState(state) {
    if (!state || state.version !== 1 || !Array.isArray(state.products) || !Array.isArray(state.suppliers) || !Array.isArray(state.movements)) fail('Os dados do estoque são inválidos.');
    if (state.products.length > 10000 || state.suppliers.length > 10000 || state.movements.length > 100000) fail('O limite de registros deste demonstrativo foi atingido.');
    const unique = (items, label) => {
      const ids = new Set();
      for (const item of items) {
        if (!item || typeof item !== 'object') fail(`${label} inválido.`);
        text(item.id, 'Identificador', 1, 100);
        if (ids.has(item.id)) fail(`${label} duplicado.`);
        ids.add(item.id);
      }
    };
    unique(state.products, 'Produto'); unique(state.suppliers, 'Fornecedor'); unique(state.movements, 'Movimentação');
    const suppliers = new Map(state.suppliers.map(supplier => [supplier.id, supplier]));
    const products = new Map(state.products.map(product => [product.id, product]));
    const movements = new Map();
    const skus = new Set();
    const balances = new Map(state.products.map(product => [product.id, 0]));
    const reversals = new Set();
    for (const supplier of state.suppliers) {
      normalizeSupplier(supplier);
      if (typeof supplier.archived !== 'boolean') fail('Situação do fornecedor inválida.');
      storedDate(supplier.createdAt, 'Data de cadastro'); storedDate(supplier.updatedAt, 'Data de atualização');
      if (supplier.updatedAt < supplier.createdAt) fail('Datas do fornecedor inconsistentes.');
    }
    for (const product of state.products) {
      const sku = text(product.sku, 'SKU', 2, 40);
      if (sku !== sku.toUpperCase() || !/^[A-Z0-9][A-Z0-9._/-]*$/.test(sku) || skus.has(sku)) fail('SKU inválido ou duplicado.');
      skus.add(sku);
      text(product.name, 'Nome do produto', 3, 120);
      if (!CATEGORIES.includes(product.category) || !own(UNITS, product.unit)) fail('Classificação do produto inválida.');
      if (typeof product.archived !== 'boolean') fail('Situação do produto inválida.');
      if (product.supplierId !== null && (!suppliers.has(product.supplierId) || (!product.archived && suppliers.get(product.supplierId).archived))) fail('Fornecedor do produto inválido ou arquivado.');
      integer(product.minStock, 'Estoque mínimo'); integer(product.unitCostCents, 'Custo em centavos', 0, MAX_COST);
      optional(product.location, 'Localização', 80);
      storedDate(product.createdAt, 'Data de cadastro'); storedDate(product.updatedAt, 'Data de atualização');
      if (product.updatedAt < product.createdAt) fail('Datas do produto inconsistentes.');
    }
    let lastNumber = 0;
    for (const movement of state.movements) {
      integer(movement.number, 'Número da movimentação', 1, Number.MAX_SAFE_INTEGER);
      if (movement.number <= lastNumber) fail('A sequência das movimentações é inválida.');
      lastNumber = movement.number;
      const product = products.get(movement.productId);
      if (!product || !['entry', 'exit'].includes(movement.type)) fail('Produto ou tipo da movimentação inválido.');
      text(movement.productName, 'Produto da movimentação', 3, 120);
      if (movement.sku !== product.sku || movement.unit !== product.unit) fail('SKU ou unidade divergente no histórico.');
      integer(movement.quantity, 'Quantidade', 1); integer(movement.unitCostCents, 'Custo em centavos', 0, MAX_COST);
      if (movement.supplierId !== null && !suppliers.has(movement.supplierId)) fail('Fornecedor da movimentação inexistente.');
      if (movement.type === 'entry' && movement.reversalOf === null && !movement.supplierId) fail('Uma entrada precisa identificar o fornecedor.');
      text(movement.supplierName, 'Nome do fornecedor no histórico', movement.supplierId ? 3 : 0, 100);
      if (!movement.supplierId && movement.supplierName !== '') fail('Fornecedor do histórico inconsistente.');
      text(movement.reason, 'Motivo', 3, 120); optional(movement.reference, 'Referência', 80); optional(movement.note, 'Observação', 1000); text(movement.actor, 'Responsável', 2, 100);
      storedDate(movement.occurredAt, 'Data da movimentação'); storedDate(movement.recordedAt, 'Data do registro');
      if (movement.occurredAt > movement.recordedAt || movement.recordedAt < product.createdAt) fail('Datas da movimentação inconsistentes.');
      if (movement.reversalOf !== null) {
        const original = movements.get(movement.reversalOf);
        if (!original || original.reversalOf || reversals.has(original.id) || original.type === movement.type) fail('Estorno inválido ou duplicado.');
        for (const key of ['productId', 'productName', 'sku', 'unit', 'quantity', 'unitCostCents', 'supplierId', 'supplierName', 'reference']) {
          if (movement[key] !== original[key]) fail('O estorno precisa preservar os dados da movimentação original.');
        }
        if (movement.recordedAt < original.recordedAt) fail('Data do estorno inconsistente.');
        reversals.add(original.id);
      }
      const balance = balances.get(product.id) + (movement.type === 'entry' ? movement.quantity : -movement.quantity);
      if (!Number.isSafeInteger(balance) || balance < 0) fail('O histórico contém um saldo negativo ou inválido.');
      balances.set(product.id, balance);
      movements.set(movement.id, movement);
    }
    let value = 0;
    for (const product of state.products) {
      if (product.archived && balances.get(product.id) !== 0) fail('Um produto arquivado não pode ter saldo.');
      value += balances.get(product.id) * product.unitCostCents;
      if (!Number.isSafeInteger(value)) fail('O valor total do estoque excede o limite permitido.');
    }
    return true;
  }

  function createSeed(now) {
    const date = nowISO(now);
    const day = 86400000;
    const at = days => new Date(new Date(date).getTime() - days * day).toISOString();
    const created = at(50);
    const suppliers = [
      ['Papel & Companhia', 'Mariana Lima', 'contato@papelcompanhia.example', '(11) 3456-7200'],
      ['Connect Tecnologia', 'Rafael Martins', 'vendas@connecttech.example', '(11) 3222-8100'],
      ['EcoPack Embalagens', 'Camila Souza', 'atendimento@ecopack.example', '(11) 4000-2050'],
      ['LimpaMais Distribuidora', 'Lucas Alves', 'comercial@limpamais.example', '(11) 3100-6090'],
      ['Café do Centro', 'Beatriz Costa', 'pedidos@cafedocentro.example', '(11) 3344-5050']
    ].map((row, index) => ({ id: `sup-${index + 1}`, name: row[0], contact: row[1], email: row[2], phone: row[3], archived: false, createdAt: created, updatedAt: created }));
    const definitions = [
      ['ESC-001', 'Papel sulfite A4 · 500 folhas', 'Escritório', 'pct', 'sup-1', 20, 2790, 'A-01', 80, 47],
      ['ESC-002', 'Caneta esferográfica azul', 'Escritório', 'cx', 'sup-1', 10, 2490, 'A-02', 24, 16],
      ['TEC-001', 'Mouse sem fio', 'Tecnologia', 'un', 'sup-2', 8, 6590, 'B-01', 20, 8],
      ['TEC-002', 'Teclado USB ABNT2', 'Tecnologia', 'un', 'sup-2', 6, 8990, 'B-02', 12, 8],
      ['TEC-003', 'Cabo HDMI · 2 metros', 'Tecnologia', 'un', 'sup-2', 5, 3290, 'B-03', 15, 15],
      ['EMB-001', 'Caixa de envio · tamanho M', 'Embalagens', 'un', 'sup-3', 30, 450, 'C-01', 200, 82],
      ['EMB-002', 'Fita adesiva transparente', 'Embalagens', 'un', 'sup-3', 12, 790, 'C-02', 40, 23],
      ['LIM-001', 'Álcool 70% · 1 litro', 'Limpeza', 'un', 'sup-4', 10, 1290, 'D-01', 36, 30],
      ['LIM-002', 'Papel toalha interfolhado', 'Limpeza', 'pct', 'sup-4', 15, 1890, 'D-02', 50, 24],
      ['COP-001', 'Café torrado e moído · 500 g', 'Copa', 'pct', 'sup-5', 10, 2290, 'E-01', 40, 22],
      ['COP-002', 'Copo descartável · 200 ml', 'Copa', 'pct', 'sup-5', 8, 690, 'E-02', 25, 25],
      ['ESC-003', 'Bloco de notas adesivas', 'Escritório', 'un', 'sup-1', 12, 1090, 'A-03', 48, 21]
    ];
    const products = definitions.map((row, index) => ({
      id: `prod-${index + 1}`, sku: row[0], name: row[1], category: row[2], unit: row[3], supplierId: row[4], minStock: row[5], unitCostCents: row[6], location: row[7], archived: false, createdAt: created, updatedAt: created
    }));
    const movements = [];
    const append = (product, type, quantity, days, index) => {
      const supplier = suppliers.find(item => item.id === product.supplierId);
      const number = movements.length + 1;
      movements.push({ id: `mov-${number}`, number, type, productId: product.id, productName: product.name, sku: product.sku, unit: product.unit, quantity, unitCostCents: product.unitCostCents, supplierId: supplier.id, supplierName: supplier.name, reason: type === 'entry' ? 'Compra para reposição' : 'Consumo da equipe', reference: type === 'entry' ? `NF-${2040 + index}` : `REQ-${3010 + index}`, note: '', occurredAt: at(days), recordedAt: at(days), actor: index % 3 === 0 ? 'Júlia Mendes' : 'Alex Sander', reversalOf: null });
    };
    products.forEach((product, index) => append(product, 'entry', definitions[index][8], 15 + index / 24, index));
    products.forEach((product, index) => append(product, 'exit', definitions[index][9], 1 + index / 24, index));
    const state = { version: 1, products, suppliers, movements };
    validateState(state);
    return state;
  }

  const api = Object.freeze({ CATEGORIES, UNITS, getStock, getStatus, metrics, createSeed, validateState, createSupplier, updateSupplier, setSupplierArchived, createProduct, updateProduct, setProductArchived, recordMovement, reverseMovement });
  root.StockModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
