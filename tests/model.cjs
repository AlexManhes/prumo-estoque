'use strict';
const assert = require('node:assert/strict');
const M = require('../js/model.js');
const NOW = '2026-10-20T15:00:00.000Z';
const LATER = '2026-10-20T16:00:00.000Z';
const empty = () => ({ version: 1, products: [], suppliers: [], movements: [] });
let passed = 0;
function test(name, run) { run(); passed += 1; console.log(`✓ ${name}`); }
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  let state = M.createSupplier(empty(), { name: 'Fornecedor exemplo', email: 'vendas@example.com' }, NOW);
  state = M.createProduct(state, { sku: 'ABC-01', name: 'Produto exemplo', category: 'Escritório', unit: 'un', supplierId: 'sup-1', minStock: 3, unitCostCents: 1990, location: 'A-01' }, NOW);
  return state;
}
const entry = (state, quantity = 10, extra = {}) => M.recordMovement(state, { type: 'entry', productId: 'prod-1', quantity, reason: 'Compra de teste', ...extra }, NOW);
const exit = (state, quantity, extra = {}) => M.recordMovement(state, { type: 'exit', productId: 'prod-1', quantity, reason: 'Consumo de teste', ...extra }, LATER);

test('seed válido, alertas e saldos derivados do histórico', () => {
  const state = M.createSeed(NOW);
  assert.equal(M.validateState(state), true);
  assert.equal(state.products.length, 12);
  assert.equal(state.suppliers.length, 5);
  assert.equal(state.movements.length, 24);
  const metrics = M.metrics(state, NOW);
  assert.equal(metrics.activeProducts, 12);
  assert.equal(metrics.emptyCount, 2);
  assert.equal(metrics.lowCount, 5);
  assert.equal(metrics.totalUnits, state.products.reduce((sum, product) => sum + M.getStock(state, product.id), 0));
  assert.equal(M.getStatus(state, 'prod-5'), 'empty');
  assert.equal(M.getStatus(state, 'prod-2'), 'low');
  assert.equal(M.getStatus(state, 'prod-1'), 'healthy');
});

test('cadastros e movimentações são imutáveis e sem saldo editável', () => {
  const initial = fixture();
  const snapshot = copy(initial);
  const next = entry(initial);
  assert.deepEqual(initial, snapshot);
  assert.equal(M.getStock(initial, 'prod-1'), 0);
  assert.equal(M.getStock(next, 'prod-1'), 10);
  assert.equal(own(next.products[0], 'stock'), false);
  next.suppliers[0].name = 'Mudou';
  assert.equal(initial.suppliers[0].name, 'Fornecedor exemplo');
});
function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

test('saídas impedem saldo negativo e preservam o estado em erros', () => {
  const state = entry(fixture(), 5);
  const before = copy(state);
  assert.throws(() => exit(state, 6), /Saldo insuficiente/);
  assert.deepEqual(state, before);
  const zero = exit(state, 5);
  assert.equal(M.getStock(zero, 'prod-1'), 0);
  assert.equal(M.getStatus(zero, 'prod-1'), 'empty');
});

test('quantidades, centavos e mínimos exigem inteiros positivos ou não negativos', () => {
  const state = fixture();
  for (const quantity of [0, -1, 1.5, NaN, Infinity, '2', Number.MAX_SAFE_INTEGER]) assert.throws(() => entry(state, quantity));
  for (const cost of [-1, 19.9, NaN, Infinity, '1990']) assert.throws(() => entry(state, 1, { unitCostCents: cost }));
  for (const minStock of [-1, 1.5, '3']) assert.throws(() => M.updateProduct(state, 'prod-1', { minStock }, NOW));
  const noCost = entry(M.updateProduct(state, 'prod-1', { unitCostCents: 0 }, NOW), 1);
  assert.equal(noCost.movements[0].unitCostCents, 0);
});

