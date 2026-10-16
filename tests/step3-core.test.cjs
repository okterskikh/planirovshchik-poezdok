'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), C = require('../script.js');
const csv = C.parseCSV(fs.readFileSync(path.join(__dirname, 'fixtures/tasks.csv'), 'utf8'));
const rows = C.mappedRows(csv, 0, C.mappingFor(csv[0].cells, 'tasks'));
const seed = () => C.buildImport(C.emptyState(), rows).state;
test('Готовность документов индивидуально, группой, без изменения источника; отмена с историей', () => {
  const s = seed(), ids = s.tasks.slice(0, 2).map(t => t.id); let next = C.setDocuments(s, ids, true);
  assert(next.tasks.slice(0, 2).every(t => t.documentsReady)); assert.equal(s.tasks[0].documentsReady, false); assert.deepEqual(next.tasks[0].source, s.tasks[0].source);
  next = C.setDocuments(next, [ids[0]], false); assert.equal(next.tasks[1].documentsReady, true);
  const restored = C.undoPlanning(next, s); assert(restored.tasks.slice(0, 2).every(t => !t.documentsReady)); assert.equal(restored.tasks[1].history.at(-1).type, 'undo-documents');
  assert.throws(() => C.setDocuments(s, ['missing'], true)); assert.throws(() => C.setDocuments(s, ids, 1));
});
test('Заметка: границы, очистка, поиск, отмена и JSON', () => {
  const s = seed(), id = s.tasks[0].id, note = 'Кабинет 25\n' + 'я'.repeat(1989); assert.equal(note.length, 2000);
  const next = C.setNote(s, id, note); assert.deepEqual(next.tasks[0].source, s.tasks[0].source); assert.equal(C.filterTasks(next, { search: 'Кабинет 25' }).length, 1);
  assert.throws(() => C.setNote(s, id, note + 'я')); assert.equal(C.setNote(next, id, '').tasks[0].localNote, '');
  assert.equal(C.undoPlanning(next, s).tasks[0].localNote, ''); assert.equal(C.validateState(JSON.parse(JSON.stringify(next))).tasks[0].localNote, note);
});
test('Результат: валидация даты, причины, длины и запрет изменения завершённого', () => {
  const s = seed(), id = s.tasks[0].id;
  for (const [outcome, date, comment] of [['failed', '2026-10-15', '   '], ['completed', '2026-10-16', ''], ['completed', '', ''], ['completed', '2026-02-30', ''], ['cancelled', '2026-10-15', ''], ['completed', '2026-10-15', 'x'.repeat(4001)]]) assert.throws(() => C.recordResult(s, id, outcome, date, comment, '2026-10-15'));
  const next = C.recordResult(s, id, 'completed', '2026-10-15', 'x'.repeat(4000), '2026-10-15'); assert.equal(next.tasks[0].documentsReady, false); assert.equal(next.tasks[0].result.outcome, 'completed');
  assert.throws(() => C.recordResult(next, id, 'failed', '2026-10-15', 'Причина', '2026-10-15')); assert.equal(s.tasks[0].result.outcome, 'none');
});
test('Выполнение исключает из поездки, пересортировывает день и удаляет пустую поездку', () => {
  let s = seed(); const a = s.tasks[0], b = s.tasks[1]; b.source.destinationId = s.destinations.find(p => p.id !== a.source.destinationId).id;
  s = C.planTasks(s, [a.id, b.id], '2026-10-15', { today: '2026-10-15' }); s = C.recordResult(s, b.id, 'completed', '2026-10-15', '', '2026-10-15');
  assert.equal(C.trips(s, '2026-10-15').length, 1); assert.equal(C.trips(s, '2026-10-15')[0].tasks[0].id, a.id);
  s = C.recordResult(s, a.id, 'completed', '2026-10-15', '', '2026-10-15'); assert.equal(C.trips(s, '2026-10-15').length, 0); assert.equal(C.rollover(s, '2026-10-16').count, 0);
});
test('Повторные попытки: история, активность, перепланирование и перенос', () => {
  let s = seed(), id = s.tasks[0].id; s = C.planTasks(s, [id], '2026-10-15', { today: '2026-10-15' });
  s = C.recordResult(s, id, 'failed', '2026-10-15', 'Закрыто', '2026-10-15'); s = C.recordResult(s, id, 'failed', '2026-10-15', 'Нет приёма', '2026-10-15');
  assert.equal(s.tasks[0].history.filter(h => h.type === 'failed').length, 2); assert.equal(s.tasks[0].result.comment, 'Нет приёма'); assert.equal(C.status(s.tasks[0]), 'failed');
  s = C.rollover(s, '2026-10-16').state; assert.equal(s.tasks[0].plannedDate, '2026-10-16'); assert.equal(s.tasks[0].result.comment, 'Нет приёма');
});
test('Завершение приоритетной задачи снижает приоритет оставшейся поездки и меняет порядок', () => {
  let s = seed(); const a = s.tasks[0], b = s.tasks[1], other = C.clone(a); other.id = 'OTHER'; other.source.destinationId = s.destinations.find(p => p.id !== a.source.destinationId).id; other.source.priority = 'high'; s.tasks.push(other);
  s = C.setTaskPriority(s, [b.id], 'urgent'); s = C.planTasks(s, [a.id, b.id, other.id], '2026-10-15', { today: '2026-10-15' });
  assert.equal(C.trips(s, '2026-10-15')[0].destination.id, a.source.destinationId);
  s = C.recordResult(s, b.id, 'completed', '2026-10-15', '', '2026-10-15');
  assert.equal(C.trips(s, '2026-10-15')[0].destination.id, other.source.destinationId); assert.equal(C.trips(s, '2026-10-15')[1].priority, 'normal');
});
test('Повторный импорт после результата сохраняет документы, заметку и выполнение; изменённый результат конфликтует', () => {
  let s = seed(), id = s.tasks[0].id; s = C.setDocuments(s, [id], true); s = C.setNote(s, id, 'Окно 3'); s = C.recordResult(s, id, 'completed', '2026-10-15', 'Готово', '2026-10-15');
  const imported = C.buildImport(s, rows); assert.equal(imported.ready, true); assert.equal(imported.state.tasks[0].result.outcome, 'completed'); assert.equal(imported.state.tasks[0].documentsReady, true); assert.equal(imported.state.tasks[0].localNote, 'Окно 3');
  const modified = C.clone(rows); modified[0].values.status = 'Не удалось выполнить'; modified[0].values.done = ''; modified[0].values.resultDate = '15.10.2026'; modified[0].values.comment = 'Другая попытка';
  assert.equal(C.buildImport(imported.state, modified).questions.filter(q => q.type === 'result').length, 1);
});
