'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../script.js');
function seed() {
  const state = C.emptyState();
  for (const [index, name] of ['A', 'B', 'C', 'D'].entries()) {
    state.destinations.push({ id: name, name: 'Суд ' + name, address: '', metro: '', location: '', aliases: [] });
    state.tasks.push({ id: 'TASK-' + name, source: { createdBy: 'Тест', createdDate: '2026-10-01', client: 'Клиент ' + name, documentNumber: '001', description: '', destinationId: name, priority: index ? 'high' : 'normal' }, plannedDate: null, firstPlannedDate: null, documentsReady: false, localNote: '', result: { outcome: 'none', date: null, comment: '' }, lastCsvResult: { outcome: 'none', date: null, comment: '' }, lastConfirmedExportResult: null, history: [] });
  }
  C.validateState(state); return state;
}
test('Московская дата, начало недели, високосный день и смена года', () => {
  C.setClock(() => new Date('2026-10-14T21:05:00Z')); assert.equal(C.today(), '2026-10-15'); C.setClock(() => new Date());
  assert.equal(C.weekStart('2026-10-18'), '2026-10-12'); assert.equal(C.addDays('2024-02-28', 1), '2024-02-29'); assert.equal(C.addDays('2024-02-29', 1), '2024-03-01'); assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
});
test('Назначение, объединение по суду, снятие даты и сохранение локальных полей', () => {
  const state = seed(); state.tasks[1].source.destinationId = 'A'; state.tasks[0].documentsReady = true; state.tasks[0].localNote = 'Не потерять';
  const next = C.planTasks(state, ['TASK-A', 'TASK-B'], '2026-10-16', { today: '2026-10-15' }); assert.equal(C.trips(next, '2026-10-16').length, 1); assert.equal(C.trips(next, '2026-10-16')[0].tasks.length, 2); assert.equal(next.tasks[0].firstPlannedDate, '2026-10-16');
  const removed = C.planTasks(next, ['TASK-A'], null); assert.equal(C.status(removed.tasks[0]), 'new'); assert.equal(removed.tasks[0].firstPlannedDate, '2026-10-16'); assert.equal(removed.tasks[0].documentsReady, true); assert.equal(removed.tasks[0].localNote, 'Не потерять'); assert.equal(C.trips(removed, '2026-10-16')[0].tasks.length, 1);
  C.validateState(removed);
});
test('Перенос отдельной задачи, целой поездки и исчезновение пустых поездок', () => {
  let state = seed(); state.tasks[1].source.destinationId = 'A'; state = C.planTasks(state, ['TASK-A', 'TASK-B'], '2026-10-16', { today: '2026-10-15' });
  const single = C.planTasks(state, ['TASK-A'], '2026-10-19', { today: '2026-10-15' }); assert.equal(single.tasks[1].plannedDate, '2026-10-16');
  const trip = C.planTasks(single, ['TASK-A', 'TASK-B'], '2026-10-20', { today: '2026-10-15' }); assert.equal(C.trips(trip, '2026-10-16').length, 0); assert.equal(C.trips(trip, '2026-10-19').length, 0); assert.equal(C.trips(trip, '2026-10-20').length, 1);
});
test('Прошедшие даты запрещены, выходные и исключения требуют подтверждения', () => {
  const state = seed(); state.excludedDates = ['2026-10-19'];
  assert.throws(() => C.planTasks(state, ['TASK-A'], '2026-10-14', { today: '2026-10-15' }), /прошедшую/);
  for (const date of ['2026-10-17', '2026-10-19']) { assert.throws(() => C.planTasks(state, ['TASK-A'], date, { today: '2026-10-15' }), /Подтвердите/); assert.equal(C.planTasks(state, ['TASK-A'], date, { today: '2026-10-15', allowNonWorking: true }).tasks[0].plannedDate, date); }
  state.tasks[0].result = { outcome: 'completed', date: '2026-10-15', comment: '' }; assert.throws(() => C.planTasks(state, ['TASK-A'], null), /нельзя/);
});
test('Стабильная сортировка A/B/C/D и ручная правка до следующего добавления', () => {
  let state = C.planTasks(seed(), ['TASK-A', 'TASK-B', 'TASK-C'], '2026-10-16', { today: '2026-10-15' });
  state = C.reorderTrip(state, '2026-10-16', 'A', 0); assert.deepEqual(state.dayOrders['2026-10-16'], ['A', 'B', 'C']);
  state = C.planTasks(state, ['TASK-D'], '2026-10-16', { today: '2026-10-15' }); assert.deepEqual(state.dayOrders['2026-10-16'], ['B', 'C', 'D', 'A']);
  state = C.reorderTrip(state, '2026-10-16', 'A', 0); assert.deepEqual(C.trips(state, '2026-10-16').map(t => t.destination.id), ['A', 'B', 'C', 'D']); C.validateState(state);
});
test('Импорт приоритета пересортировывает день, сохраняя дату и данные задач', () => {
  let state = C.planTasks(seed(), ['TASK-A', 'TASK-B', 'TASK-C', 'TASK-D'], '2026-10-16', { today: '2026-10-15' }); state = C.reorderTrip(state, '2026-10-16', 'A', 0);
  const values = Object.fromEntries(Object.keys(C.HEADERS).map(key => [key, ''])); Object.assign(values, { id: 'TASK-B', client: 'Клиент B', destination: 'Суд B', priority: 'Срочно', status: 'Новая', done: 'FALSE' });
  const imported = C.buildImport(state, [{ line: 2, values }]); assert.equal(imported.ready, true); assert.deepEqual(imported.state.dayOrders['2026-10-16'], ['B', 'C', 'D', 'A']); assert.equal(imported.state.tasks[1].plannedDate, '2026-10-16'); assert(imported.entries.some(e => e.kind === 'order'));
});
test('Автоперенос пятницы, исключение понедельника, пропуск месяца и года', () => {
  let state = C.planTasks(seed(), ['TASK-A'], '2026-10-16', { today: '2026-10-15' });
  let result = C.rollover(state, '2026-10-17'); assert.equal(result.target, '2026-10-19'); assert.equal(result.count, 1); assert.equal(C.rollover(result.state, '2026-10-17').count, 0); assert.equal(result.state.tasks[0].history.filter(h => h.type === 'auto-rollover').length, 1);
  state.excludedDates = ['2026-10-19']; assert.equal(C.rollover(state, '2026-10-17').target, '2026-10-20'); assert.equal(C.rollover(state, '2026-11-02').target, '2026-11-02');
  state.tasks[0].plannedDate = '2026-12-30'; assert.equal(C.rollover(state, '2027-01-01').target, '2027-01-01'); state.excludedDates = ['2027-01-01']; assert.equal(C.rollover(state, '2027-01-01').target, '2027-01-04');
  C.validateState(result.state);
});
test('Завершённые, отменённые, незапланированные и будущие не переносятся; неудачные остаются', () => {
  const state = seed(); state.tasks[0].plannedDate = '2026-10-01'; state.tasks[0].result = { outcome: 'failed', date: '2026-10-01', comment: 'Закрыто' }; state.tasks[0].documentsReady = true;
  state.tasks[1].plannedDate = '2026-10-01'; state.tasks[1].result = { outcome: 'completed', date: '2026-10-02', comment: '' };
  state.tasks[2].plannedDate = '2026-10-01'; state.tasks[2].result = { outcome: 'cancelled', date: null, comment: '' }; state.tasks[3].plannedDate = '2026-10-20';
  const result = C.rollover(state, '2026-10-15'); assert.equal(result.count, 1); assert.equal(result.state.tasks[0].result.comment, 'Закрыто'); assert.equal(result.state.tasks[0].documentsReady, true); assert.equal(result.state.tasks[1].plannedDate, '2026-10-01'); assert.equal(result.state.tasks[3].plannedDate, '2026-10-20'); assert.equal(C.trips(result.state, '2026-10-15')[0].accumulated, 1);
});
test('Отмена восстанавливает план, но сохраняет историю операции и отмены', () => {
  const before = seed(), after = C.planTasks(before, ['TASK-A'], '2026-10-16', { today: '2026-10-15' }), undone = C.undoPlanning(after, before);
  assert.equal(undone.tasks[0].plannedDate, null); assert.deepEqual(undone.tasks[0].history.map(h => h.type), ['schedule', 'undo-plan']); assert.equal(undone.tasks[0].source.documentNumber, '001'); C.validateState(undone);
});