test('SKU único inclui arquivados e histórico fixa SKU e unidade', () => {
  let state = fixture();
  const input = { ...state.products[0], sku: 'abc-01', name: 'Outro produto' };
  assert.throws(() => M.createProduct(state, input, NOW), /SKU já/);
  state = M.setProductArchived(state, 'prod-1', true, NOW);
  assert.throws(() => M.createProduct(state, input, NOW), /SKU já/);
  state = M.setProductArchived(state, 'prod-1', false, NOW);
  state = entry(state);
  assert.throws(() => M.updateProduct(state, 'prod-1', { sku: 'NEW-01' }, NOW), /SKU e unidade/);
  assert.throws(() => M.updateProduct(state, 'prod-1', { unit: 'cx' }, NOW), /SKU e unidade/);
  const renamed = M.updateProduct(state, 'prod-1', { name: 'Produto atualizado', unitCostCents: 2500 }, NOW);
  assert.equal(renamed.movements[0].productName, 'Produto exemplo');
  assert.equal(renamed.movements[0].unitCostCents, 1990);
  assert.equal(M.metrics(renamed, NOW).inventoryValueCents, 25000);
});

test('fornecedores ativos, referências e arquivamento são consistentes', () => {
  let state = fixture();
  assert.throws(() => M.setSupplierArchived(state, 'sup-1', true, NOW), /produtos ativos/);
  assert.throws(() => M.updateProduct(state, 'prod-1', { supplierId: 'missing' }, NOW), /Fornecedor não encontrado/);
  state = M.updateProduct(state, 'prod-1', { supplierId: null }, NOW);
  assert.throws(() => entry(state), /Selecione um fornecedor/);
  state = M.setSupplierArchived(state, 'sup-1', true, NOW);
  assert.throws(() => entry(state, 1, { supplierId: 'sup-1' }), /fornecedor ativo/);
  assert.throws(() => M.updateProduct(state, 'prod-1', { supplierId: 'sup-1' }, NOW), /fornecedor ativo/);
  state = M.setSupplierArchived(state, 'sup-1', false, NOW);
  state = entry(state, 1, { supplierId: 'sup-1' });
  const renamed = M.updateSupplier(state, 'sup-1', { name: 'Novo nome do fornecedor' }, LATER);
  assert.equal(renamed.movements[0].supplierName, 'Fornecedor exemplo');
});

test('produtos com saldo não arquivam e produtos arquivados não movimentam', () => {
  const loaded = entry(fixture(), 3);
  assert.throws(() => M.setProductArchived(loaded, 'prod-1', true, NOW), /saldo precisa/);
  const archived = M.setProductArchived(exit(loaded, 3), 'prod-1', true, LATER);
  assert.equal(M.metrics(archived, LATER).activeProducts, 0);
  assert.throws(() => entry(archived), /Reative o produto/);
  const active = M.setProductArchived(archived, 'prod-1', false, LATER);
  assert.equal(M.getStock(active, 'prod-1'), 0);
});

test('produto arquivado preserva fornecedor histórico ao editar; reativação exige vínculo ativo', () => {
  let state = M.setProductArchived(fixture(), 'prod-1', true, NOW);
  state = M.setSupplierArchived(state, 'sup-1', true, NOW);
  const original = copy(state);
  const edited = M.updateProduct(state, 'prod-1', { name: 'Produto arquivado revisado', location: 'Reserva B-03', minStock: 5 }, LATER);
  assert.deepEqual(state, original);
  assert.equal(edited.products[0].name, 'Produto arquivado revisado');
  assert.equal(edited.products[0].location, 'Reserva B-03');
  assert.equal(edited.products[0].minStock, 5);
  assert.equal(edited.products[0].supplierId, 'sup-1');
  assert.equal(edited.products[0].archived, true);
  assert.equal(M.validateState(edited), true);
  assert.throws(() => M.setProductArchived(edited, 'prod-1', false, LATER), /fornecedor ativo/);
  assert.throws(() => M.createProduct(edited, { ...edited.products[0], sku: 'NOVO-01' }, LATER), /fornecedor ativo/);

  state = M.createSupplier(edited, { name: 'Outro fornecedor arquivado' }, LATER);
  state = M.setSupplierArchived(state, 'sup-2', true, LATER);
  assert.throws(() => M.updateProduct(state, 'prod-1', { supplierId: 'sup-2' }, LATER), /fornecedor ativo/);

  const supplierReactivated = M.setSupplierArchived(edited, 'sup-1', false, LATER);
  assert.equal(M.setProductArchived(supplierReactivated, 'prod-1', false, LATER).products[0].archived, false);

  state = M.createSupplier(edited, { name: 'Fornecedor ativo para reposição' }, LATER);
  state = M.updateProduct(state, 'prod-1', { supplierId: 'sup-2' }, LATER);
  state = M.setProductArchived(state, 'prod-1', false, LATER);
  assert.equal(state.products[0].supplierId, 'sup-2');
  assert.equal(state.products[0].archived, false);
  assert.equal(M.validateState(state), true);
});

