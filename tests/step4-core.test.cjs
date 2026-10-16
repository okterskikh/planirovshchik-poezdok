'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), C = require('../script.js');
const input = C.parseCSV(fs.readFileSync(path.join(__dirname, 'fixtures/tasks.csv'), 'utf8'));
const seed = () => C.buildImport(C.emptyState(), C.mappedRows(input, 0, C.mappingFor(input[0].cells, 'tasks'))).state;
test('CSV: точные заголовки, BOM, разделитель, дата и экранирование', () => {
  let s = seed(); s = C.recordResult(s, s.tasks[0].id, 'completed', '2026-10-15', 'Ответ; "да"\nСледующая строка', '2026-10-15');
  const out = C.exportResults(s, 'all'); assert.equal(out.csv.charCodeAt(0), 0xfeff); const rows = C.parseCSV(out.csv);
  assert.deepEqual(rows[0].cells, ['ID задачи', 'Клиент', 'Номер листа', 'Статус', 'Выполнение', 'Дата выполнения', 'Комментарий']);
  assert.equal(rows[1].cells[4], 'TRUE'); assert.equal(rows[1].cells[5], '15.10.2026'); assert.equal(rows[1].cells[6], 'Ответ; "да"\nСледующая строка'); assert.equal(rows[1].cells[2], '001');
});
test('Защита формул, ровно один апостроф и импорт собственного CSV без смены источника', () => {
  for (const text of ['=1+1', '+7 (999)', '- позвонить', '@user', '   - телефон']) {
    let s = seed(); s = C.recordResult(s, s.tasks[0].id, 'completed', '2026-10-15', text, '2026-10-15');
    const csv = C.parseCSV(C.exportResults(s, 'all').csv), mapped = C.mappedRows(csv, 0, C.mappingFor(csv[0].cells, 'tasks'));
    assert.equal(mapped[0].values.comment, text); const result = C.buildImport(s, mapped); assert.equal(result.ready, true); assert.equal(result.state.tasks[0].result.comment, text); assert.deepEqual(result.state.tasks[0].source, s.tasks[0].source);
  }
  assert.equal(C.csvCell("'- текст"), "'- текст"); const csv = C.parseCSV('ID задачи;Клиент;Номер листа;Статус;Выполнение;Дата выполнения;Комментарий\r\nx;x;001;Новая;FALSE;;\'\'-text');
  assert.equal(C.mappedRows(csv, 0, C.mappingFor(csv[0].cells, 'tasks'))[0].values.comment, "''-text"); assert(C.buildImport(seed(), C.mappedRows(csv, 0, C.mappingFor(csv[0].cells, 'tasks'))).blockers.length);
});
test('Все варианты экспорта; снимок передачи старой выгрузки не скрывает новый результат', () => {
  let s = seed(); assert.equal(C.exportResults(s, 'changes').snapshots.length, 1);
  s = C.recordResult(s, s.tasks[0].id, 'failed', '2026-10-15', 'Закрыто', '2026-10-15');
  assert.equal(C.exportResults(s, 'period', '2026-10-15', '2026-10-15').snapshots.length, 1);
  assert.throws(() => C.exportResults(s, 'period', '2026-10-16', '2026-10-15'));
  const registered = C.registerResultsExport(s, C.exportResults(s, 'changes').snapshots); s = registered.state;
  assert.equal(C.exportResults(s, 'changes').snapshots.length, 2);
  s = C.recordResult(s, s.tasks[0].id, 'completed', '2026-10-15', 'Принято', '2026-10-15'); s = C.confirmResultsExport(s, registered.item.id);
  assert.equal(s.tasks[0].lastConfirmedExportResult.outcome, 'failed'); assert.equal(C.exportResults(s, 'changes').snapshots.length, 1);
  const latest = C.registerResultsExport(s, C.exportResults(s, 'changes').snapshots); s = C.confirmResultsExport(latest.state, latest.item.id); assert.equal(C.exportResults(s, 'changes').snapshots.length, 0);
  s.tasks[0].result = { outcome: 'none', date: null, comment: '' }; assert.equal(C.exportResults(s, 'changes').snapshots[0].id, s.tasks[0].id);
});
test('Ожидающие выгрузки и отметки передачи сохраняются в JSON; повреждение отклоняется', () => {
  const base = seed(), next = C.registerResultsExport(base, C.exportResults(base, 'all').snapshots).state;
  assert.equal(C.validateState(JSON.parse(JSON.stringify(next))).pendingResultExports.length, 1);
  const bad = C.clone(next); bad.pendingResultExports[0].snapshots[0].result.comment = 'x'.repeat(4001); assert.throws(() => C.validateState(bad));
  const duplicate = C.clone(next); duplicate.pendingResultExports.push(duplicate.pendingResultExports[0]); assert.throws(() => C.validateState(duplicate));
  assert.throws(() => C.confirmResultsExport(base, 'missing'));
});
test('Копия: новые данные, следующий день, отложение и отсутствие ложного напоминания от метаданных', () => {
  C.setClock(() => new Date('2026-10-15T09:00:00Z'));
  try {
    assert.equal(C.backupReminder(C.emptyState()), false); let s = seed(); assert.equal(C.backupReminder(s), true);
    const snoozed = C.snoozeBackup(s); assert.equal(C.backupReminder(snoozed), false); assert.equal(C.backupReminder(snoozed, '2026-10-16'), true);
    s = C.markBackup(s); s.revision += 1; assert.equal(C.backupReminder(s, '2026-10-16'), false);
    s = C.setNote(s, s.tasks[0].id, 'Изменилось'); assert.equal(C.backupReminder(s), false); assert.equal(C.backupReminder(s, '2026-10-16'), true);
    assert.equal(C.backupReminder(C.markBackup(s), '2026-10-17'), false);
    s.tasks[0].history.push({ id: 'big', type: 'test', at: C.now(), changes: 'x'.repeat(1024 * 1024) }); assert.equal(C.backupReminder(C.markBackup(s)), true);
  } finally { C.setClock(() => new Date()); }
});
test('Ссылка карты кодирует адрес и работает при пустом адресе', () => {
  assert.equal(new URL(C.mapUrl({ address: 'Москва, ул. Тестовая 1 & 2' })).searchParams.get('text'), 'Москва, ул. Тестовая 1 & 2');
  assert.equal(new URL(C.mapUrl({ name: 'Суд А', metro: 'Метро', location: '' })).searchParams.get('text'), 'Суд А Метро');
});
