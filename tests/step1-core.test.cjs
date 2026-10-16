'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../script.js');
const baseText = `ID задачи;Кто направил;Дата направления;Клиент;Номер листа;Место направления;Задача (сколько заявлений, что сделать);Приоритетность;Статус;Выполнение;Дата выполнения;Комментарий
TASK-000001;Сотрудник А;01.10.2026;Клиент А;001;Суд А;Подать заявление;обычный;Новая;FALSE;;
TASK-000002;Сотрудник Б;01.10.2026;Клиент Б;ФС № 2;Суд А;"Передать ""оригинал""; получить отметку";высокая;Новая;FALSE;;
TASK-000003;Сотрудник А;02.10.2026;Клиент В;003;ОСП Б;Передать документы;срочно;Выполнена;TRUE;05.10.2026;Принято`;
function rows(text = baseText) { const records = C.parseCSV(text); return C.mappedRows(records, 0, C.mappingFor(records[0].cells, 'tasks')); }
const baseRows = rows();
const resolutions = { 'place:суд а': 'new', 'place:осп б': 'new' };
function imported() { const a = C.buildImport(C.emptyState(), baseRows, { resolve: resolutions }); assert.equal(a.ready, true); C.validateState(a.state); return a.state; }
function memory(raw = null) { return { raw, getItem() { return this.raw; }, setItem(key, value) { this.raw = value; } }; }
const changeRow = (index, changes) => { const r = C.clone(baseRows); Object.assign(r[index].values, changes); return r; };