test('estorno adiciona movimento oposto, preserva rastro e exige motivo', () => {
  const state = entry(fixture(), 10, { reference: 'NF-123', unitCostCents: 2300, actor: 'Júlia Mendes' });
  const original = copy(state.movements[0]);
  assert.throws(() => M.reverseMovement(state, original.id, { reason: '' }, LATER), /Motivo/);
  const reversed = M.reverseMovement(state, original.id, { reason: 'Nota fiscal cancelada', actor: 'Alex Sander' }, LATER);
  assert.deepEqual(reversed.movements[0], original);
  assert.equal(reversed.movements.length, 2);
  assert.equal(M.getStock(reversed, 'prod-1'), 0);
  const reversal = reversed.movements[1];
  assert.equal(reversal.type, 'exit');
  assert.equal(reversal.reversalOf, original.id);
  for (const field of ['quantity', 'unitCostCents', 'supplierId', 'supplierName', 'sku', 'productName', 'reference']) assert.equal(reversal[field], original[field]);
  assert.throws(() => M.reverseMovement(reversed, original.id, { reason: 'Novamente' }, LATER), /já foi estornada/);
  assert.throws(() => M.reverseMovement(reversed, reversal.id, { reason: 'Novamente' }, LATER), /não pode ser estornado/);
});

test('estorno respeita saldo e pode recompor uma saída', () => {
  const state = exit(entry(fixture(), 10), 8);
  assert.throws(() => M.reverseMovement(state, 'mov-1', { reason: 'Compra cancelada' }, LATER), /Saldo insuficiente/);
  const reversed = M.reverseMovement(state, 'mov-2', { reason: 'Devolução da equipe' }, LATER);
  assert.equal(M.getStock(reversed, 'prod-1'), 10);
  assert.equal(reversed.movements[2].type, 'entry');
});

test('estorno mantém fornecedor histórico depois da troca e arquivamento', () => {
  let state = exit(entry(fixture(), 10), 2);
  state = M.updateProduct(state, 'prod-1', { supplierId: null }, LATER);
  state = M.setSupplierArchived(state, 'sup-1', true, LATER);
  state = M.reverseMovement(state, 'mov-2', { reason: 'Devolução do material' }, LATER);
  assert.equal(M.getStock(state, 'prod-1'), 10);
  assert.equal(state.movements[2].supplierId, 'sup-1');
  assert.equal(M.validateState(state), true);
});

test('estorno de uma saída sem fornecedor recompõe saldo sem inventar fornecedor', () => {
  let state = entry(fixture(), 10);
  state = M.updateProduct(state, 'prod-1', { supplierId: null }, NOW);
  state = exit(state, 2);
  assert.equal(state.movements[1].supplierId, null);
  state = M.reverseMovement(state, 'mov-2', { reason: 'Devolução ao estoque' }, LATER);
  assert.equal(state.movements[2].supplierId, null);
  assert.equal(M.getStock(state, 'prod-1'), 10);
  assert.equal(M.validateState(state), true);
});

test('datas inválidas e futuras são recusadas; registro e ocorrência são separados', () => {
  const state = fixture();
  assert.throws(() => entry(state, 1, { occurredAt: LATER }), /data futura/);
  assert.throws(() => entry(state, 1, { occurredAt: 'ontem' }), /Data da movimentação inválida/);
  const backdated = entry(state, 1, { occurredAt: '2026-10-19T12:00:00.000Z' });
  assert.equal(backdated.movements[0].occurredAt, '2026-10-19T12:00:00.000Z');
  assert.equal(backdated.movements[0].recordedAt, NOW);
  assert.throws(() => M.updateProduct(state, 'prod-1', { name: 'Novo nome' }, '2026-10-19T12:00:00.000Z'), /última atualização/);
});

