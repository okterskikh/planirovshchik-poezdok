'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const C = require('../script.js'), fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/iphone-check.json'), 'utf8'));
const seed = () => C.clone(fixture);
const choose = (a, b, side = 'file') => Object.fromEntries(C.mergeCopies(a, b).conflicts.map(c => [c.key, typeof side === 'function' ? side(c) : side]));
const merge = (a, b, side = 'file') => C.mergeCopies(a, b, choose(a, b, side));
test('Идентичная копия: нет конфликтов, изменений, событий и мутации входа', () => {
  const a = seed(), before = JSON.stringify(a), out = C.mergeCopies(a, a);
  assert.equal(out.ready, true); assert.equal(out.changed, false); assert.deepEqual(out.state, a); assert.equal(JSON.stringify(a), before);
});
test('Новая схема, другая область и повреждённая копия отклоняются', () => {
  const a = seed(); assert.throws(() => C.mergeCopies(a, { ...a, workspaceId: 'other' }), /другая рабочая область/);
  assert.throws(() => C.mergeCopies(a, { ...a, schemaVersion: 999 }), /более новой/);
  assert.throws(() => C.mergeCopies(a, { ...a, tasks: null }), /список/);
});
test('Шесть независимых групп: обязательный выбор и сочетание версий', () => {
  const a = seed(), b = seed(), t = b.tasks[0];
  t.source.description = 'Исправленное поручение'; t.lastCsvResult.comment = 'снимок таблицы';
  t.plannedDate = t.firstPlannedDate = '2026-10-19'; t.documentsReady = true; t.localNote = 'Окно 5';
  t.result = { outcome: 'completed', date: '2026-10-15', comment: 'Принято' }; t.localPriority = 'urgent';
  const pending = C.mergeCopies(a, b); assert.equal(pending.ready, false); assert.equal(pending.conflicts.filter(c => c.kind === 'task').length, 6);
  const out = merge(a, b, c => c.key.includes('source') || c.key.includes('schedule') ? 'local' : 'file');
  assert.equal(out.ready, true); assert.equal(out.state.tasks[0].source.description, a.tasks[0].source.description);
  assert.equal(out.state.tasks[0].plannedDate, null); assert.equal(out.state.tasks[0].documentsReady, true);
  assert.equal(out.state.tasks[0].localNote, 'Окно 5'); assert.equal(out.state.tasks[0].localPriority, 'urgent'); assert.equal(out.state.tasks[0].result.outcome, 'completed');
  assert.equal(out.state.tasks[0].history.filter(e => e.type === 'copy-merge').length, 1);
});
test('Изменения устройств не выбираются автоматически по времени или revision', () => {
  const a = seed(), b = seed(); a.revision = 999; b.revision = 1; b.lastBackupExport = '2099-01-01T00:00:00Z'; b.tasks[0].localNote = 'Из файла';
  const out = C.mergeCopies(a, b); assert.equal(out.ready, false); assert.equal(out.state.tasks[0].localNote, a.tasks[0].localNote);
  const selected = merge(a, b); assert.equal(selected.state.tasks[0].localNote, 'Из файла'); assert.equal(selected.state.revision, 999); assert.equal(selected.state.lastBackupExport, a.lastBackupExport);
});
test('Новые задачи добавляются, отсутствующие остаются, неизвестные места добавляются', () => {
  const a = seed(), b = seed(), t = C.clone(b.tasks[0]); t.id = 'NEW';
  const p = { id: 'new-place', name: 'Новый суд', address: '', metro: '', location: '', aliases: [] }; b.destinations.push(p); t.source.destinationId = p.id; b.tasks = [t];
  const out = merge(a, b); assert.equal(out.summary.newTasks, 1); assert.equal(out.state.tasks.length, a.tasks.length + 1); assert(out.state.destinations.some(p => p.id === 'new-place'));
});
test('История объединяется по ID, конфликт одного ID требует отдельного выбора', () => {
  const a = seed(), b = seed(); const e = { id: 'phone-event', type: 'note', at: '2026-10-15T10:00:00Z', changes: { after: 'телефон' } }; b.tasks[0].history.push(e);
  let out = merge(a, b); assert.equal(out.state.tasks[0].history.filter(h => h.id === e.id).length, 1);
  assert.equal(merge(out.state, b).changed, false);
  const other = C.clone(out.state); other.tasks[0].history.find(h => h.id === e.id).changes.after = 'другое';
  const conflict = C.mergeCopies(out.state, other); assert(conflict.conflicts.some(c => c.kind === 'history')); assert.equal(conflict.ready, false);
  out = merge(out.state, other); assert.equal(out.state.tasks[0].history.find(h => h.id === e.id).changes.after, 'другое');
});
test('Повторный обмен с теми же выборами не создаёт изменений или дублей', () => {
  const a = seed(), b = seed(); b.tasks[0].localNote = 'Из телефона'; b.tasks[1].documentsReady = true;
  const out = merge(a, b).state, again = merge(out, b); assert.equal(again.changed, false); assert.deepEqual(again.state, out);
  const keep = merge(a, b, 'local'); assert.equal(keep.changed, false);
});
test('Необязательный приоритет null/отсутствие и порядок ключей не создают ложных конфликтов', () => {
  const a = seed(), b = seed(); b.tasks[0].localPriority = null; b.tasks[0].source = Object.fromEntries(Object.entries(b.tasks[0].source).reverse());
  assert.equal(C.mergeCopies(a, b).conflicts.length, 0); assert.equal(C.mergeCopies(a, b).changed, false);
});
test('Расписание и firstPlannedDate выбираются вместе', () => {
  const a = seed(), b = seed(); b.tasks[0].plannedDate = '2026-10-20'; b.tasks[0].firstPlannedDate = '2026-10-19';
  const out = merge(a, b); assert.equal(out.state.tasks[0].plannedDate, '2026-10-20'); assert.equal(out.state.tasks[0].firstPlannedDate, '2026-10-19');
});
test('Справочник и порядок дня выбираются целиком, ручной порядок сохраняется', () => {
  const a = seed(), b = seed(), [p, q] = a.destinations; a.dayOrders['2026-10-19'] = [p.id, q.id]; b.dayOrders['2026-10-19'] = [q.id, p.id]; b.destinations[0].address = 'Другой адрес';
  const out = C.mergeCopies(a, b); assert(out.conflicts.some(c => c.kind === 'place')); assert(out.conflicts.some(c => c.kind === 'order'));
  const done = merge(a, b, c => c.kind === 'order' ? 'file' : 'local'); assert.deepEqual(done.state.dayOrders['2026-10-19'], [q.id, p.id]); assert.equal(done.state.destinations[0].address, p.address);
});
test('Порядок, существующий только в одной копии, тоже требует выбора', () => {
  const a = seed(), b = seed(); b.dayOrders['2026-10-19'] = [b.destinations[0].id];
  assert(C.mergeCopies(a, b).conflicts.some(c => c.kind === 'order')); const out = merge(a, b, 'local'); assert.equal(out.changed, false);
});
test('Один суд с разными ID связывается по имени, ссылки задачи/порядка/алиаса переназначаются', () => {
  const a = seed(), b = seed(), oldId = b.destinations[0].id, canonical = a.destinations[0].id;
  b.destinations[0].id = 'independent-id'; b.destinations[0].name = '  ' + b.destinations[0].name.toUpperCase() + '  ';
  b.tasks.forEach(t => { if (t.source.destinationId === oldId) t.source.destinationId = 'independent-id'; });
  for (const k of Object.keys(b.destinationAliases)) if (b.destinationAliases[k] === oldId) b.destinationAliases[k] = 'independent-id';
  b.dayOrders['2026-10-19'] = ['independent-id']; const out = merge(a, b);
  assert.equal(out.state.destinations.length, a.destinations.length); assert.equal(out.state.tasks[0].source.destinationId, canonical); assert.deepEqual(out.state.dayOrders['2026-10-19'], [canonical]);
  assert.equal(merge(out.state, b).changed, false);
});
test('Разные названия с одинаковым адресом не объединяются', () => {
  const a = seed(), b = seed(); b.destinations.push({ ...C.clone(b.destinations[0]), id: 'other', name: 'Другой суд' });
  assert(merge(a, b).state.destinations.some(p => p.id === 'other'));
});
test('Настройки, алиасы, ожидающие выгрузки: новые добавляются, различия показываются', () => {
  let a = seed(), b = seed(); b.excludedDates = ['2026-10-19']; b.importMappings.tasks = { id: 'Другое имя ID' };
  b = C.registerResultsExport(b, [{ id: b.tasks[0].id, result: b.tasks[0].result }]).state;
  const out = merge(a, b); assert.deepEqual(out.state.excludedDates, b.excludedDates); assert.equal(out.state.pendingResultExports.length, 1);
  assert.equal(out.state.lastConfirmedResultsExport, a.lastConfirmedResultsExport); assert.equal(merge(out.state, b).changed, false);
});
test('Объединённый результат и связанные снимки не ломают импорт/CSV/JSON', () => {
  const a = seed(), b = seed(); b.tasks[0].result = { outcome: 'completed', date: '2026-10-15', comment: 'Принято' }; b.tasks[0].lastConfirmedExportResult = C.clone(b.tasks[0].result);
  const out = merge(a, b).state; C.validateState(JSON.parse(JSON.stringify(out))); assert(C.exportResults(out, 'all').snapshots.some(t => t.id === b.tasks[0].id));
  assert.equal(C.mergeResult(out.tasks[0].lastCsvResult, out.tasks[0].result, out.tasks[0].lastCsvResult), 'local');
});
test('Ошибка записи объединения сохраняет прежние данные и кандидата', () => {
  const a = seed(), b = seed(); b.tasks[0].localNote = 'Несохранённое'; let raw = JSON.stringify(a);
  const store = new C.Store({ getItem: () => raw, setItem: () => { throw new Error('quota'); } }); const candidate = merge(a, b).state;
  assert.equal(store.commit(candidate), false); assert.equal(raw, JSON.stringify(a)); assert.deepEqual(store.state, a); assert.equal(store.candidate.tasks[0].localNote, 'Несохранённое');
});