test('Базовый CSV: три задачи, две новые, ведущие нули и кавычки', () => {
  const state = imported(); assert.equal(state.tasks.length, 3); assert.equal(state.destinations.length, 2);
  assert.deepEqual(state.tasks.map(C.status), ['new', 'new', 'completed']);
  assert.equal(state.tasks[0].source.documentNumber, '001'); assert.equal(state.tasks[1].source.priority, 'high');
  assert.equal(state.tasks[1].source.description, 'Передать "оригинал"; получить отметку');
});
test('CSV: BOM, CRLF, многострочные поля и номера исходных строк', () => {
  const records = C.parseCSV('\uFEFFA;B\r\n"строка 1\r\nстрока 2";"текст ""да"""\r\n\r\nC;D');
  assert.deepEqual(records.map(r => r.line), [1, 2, 5]); assert.equal(records[1].cells[0], 'строка 1\nстрока 2'); assert.equal(records[1].cells[1], 'текст "да"');
  assert.throws(() => C.parseCSV('A;B\n"открыто'), /Незакрытая/); assert.throws(() => C.parseCSV('A;B\n"x"oops;y'), /после/);
});
test('Автоопределение трёх разделителей', () => {
  for (const sep of [';', ',', '\t']) { const text = ['A', 'B', 'C'].join(sep) + '\n' + ['1', '2', '3'].join(sep); assert.equal(C.detectSeparator(text), sep); assert.equal(C.parseCSV(text, sep)[1].cells.length, 3); }
});
test('Windows-1251: TextDecoder читает кириллицу', () => {
  assert.equal(new TextDecoder('windows-1251').decode(Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])), 'Привет');
});
test('Справочник: заголовки после пустых строк, импорт и обновление', () => {
  const records = C.parseCSV('\nРасположение;;;;\n;;;;\nМесто направления;Метро;Адрес;Расположение\nСуд А;м. А;ул. А, 1;внутри МКАД');
  const header = C.headerIndex(records); assert.equal(records[header].line, 4);
  const r = C.mappedRows(records, header, C.mappingFor(records[header].cells, 'places'));
  const a = C.buildImport(C.emptyState(), r, { type: 'places' }); assert.equal(a.ready, true); assert.equal(a.state.destinations[0].address, 'ул. А, 1');
  const next = C.buildImport(a.state, [{ line: 2, values: { destination: 'Суд А', metro: 'м. А', address: 'ул. А, 2', location: '' } }], { type: 'places' });
  assert.equal(next.questions[0].type, 'address');
  const chosen = C.buildImport(a.state, [{ line: 2, values: { destination: 'Суд А', metro: 'м. А', address: 'ул. А, 2', location: '' } }], { type: 'places', resolve: { 'row:2:address': 'csv' } });
  assert.equal(chosen.ready, true); assert.equal(chosen.state.destinations[0].address, 'ул. А, 2'); assert.equal(chosen.entries[0].kind, 'place-changed');
});
test('Повторный импорт и отсутствие строки не создают дублей или удаления', () => {
  const state = imported(); const a = C.buildImport(state, baseRows); assert.equal(a.ready, true); assert.equal(a.state.tasks.length, 3); assert.equal(a.entries.length, 0);
  const partial = C.buildImport(state, baseRows.slice(1)); assert.equal(partial.state.tasks.length, 3);
});
test('Пустые и повторные ID блокируют даже при исключении строк', () => {
  const duplicate = changeRow(1, { id: 'TASK-000001' }); const a = C.buildImport(C.emptyState(), duplicate, { excluded: [3], resolve: resolutions }); assert.equal(a.ready, false); assert.match(a.blockers[0].message, /Повторный/);
  const blank = C.buildImport(C.emptyState(), changeRow(0, { id: '' }), { resolve: resolutions }); assert.equal(blank.blockers[0].line, 2);
});
test('Пустые строки с FALSE, обычным приоритетом и заготовленным ID не требуют ID задачи', () => {
  const values = Object.fromEntries(Object.keys(baseRows[0].values).map(key => [key, '']));
  const placeholders = [{ line: 8, values: { ...values, done: 'FALSE' } }, { line: 9, values: { ...values, done: '0', status: 'Новая', priority: 'Обычная' } }, { line: 10, values: { ...values, id: 'TASK-000001', done: 'НЕТ' } }];
  const a = C.buildImport(C.emptyState(), [...baseRows, ...placeholders], { resolve: resolutions });
  assert.equal(a.ready, true); assert.equal(a.blockers.length, 0); assert.equal(a.state.tasks.length, 3); assert.equal(a.rowCount, 3); assert.equal(a.ignoredEmptyRows, 3); assert.equal(a.state.lastImport.ignoredEmptyRows, 3);
});
test('Данные задачи или отметка выполнения без ID не игнорируются', () => {
  const values = Object.fromEntries(Object.keys(baseRows[0].values).map(key => [key, '']));
  for (const data of [{ client: 'Клиент' }, { description: 'Подать заявление' }, { done: 'TRUE' }, { status: 'Отменена' }]) {
    const a = C.buildImport(C.emptyState(), [{ line: 18, values: { ...values, ...data } }]); assert.equal(a.ready, false); assert.equal(a.ignoredEmptyRows, 0); assert.equal(a.blockers[0].line, 18);
  }
});
test('Импорт задач работает без отдельного справочника и использует адреса из задач', () => {
  const r = changeRow(0, { metro: 'м. Тестовая', address: 'ул. Примерная, 1', location: 'внутри МКАД' });
  const a = C.buildImport(C.emptyState(), r, { resolve: resolutions }); assert.equal(a.ready, true); assert.equal(a.state.tasks.length, 3); assert.equal(a.state.destinations[0].address, 'ул. Примерная, 1'); assert.equal(a.state.destinations[0].metro, 'м. Тестовая');
});
test('Ошибки дат и обязательных полей можно исключить явно', () => {
  const state = imported(), r = changeRow(0, { createdDate: '31.02.2026' });
  const a = C.buildImport(state, r); assert.equal(a.ready, false); assert.match(a.errors[0].message, /Несуществующая/);
  const b = C.buildImport(state, r, { excluded: [2] }); assert.equal(b.ready, true); assert.equal(b.entries[0].kind, 'skipped'); assert.equal(b.state.tasks[0].source.createdDate, '2026-10-01');
  assert.throws(() => C.parseDate('29.02.2025')); assert.equal(C.parseDate('29.02.24'), '2024-02-29'); assert.equal(C.parseDate('01.01.26'), '2026-01-01');
});
test('Неизвестные словари требуют сопоставления', () => {
  const state = imported(), r = changeRow(0, { priority: 'очень важно', status: 'готово', done: 'TRUE', resultDate: '05.10.26' });
  const a = C.buildImport(state, r); assert.equal(a.questions.length, 2);
  const b = C.buildImport(state, r, { resolve: { 'priority:очень важно': 'urgent', 'status:готово': 'completed' } }); assert.equal(b.ready, true); assert.equal(b.state.tasks[0].source.priority, 'urgent'); assert.equal(b.state.tasks[0].result.outcome, 'completed');
});
test('Служебные ключи объекта не становятся значениями словаря', () => {
  const a = C.buildImport(imported(), changeRow(0, { status: '__proto__' })); assert.equal(a.ready, false); assert.equal(a.questions[0].type, 'status');
});
test('Противоречие статуса и выполнения требует выбора', () => {
  const state = imported(), r = changeRow(0, { done: 'TRUE', resultDate: '05.10.26' });
  assert.equal(C.buildImport(state, r).questions[0].type, 'status-source');
  assert.equal(C.buildImport(state, r, { resolve: { 'row:2:status-source': 'done' } }).state.tasks[0].result.outcome, 'completed');
});
test('Результаты: дата и причина обязательны', () => {
  const state = imported(); assert.match(C.buildImport(state, changeRow(0, { status: 'Выполнена', done: 'TRUE' })).errors[0].message, /дата/);
  assert.match(C.buildImport(state, changeRow(0, { status: 'Не удалось выполнить', resultDate: '05.10.26', comment: '   ' })).errors[0].message, /причина/);
});
test('Все ветви трёхстороннего сравнения', () => {
  const a = { outcome: 'none', date: null, comment: '' }, b = { outcome: 'completed', date: '2026-10-05', comment: '' }, c = { outcome: 'failed', date: '2026-10-05', comment: 'Закрыто' };
  assert.equal(C.mergeResult(null, a, b), 'csv'); assert.equal(C.mergeResult(a, b, a), 'local'); assert.equal(C.mergeResult(a, a, b), 'csv'); assert.equal(C.mergeResult(a, b, b), 'local'); assert.equal(C.mergeResult(a, b, c), 'conflict');
});
test('Локальное выполнение сохраняется, реальный конфликт разрешается один раз', () => {
  const state = imported(); state.tasks[0].result = { outcome: 'completed', date: '2026-10-06', comment: 'Готово' };
  assert.equal(C.buildImport(state, baseRows).questions.length, 0);
  assert.equal(C.buildImport(state, baseRows).state.tasks[0].result.outcome, 'completed');
  const r = changeRow(0, { status: 'Не удалось выполнить', resultDate: '07.10.26', comment: 'Закрыто' });
  assert.equal(C.buildImport(state, r).questions[0].type, 'result');
  const chosen = C.buildImport(state, r, { resolve: { 'row:2:result': 'local' } }); assert.equal(chosen.ready, true);
  assert.equal(C.buildImport(chosen.state, r).questions.length, 0); assert.equal(chosen.state.tasks[0].lastCsvResult.outcome, 'failed');
  const csv = C.buildImport(state, r, { resolve: { 'row:2:result': 'csv' } }); assert.equal(csv.state.tasks[0].result.outcome, 'failed');
});
test('Приоритет, локальные поля и автосортировка при импорте', () => {
  const state = imported(); const t = state.tasks[0]; t.plannedDate = '2026-10-20'; t.firstPlannedDate = t.plannedDate; t.documentsReady = true; t.localNote = 'Кабинет 3'; state.dayOrders[t.plannedDate] = [t.source.destinationId];
  const a = C.buildImport(state, changeRow(0, { priority: 'срочная' })); const next = a.state.tasks[0];
  assert.equal(next.plannedDate, t.plannedDate); assert.equal(next.documentsReady, true); assert.equal(next.localNote, 'Кабинет 3'); assert(a.entries.some(e => e.kind === 'priority'));
  C.validateState(a.state);
});
test('Отмена и возврат: история, дата и готовность', () => {
  const state = imported(); state.tasks[0].plannedDate = '2026-10-20'; state.tasks[0].documentsReady = true; state.tasks[0].localNote = 'Не потерять';
  const cancelled = C.buildImport(state, changeRow(0, { status: 'Отменена' })); assert.equal(cancelled.state.tasks[0].result.outcome, 'cancelled'); assert(cancelled.entries.some(e => e.kind === 'cancelled'));
  const back = C.buildImport(cancelled.state, baseRows); assert.equal(back.state.tasks[0].result.outcome, 'none'); assert.equal(back.state.tasks[0].plannedDate, null); assert.equal(back.state.tasks[0].documentsReady, false); assert.equal(back.state.tasks[0].localNote, 'Не потерять'); assert(back.entries.some(e => e.kind === 'reopened')); assert.equal(back.state.tasks[0].history.length, 3);
});
test('Прежние привязки сохраняются, неизвестные учреждения создаются без ручного выбора', () => {
  const state = imported(), place = state.destinations[0];
  place.aliases.push('Суд А, канцелярия'); state.destinationAliases['суд а, канцелярия'] = place.id;
  const r = changeRow(0, { destination: 'Суд А, канцелярия' });
  const a = C.buildImport(state, r); assert.equal(a.ready, true); assert.equal(a.state.tasks[0].source.destinationId, place.id);
  assert.equal(C.buildImport(a.state, r).questions.length, 0);
  const b = C.buildImport(state, changeRow(0, { destination: 'Другой суд' })); assert.equal(b.ready, true); assert.equal(b.questions.length, 0); assert.equal(b.state.destinations.length, 3);
});
test('Суд определяется автоматически, адрес и метро без исходных сведений пусты', () => {
  const a = C.buildImport(C.emptyState(), baseRows); assert.equal(a.ready, true); assert.equal(a.questions.length, 0); assert.equal(a.state.destinations.length, 2);
  const first = a.state.tasks[0], second = a.state.tasks[1]; assert.equal(first.source.destinationId, second.source.destinationId);
  const place = a.state.destinations.find(p => p.id === first.source.destinationId); assert.equal(place.name, 'Суд А'); assert.equal(place.metro, ''); assert.equal(place.address, ''); assert.equal(place.location, '');
  const updated = C.buildImport(a.state, changeRow(0, { destination: '  СУД   А  ' })); assert.equal(updated.ready, true); assert.equal(updated.state.destinations.length, 2);
});
test('Пустое описание и отсутствующий столбец описания не мешают импорту', () => {
  const r = changeRow(0, { description: '' }), a = C.buildImport(C.emptyState(), r); assert.equal(a.ready, true); assert.equal(a.state.tasks.length, 3); assert.equal(a.state.tasks[0].source.description, ''); assert(a.warnings.some(w => w.line === 2));
  const records = C.parseCSV(baseText), mapping = C.mappingFor(records[0].cells, 'tasks'); mapping.description = -1;
  const b = C.buildImport(C.emptyState(), C.mappedRows(records, 0, mapping)); assert.equal(b.ready, true); assert.equal(b.state.tasks.length, 3); assert(b.state.tasks.every(t => t.source.description === ''));
});
test('Фильтры: поиск, статус, сотрудник, приоритет, даты, готовность', () => {
  const state = imported(); state.tasks[0].localNote = 'Кабинет 17'; state.tasks[0].documentsReady = true; state.tasks[0].plannedDate = '2026-10-20';
  assert.equal(C.filterTasks(state, { search: 'КАБИНЕТ 17', ready: 'yes', createdBy: 'Сотрудник А', plannedFrom: '2026-10-20' }).length, 1);
  assert.equal(C.filterTasks(state, { view: 'unplanned' }).length, 1); assert.equal(C.filterTasks(state, { view: 'completed' }).length, 1); assert.equal(C.filterTasks(state, { priority: 'high', createdTo: '2026-09-30' }).length, 0);
});
test('Сводка считает только уникальные учреждения по активным задачам', () => {
  const state = imported(); let s = C.summary(state); assert.equal(s.activeCount, 2); assert.equal(s.completedCount, 1); assert.equal(s.destinations.length, 1); assert.equal(s.destinations[0].taskCount, 2);
  const failed = C.clone(state.tasks[2]); failed.id = 'TASK-FAILED'; failed.result = { outcome: 'failed', date: '2026-10-06', comment: 'Закрыто' }; state.tasks.push(failed);
  const cancelled = C.clone(state.tasks[0]); cancelled.id = 'TASK-CANCELLED'; cancelled.result = { outcome: 'cancelled', date: null, comment: '' }; state.tasks.push(cancelled);
  s = C.summary(state); assert.equal(s.activeCount, 3); assert.equal(s.completedCount, 1); assert.equal(s.destinations.length, 2); assert.equal(s.destinations.reduce((sum, p) => sum + p.taskCount, 0), 3);
  const before = JSON.stringify(state); C.summary(state); assert.equal(JSON.stringify(state), before);
  assert.deepEqual(C.summary(C.emptyState()), { activeCount: 0, completedCount: 0, destinations: [] });
});
test('Импорт не изменяет исходное состояние до записи', () => {
  const state = imported(), before = JSON.stringify(state); C.buildImport(state, changeRow(0, { priority: 'срочно' })); assert.equal(JSON.stringify(state), before);
});
test('JSON, сохранение и новая схема', () => {
  const storage = memory(), store = new C.Store(storage); assert(store.commit(imported()));
  const next = new C.Store(storage); assert.equal(next.state.tasks.length, 3); assert.equal(next.state.revision, 1); assert.equal(next.error, null);
  const backup = C.clone(next.state); assert.deepEqual(C.validateState(backup), next.state);
  assert.throws(() => C.validateState({ ...backup, schemaVersion: 2 }), /новой/);
  const bad = C.clone(backup); bad.tasks[0].source.destinationId = 'missing'; assert.throws(() => C.validateState(bad), /место/);
  const malformedReport = C.clone(backup); malformedReport.lastImport.entries = [null]; assert.throws(() => C.validateState(malformedReport), /отчёт/);
  const longComment = C.clone(backup); longComment.tasks[0].result.comment = 'x'.repeat(4001); assert.throws(() => C.validateState(longComment), /результаты/);
});
test('Повреждённое хранилище не затирается; восстановление разрешено', () => {
  const storage = memory('{bad'), store = new C.Store(storage); assert(store.error); assert.equal(store.commit(imported()), false); assert.equal(storage.raw, '{bad');
  assert.equal(store.commit(imported(), true), true); assert.equal(store.error, null);
});
test('Ошибка записи сохраняет старые данные и предоставляет кандидат', () => {
  const storage = memory(JSON.stringify(imported())), store = new C.Store(storage), before = storage.raw;
  storage.setItem = () => { throw new Error('QuotaExceededError'); }; const next = C.clone(store.state); next.tasks[0].localNote = 'Не сохранено';
  assert.equal(store.commit(next), false); assert.equal(storage.raw, before); assert.equal(store.state.tasks[0].localNote, ''); assert.equal(store.candidate.tasks[0].localNote, 'Не сохранено');
});
test('Пороги размера и другая вкладка', () => {
  const storage = memory(), store = new C.Store(storage), large = imported(); large.tasks[0].source.description = 'x'.repeat(2 * 1024 * 1024);
  assert.equal(store.commit(large), false); assert.match(store.lastWriteError, /4 MiB/); assert.equal(storage.raw, null);
  const medium = imported(); medium.tasks[0].history.push({ id: C.uid(), at: C.now(), type: 'test-size', changes: 'x'.repeat(1024 * 1024) }); assert.equal(store.commit(medium), true); assert(store.size() >= 2 * 1024 * 1024);
  const next = C.clone(store.state); next.revision++; storage.raw = JSON.stringify(next); assert(store.checkExternal()); assert.equal(store.commit(imported()), false);
});
module.exports = { baseText, baseRows, imported };