test('métricas mensais seguem São Paulo na virada do mês', () => {
  const date = '2026-10-01T03:30:00.000Z';
  let state = M.createSupplier(empty(), { name: 'Fornecedor exemplo' }, '2026-09-01T12:00:00.000Z');
  state = M.createProduct(state, { sku: 'ABC-01', name: 'Produto exemplo', category: 'Copa', unit: 'un', supplierId: 'sup-1', minStock: 2, unitCostCents: 100 }, '2026-09-01T12:00:00.000Z');
  state = M.recordMovement(state, { type: 'entry', productId: 'prod-1', quantity: 9, reason: 'Compra setembro', occurredAt: '2026-10-01T02:00:00.000Z' }, date);
  state = M.recordMovement(state, { type: 'entry', productId: 'prod-1', quantity: 4, reason: 'Compra outubro', occurredAt: date }, date);
  state = M.recordMovement(state, { type: 'exit', productId: 'prod-1', quantity: 2, reason: 'Consumo outubro', occurredAt: date }, date);
  const metrics = M.metrics(state, date);
  assert.equal(metrics.entriesMonth, 4);
  assert.equal(metrics.exitsMonth, 2);
  assert.equal(metrics.totalUnits, 11);
  assert.equal(metrics.inventoryValueCents, 1100);
});

test('estado salvo faz round trip sem perder vínculos ou estornos', () => {
  let state = exit(entry(fixture()), 4);
  state = M.reverseMovement(state, 'mov-2', { reason: 'Devolução de unidades' }, LATER);
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(M.validateState(restored), true);
  assert.deepEqual(M.metrics(restored, LATER), M.metrics(state, LATER));
  assert.equal(M.getStock(restored, 'prod-1'), 10);
});

test('validação recusa adulteração de referências, duplicatas, sequência e saldo', () => {
  const state = entry(fixture(), 5);
  const broken = modify => { const next = copy(state); modify(next); assert.throws(() => M.validateState(next)); };
  broken(next => { next.products[0].supplierId = 'inexistente'; });
  broken(next => { next.products.push(copy(next.products[0])); });
  broken(next => { next.movements[0].type = 'exit'; });
  broken(next => { next.movements[0].quantity = 0.5; });
  broken(next => { next.movements[0].unitCostCents = 19.9; });
  broken(next => { next.movements[0].sku = 'OUTRO'; });
  broken(next => { next.movements[0].recordedAt = '2026-10-20'; });
  broken(next => { next.movements.push({ ...copy(next.movements[0]), id: 'outra' }); });
  broken(next => { next.products[0].unit = 'constructor'; });
  broken(next => { next.products[0].archived = true; });
  broken(next => { next.movements[0].reversalOf = 'não existe'; });
});

test('estornos adulterados ou duplicados são rejeitados na restauração', () => {
  const original = entry(fixture(), 5);
  const state = M.reverseMovement(original, 'mov-1', { reason: 'Correção de lançamento' }, LATER);
  const tampered = copy(state); tampered.movements[1].quantity = 4;
  assert.throws(() => M.validateState(tampered), /preservar/);
  const duplicated = copy(state); duplicated.movements.push({ ...copy(state.movements[1]), id: 'mov-3', number: 3 });
  assert.throws(() => M.validateState(duplicated), /Estorno inválido ou duplicado/);
});

test('entradas e saídas sequenciais conferem o livro de estoque independente', () => {
  let state = fixture();
  let balance = 0;
  for (let i = 1; i <= 20; i += 1) {
    state = entry(state, i);
    balance += i;
    const take = Math.floor(i / 2);
    if (take) { state = exit(state, take); balance -= take; }
    assert.equal(M.getStock(state, 'prod-1'), balance);
  }
  assert.equal(M.validateState(state), true);
});
console.log(`\n${passed} grupos de testes passaram.`);
