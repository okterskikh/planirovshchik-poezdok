/* Предметная модель и импорт. Не зависят от DOM; используются браузером и тестами. */
(function (root) {
  'use strict';
  const KEY = 'tripPlanner.state.v1';
  const PRIORITIES = { urgent: 'Срочно', high: 'Высокий', normal: 'Обычный' };
  const STATUSES = { new: 'Новая', planned: 'Запланирована', failed: 'Не удалось выполнить', completed: 'Выполнена', cancelled: 'Отменена' };
  const HEADERS = { id: 'ID задачи', createdBy: 'Кто направил', createdDate: 'Дата направления', client: 'Клиент', documentNumber: 'Номер листа', destination: 'Место направления', metro: 'Метро', address: 'Адрес', location: 'Расположение', description: 'Задача (сколько заявлений, что сделать)', priority: 'Приоритетность', status: 'Статус', done: 'Выполнение', resultDate: 'Дата выполнения', comment: 'Комментарий' };
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const clone = value => JSON.parse(JSON.stringify(value));
  const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const uid = () => root.crypto?.randomUUID?.() || 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  let timeSource = () => new Date();
  const now = () => timeSource().toISOString();
  const setClock = source => { assert(typeof source === 'function', 'Нужен источник времени'); timeSource = source; };
  function today() { const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).formatToParts(timeSource()).map(p => [p.type, p.value])); return `${parts.year}-${parts.month}-${parts.day}`; }
  function emptyState() { return { schemaVersion: 1, workspaceId: uid(), revision: 0, tasks: [], destinations: [], dayOrders: {}, destinationAliases: {}, importMappings: {}, excludedDates: [], lastConfirmedResultsExport: null, lastBackupExport: null, lastImport: null }; }
  function parseDate(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    let y, m, d, match;
    if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text))) [, y, m, d] = match;
    else if ((match = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(text))) { [, d, m, y] = match; if (y.length === 2) y = '20' + y; }
    else throw new Error('Дата должна быть ДД.ММ.ГГ, ДД.ММ.ГГГГ или YYYY-MM-DD');
    const date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(Number(y), Number(m) - 1, Number(d));
    if (Number(y) < 1 || date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) throw new Error('Несуществующая дата: ' + text);
    return `${y.padStart(4, '0')}-${m}-${d}`;
  }
  function status(task) { return task.result.outcome === 'none' ? (task.plannedDate ? 'planned' : 'new') : task.result.outcome; }
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function validateState(state) {
    assert(state && typeof state === 'object' && !Array.isArray(state), 'Ожидался объект данных');
    assert(state.schemaVersion === 1, state.schemaVersion > 1 ? 'Эта копия создана более новой версией приложения' : 'Неизвестная версия схемы');
    assert(typeof state.workspaceId === 'string' && state.workspaceId.length > 0 && Number.isSafeInteger(state.revision) && state.revision >= 0, 'Повреждены сведения рабочей области');
    for (const key of ['tasks', 'destinations', 'excludedDates']) assert(Array.isArray(state[key]), 'Не найден список ' + key);
    for (const key of ['dayOrders', 'destinationAliases', 'importMappings']) assert(state[key] && typeof state[key] === 'object' && !Array.isArray(state[key]), 'Повреждён раздел ' + key);
    const places = new Set();
    for (const place of state.destinations) {
      assert(place && typeof place.id === 'string' && place.id && !places.has(place.id), 'Повторный или пустой ID места'); places.add(place.id);
      for (const key of ['name', 'metro', 'address', 'location']) assert(typeof place[key] === 'string', 'Повреждены сведения места');
      assert(place.name.trim() && Array.isArray(place.aliases) && place.aliases.every(x => typeof x === 'string'), 'Повреждены варианты названия места');
    }
    const resultValid = r => r && ['none', 'failed', 'completed', 'cancelled'].includes(r.outcome) && (r.date === null || typeof r.date === 'string' && parseDate(r.date) === r.date) && typeof r.comment === 'string' && r.comment.length <= 4000 && (r.outcome !== 'completed' || r.date !== null) && (r.outcome !== 'failed' || r.date !== null && r.comment.trim());
    const ids = new Set();
    for (const task of state.tasks) {
      assert(task && typeof task.id === 'string' && task.id.trim() && !ids.has(task.id), 'Повторный или пустой ID задачи'); ids.add(task.id);
      assert(task.source && typeof task.source === 'object', 'Отсутствуют исходные сведения');
      for (const key of ['createdBy', 'client', 'documentNumber', 'description', 'destinationId']) assert(typeof task.source[key] === 'string', 'Повреждено поле ' + key);
      assert(task.source.client.trim() && places.has(task.source.destinationId) && own(PRIORITIES, task.source.priority), 'Неверный клиент, место или приоритет');
      assert(task.localPriority === undefined || task.localPriority === null || own(PRIORITIES, task.localPriority), 'Неверный приоритет исполнителя');
      for (const date of [task.source.createdDate, task.plannedDate, task.firstPlannedDate]) assert(date === null || typeof date === 'string' && parseDate(date) === date, 'Повреждена дата задачи');
      assert(typeof task.documentsReady === 'boolean' && typeof task.localNote === 'string' && task.localNote.length <= 2000, 'Повреждены локальные поля');
      assert(resultValid(task.result) && (task.lastCsvResult === null || resultValid(task.lastCsvResult)) && (task.lastConfirmedExportResult === null || resultValid(task.lastConfirmedExportResult)), 'Повреждены результаты задачи');
      assert(Array.isArray(task.history), 'Повреждена история');
      const events = new Set();
      for (const event of task.history) { assert(event && typeof event.id === 'string' && !events.has(event.id) && typeof event.type === 'string' && typeof event.at === 'string' && Number.isFinite(Date.parse(event.at)), 'Повреждено событие истории'); events.add(event.id); }
    }
    for (const date of state.excludedDates) assert(typeof date === 'string' && parseDate(date) === date, 'Повреждён календарь исключений');
    for (const [date, order] of Object.entries(state.dayOrders)) assert(parseDate(date) === date && Array.isArray(order) && order.every(id => places.has(id)) && new Set(order).size === order.length, 'Повреждён порядок поездок');
    for (const id of Object.values(state.destinationAliases)) assert(typeof id === 'string' && places.has(id), 'Повреждена привязка места');
    for (const stamp of [state.lastBackupExport, state.lastConfirmedResultsExport]) assert(stamp === null || typeof stamp === 'string' && Number.isFinite(Date.parse(stamp)), 'Повреждена дата выгрузки');
    assert(state.backupContentHash === undefined || typeof state.backupContentHash === 'string', 'Повреждена отметка резервной копии');
    assert(state.backupSnoozeUntil === undefined || state.backupSnoozeUntil === null || typeof state.backupSnoozeUntil === 'string' && parseDate(state.backupSnoozeUntil) === state.backupSnoozeUntil, 'Повреждена дата напоминания');
    if (state.pendingResultExports !== undefined) {
      assert(Array.isArray(state.pendingResultExports), 'Повреждены ожидающие выгрузки'); const exports = new Set();
      for (const item of state.pendingResultExports) {
        assert(item && typeof item.id === 'string' && item.id && !exports.has(item.id) && typeof item.at === 'string' && Number.isFinite(Date.parse(item.at)), 'Повреждена выгрузка'); exports.add(item.id);
        assert(Array.isArray(item.snapshots) && item.snapshots.length, 'В выгрузке отсутствуют результаты'); const selected = new Set();
        for (const row of item.snapshots) { assert(row && ids.has(row.id) && !selected.has(row.id) && resultFieldsValid(row.result), 'Повреждён снимок выгрузки'); selected.add(row.id); }
      }
    }
    for (const mapping of Object.values(state.importMappings)) assert(mapping && typeof mapping === 'object' && !Array.isArray(mapping) && Object.values(mapping).every(value => typeof value === 'string'), 'Повреждено сопоставление столбцов');
    assert(state.lastImport === null || state.lastImport && Number.isFinite(Date.parse(state.lastImport.at)) && ['tasks', 'places'].includes(state.lastImport.type) && Number.isSafeInteger(state.lastImport.rowCount) && state.lastImport.rowCount >= 0 && Array.isArray(state.lastImport.entries) && state.lastImport.entries.every(e => e && typeof e.id === 'string' && typeof e.kind === 'string' && typeof e.label === 'string' && own(e, 'before') && own(e, 'after')) && Array.isArray(state.lastImport.warnings) && state.lastImport.warnings.every(w => w && Number.isInteger(w.line) && typeof w.message === 'string'), 'Повреждён отчёт импорта');
    return state;
  }
  function parseCSV(text, separator = ';') {
    text = String(text).replace(/^\uFEFF/, '');
    const records = []; let cells = [], field = '', quoted = false, closed = false, line = 1, start = 1;
    function pushRecord() { cells.push(field); if (cells.some(x => x.trim())) records.push({ cells, line: start }); cells = []; field = ''; closed = false; start = line + 1; }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
        else if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; field += '\n'; line++; }
        else field += ch;
      } else if (ch === separator) { cells.push(field); field = ''; closed = false; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; pushRecord(); line++; }
      else if (ch === '"') { assert(!field && !closed, 'Лишняя кавычка в строке ' + line); quoted = true; }
      else { assert(!closed || /\s/.test(ch), 'Текст после закрывающей кавычки в строке ' + line); if (!closed) field += ch; }
    }
    assert(!quoted, 'Незакрытая кавычка в строке ' + start);
    if (field || cells.length || closed) { cells.push(field); if (cells.some(x => x.trim())) records.push({ cells, line: start }); }
    assert(records.length > 0, 'Файл пуст'); return records;
  }
  function detectSeparator(text) {
    let best = ';', score = -1;
    for (const candidate of [';', ',', '\t']) { try { const rows = parseCSV(text, candidate).slice(0, 10); const width = Math.max(...rows.map(r => r.cells.length)); if (width > score) { score = width; best = candidate; } } catch (_) {} }
    return best;
  }
  function headerIndex(records) { let best = 0, score = -1; records.slice(0, 10).forEach((r, i) => { const n = r.cells.filter(v => Object.values(HEADERS).some(h => norm(h) === norm(v))).length; if (n > score) { score = n; best = i; } }); return best; }
  function mappingFor(headers, type) {
    const keys = type === 'places' ? ['destination', 'metro', 'address', 'location'] : Object.keys(HEADERS);
    return Object.fromEntries(keys.map(key => [key, headers.findIndex(h => norm(h) === norm(HEADERS[key]))]));
  }
  function mappedRows(records, index, mapping) {
    const resultsOnly = isResultsCSV(records, index);
    return records.slice(index + 1).map(record => ({ line: record.line, ...(resultsOnly ? { resultsOnly: true } : {}), values: Object.fromEntries(Object.entries(mapping).map(([key, column]) => {
      let value = column >= 0 ? (record.cells[column] ?? '') : '';
      if (resultsOnly && /^'\s*[=+\-@]/.test(value)) value = value.slice(1);
      return [key, resultsOnly && key === 'comment' ? value : value.trim()];
    })) }));
  }
  function isResultsCSV(records, index) { return records[index]?.cells.length === 7 && records[index].cells.every((value, i) => norm(value) === norm(['ID задачи', 'Клиент', 'Номер листа', 'Статус', 'Выполнение', 'Дата выполнения', 'Комментарий'][i])); }
  /* XLSX: ZIP + Open XML, только данные ячеек. Формулы и макросы не исполняются. */
  const EXCEL_LIMIT = 50 * 1024 * 1024;
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function openXlsx(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    assert(bytes.length <= EXCEL_LIMIT, 'Excel-файл превышает 50 MiB');
    const u16 = n => { assert(n >= 0 && n + 2 <= bytes.length, 'Повреждён Excel-файл'); return view.getUint16(n, true); };
    const u32 = n => { assert(n >= 0 && n + 4 <= bytes.length, 'Повреждён Excel-файл'); return view.getUint32(n, true); };
    assert(bytes.length >= 22 && u32(0) === 0x04034b50, 'Это не обычный файл .xlsx. Старый .xls или книгу с паролем сохраните как .xlsx без пароля');
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50) end--;
    assert(end >= Math.max(0, bytes.length - 65557), 'Не найдено содержимое Excel-книги');
    assert(u16(end + 4) === 0 && u16(end + 6) === 0 && u16(end + 8) === u16(end + 10), 'Многотомный Excel-архив не поддерживается');
    const count = u16(end + 10), entries = new Map(); let offset = u32(end + 16);
    assert(count > 0 && count < 4096 && offset + u32(end + 12) <= end, 'Повреждён или слишком большой каталог Excel-книги');
    for (let index = 0; index < count; index++) {
      assert(u32(offset) === 0x02014b50, 'Повреждён каталог Excel-книги');
      const flags = u16(offset + 8), method = u16(offset + 10), checksum = u32(offset + 16), packed = u32(offset + 20), size = u32(offset + 24), nameLength = u16(offset + 28), extra = u16(offset + 30), comment = u16(offset + 32), local = u32(offset + 42);
      assert(!(flags & 1), 'Excel-книга защищена паролем');
      assert(offset + 46 + nameLength + extra + comment <= end && size !== 0xffffffff && local !== 0xffffffff, 'ZIP64 или повреждённый Excel-файл не поддерживается');
      const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      assert(!entries.has(name), 'Повторная часть в Excel-книге'); entries.set(name, { flags, method, checksum, packed, size, local }); offset += 46 + nameLength + extra + comment;
    }
    const cache = new Map(); let expanded = 0;
    async function readPart(name, required = true) {
      if (cache.has(name)) return cache.get(name);
      const entry = entries.get(name); if (!entry && !required) return null;
      assert(entry, 'В Excel-книге отсутствует часть ' + name);
      assert(entry.size <= EXCEL_LIMIT && expanded + entry.size <= EXCEL_LIMIT, 'Распакованные данные Excel превышают 50 MiB');
      assert([0, 8].includes(entry.method) && u32(entry.local) === 0x04034b50, 'Неподдерживаемое сжатие Excel-книги');
      const start = entry.local + 30 + u16(entry.local + 26) + u16(entry.local + 28);
      assert(start + entry.packed <= bytes.length, 'Обрезанный Excel-файл');
      let data = bytes.subarray(start, start + entry.packed);
      if (entry.method === 8) {
        let stream;
        try { stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')); } catch (_) { throw new Error('Для Excel нужен Chrome или Edge версии 120 и выше'); }
        const reader = stream.getReader(), chunks = []; let length = 0;
        try { while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > entry.size || expanded + length > EXCEL_LIMIT) { await reader.cancel(); throw new Error('Превышен размер данных Excel'); } chunks.push(chunk.value); } } finally { reader.releaseLock(); }
        data = new Uint8Array(length); let at = 0; for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
      }
      assert(data.length === entry.size && crc32(data) === entry.checksum, 'Excel-файл повреждён: проверка целостности не пройдена'); expanded += data.length;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      assert(!/<!DOCTYPE|<!ENTITY/i.test(text), 'Неподдерживаемые объявления XML в Excel');
      const xml = new DOMParser().parseFromString(text, 'application/xml');
      assert(!xml.getElementsByTagNameNS('*', 'parsererror').length, 'Повреждена XML-часть Excel-книги'); cache.set(name, xml); return xml;
    }
    const tags = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
    const child = (node, name) => Array.from(node.children).find(n => n.localName === name);
    const workbook = await readPart('xl/workbook.xml'), relationships = await readPart('xl/_rels/workbook.xml.rels');
    const relationMap = new Map(tags(relationships, 'Relationship').filter(r => r.getAttribute('TargetMode') !== 'External' && /\/worksheet$/.test(r.getAttribute('Type'))).map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
    function partPath(target) {
      assert(target && !/^[a-z]+:/i.test(target), 'Некорректная ссылка на лист');
      const path = (target.startsWith('/') ? target.slice(1) : 'xl/' + target).split('/'), result = [];
      for (const item of path) { if (item === '..') { assert(result.length, 'Некорректный путь листа'); result.pop(); } else if (item && item !== '.') result.push(item); }
      return result.join('/');
    }
    const sheets = tags(workbook, 'sheet').map(sheet => {
      const relation = Array.from(sheet.attributes).find(a => a.localName === 'id')?.value;
      return { name: sheet.getAttribute('name') || 'Лист', path: relationMap.has(relation) ? partPath(relationMap.get(relation)) : null };
    }).filter(sheet => sheet.path);
    assert(sheets.length, 'В книге нет листов с таблицами');
    const stringsXML = await readPart('xl/sharedStrings.xml', false), stylesXML = await readPart('xl/styles.xml', false);
    const excelText = text => text.replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
    const strings = stringsXML ? tags(stringsXML, 'si').map(si => excelText(tags(si, 't').map(t => t.textContent).join(''))) : [];
    const formats = new Map(stylesXML ? tags(stylesXML, 'numFmt').map(n => [Number(n.getAttribute('numFmtId')), n.getAttribute('formatCode')]) : []);
    const cellXfs = stylesXML ? tags(stylesXML, 'cellXfs')[0] : null;
    const styles = cellXfs ? Array.from(cellXfs.children).map(x => Number(x.getAttribute('numFmtId') || 0)) : [];
    const date1904 = ['1', 'true'].includes(tags(workbook, 'workbookPr')[0]?.getAttribute('date1904'));
    const builtinDates = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
    async function readSheet(index) {
      assert(Number.isInteger(index) && sheets[index], 'Выберите лист Excel-книги');
      const xml = await readPart(sheets[index].path), records = []; let cellsCount = 0;
      const sheetData = tags(xml, 'sheetData')[0]; assert(sheetData, 'В листе нет табличных данных');
      let previousRow = 0;
      for (const row of Array.from(sheetData.children).filter(n => n.localName === 'row')) {
        const line = Number(row.getAttribute('r') || previousRow + 1); assert(Number.isInteger(line) && line > previousRow && line <= 1048576, 'Неверный номер строки Excel'); previousRow = line;
        const cells = []; let nextColumn = 0;
        for (const cell of Array.from(row.children).filter(n => n.localName === 'c')) {
          assert(++cellsCount <= 200000, 'Лист содержит более 200 000 ячеек');
          const coordinate = cell.getAttribute('r'), match = coordinate ? /^([A-Z]+)(\d+)$/.exec(coordinate) : null;
          assert(!coordinate || match && Number(match[2]) === line, 'Неверный адрес ячейки Excel');
          const column = match ? [...match[1]].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1 : nextColumn;
          assert(column >= nextColumn && column < 16384, 'Неверный порядок ячеек Excel'); nextColumn = column + 1;
          const type = cell.getAttribute('t') || 'n', valueNode = child(cell, 'v'), formula = child(cell, 'f');
          assert(!formula || valueNode && (valueNode.textContent !== '' || type === 'str'), 'В ячейке ' + (coordinate || line) + ' нет сохранённого результата формулы. Откройте и сохраните книгу в Excel');
          assert(type !== 'e', 'Ошибка Excel в ячейке ' + (coordinate || line) + ': ' + (valueNode?.textContent || 'ошибка формулы'));
          let value = valueNode?.textContent || '';
          if (type === 's') { assert(/^\d+$/.test(value) && Number(value) < strings.length, 'Повреждена строка Excel'); value = strings[Number(value)]; }
          else if (type === 'inlineStr') value = excelText(tags(child(cell, 'is') || cell, 't').map(t => t.textContent).join(''));
          else if (type === 'b') { assert(['0', '1'].includes(value), 'Неверная логическая ячейка Excel'); value = value === '1' ? 'TRUE' : 'FALSE'; }
          else if (type === 'd') value = parseDate(value.slice(0, 10)) || '';
          else if (type === 'str') value = excelText(value);
          else if (value) {
            const formatId = styles[Number(cell.getAttribute('s') || 0)] || 0, format = formats.get(formatId) || '';
            const cleaned = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
            if (builtinDates.has(formatId) || /[yd]/i.test(cleaned)) {
              const serial = Number(value), days = Math.floor(serial); assert(Number.isFinite(serial) && days >= 0 && (date1904 || days !== 60), 'Некорректная дата Excel в ' + coordinate);
              const date = new Date((date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31)) + (date1904 ? days : days - (days >= 60 ? 1 : 0)) * 86400000);
              assert(Number.isFinite(date.getTime()) && date.getUTCFullYear() <= 9999, 'Дата Excel вне диапазона'); value = date.toISOString().slice(0, 10);
            } else if (/^0+$/.test(format) && /^\d+$/.test(value)) value = value.padStart(format.length, '0');
          }
          while (cells.length <= column) cells.push(''); cells[column] = value;
        }
        if (cells.some(value => value.trim())) records.push({ cells, line });
      }
      assert(records.length, 'Выбранный лист пуст'); return records;
    }
    return { sheets: sheets.map(({ name }) => ({ name })), readSheet };
  }
  function mergeResult(base, local, incoming) { if (base === null) return 'csv'; if (equal(incoming, base)) return 'local'; if (equal(local, base)) return 'csv'; if (equal(local, incoming)) return 'local'; return 'conflict'; }
  function emptyImportRow(row, type) {
    const values = row.values;
    if (type === 'places') return ['destination', 'metro', 'address', 'location'].every(key => !norm(values[key]));
    // Чекбокс FALSE и предзаполненные служебные значения не создают задачу.
    const hasData = Object.entries(values).some(([key, value]) => !['id', 'done', 'status', 'priority'].includes(key) && norm(value));
    return !hasData && ['', 'false', '0', 'нет'].includes(norm(values.done)) && (!norm(values.status) || normalizeStatus(values.status) === 'none') && normalizePriority(values.priority) === 'normal';
  }
  function normalizePriority(value) { const v = norm(value); return !v || ['обычный', 'обычная'].includes(v) ? 'normal' : ['срочно', 'срочный', 'срочная'].includes(v) ? 'urgent' : ['высокий', 'высокая'].includes(v) ? 'high' : null; }
  function normalizeStatus(value) { const v = norm(value), dictionary = { 'новая': 'none', 'запланирована': 'none', 'не удалось выполнить': 'failed', 'выполнена': 'completed', 'выполнено': 'completed', 'отменена': 'cancelled', 'отменено': 'cancelled' }; return own(dictionary, v) ? dictionary[v] : null; }
  function event(task, type, changes) { task.history.push({ id: uid(), at: now(), type, changes }); }
  function sortAffected(state, dates, previousState) {
    const ranks = { urgent: 0, high: 1, normal: 2 };
    for (const date of dates) {
      const rank = new Map();
      state.tasks.filter(t => t.plannedDate === date && !['completed', 'cancelled'].includes(t.result.outcome)).forEach(t => rank.set(t.source.destinationId, Math.min(rank.get(t.source.destinationId) ?? 2, ranks[effectivePriority(t)])));
      const old = (previousState.dayOrders[date] || []).filter(id => rank.has(id));
      const fresh = [...rank.keys()].filter(id => !old.includes(id)).sort((a, b) => { const pa = state.destinations.find(p => p.id === a), pb = state.destinations.find(p => p.id === b); return norm(pa.name).localeCompare(norm(pb.name), 'ru') || a.localeCompare(b); });
      state.dayOrders[date] = [...old, ...fresh].sort((a, b) => rank.get(a) - rank.get(b));
    }
  }
  function buildImport(current, rows, options = {}) {
    const state = clone(current), errors = [], blockers = [], questions = [], warnings = [], entries = [];
    const type = options.type || 'tasks', resolve = options.resolve || {}, excluded = new Set(options.excluded || []), affected = new Set();
    const ignoredEmptyRows = rows.filter(row => emptyImportRow(row, type)).length;
    rows = rows.filter(row => !emptyImportRow(row, type));
    const rowsSeen = new Set(), ids = new Set();
    const add = (kind, id, before, after, label = '') => entries.push({ kind, id, before: clone(before), after: clone(after), label });
    if (type === 'tasks') for (const row of rows) { const id = row.values.id; if (!id || ids.has(id)) blockers.push({ line: row.line, message: !id ? 'Не заполнен ID задачи' : 'Повторный ID задачи: ' + id }); if (row.resultsOnly && id && !current.tasks.some(t => t.id === id)) blockers.push({ line: row.line, message: 'Выгрузка результатов содержит неизвестный ID: ' + id }); ids.add(id); }
    const need = (key, question) => { if (!own(resolve, key) || resolve[key] === '') { questions.push({ key, ...question }); return null; } return resolve[key]; };
    for (const row of rows) {
      const v = { ...row.values }, id = v.id || v.destination || 'строка ' + row.line;
      if (excluded.has(row.line)) { add('skipped', id, null, { line: row.line }, 'Строка исключена'); continue; }
      const prefix = 'row:' + row.line;
      try {
        if (row.resultsOnly && type === 'tasks') {
          const existing = current.tasks.find(t => t.id === v.id);
          if (!existing) continue;
          const place = current.destinations.find(p => p.id === existing.source.destinationId);
          Object.assign(v, { client: existing.source.client, documentNumber: existing.source.documentNumber, createdBy: existing.source.createdBy, createdDate: existing.source.createdDate || '', description: existing.source.description, priority: PRIORITIES[existing.source.priority], destination: place.name, metro: place.metro, address: place.address, location: place.location });
        }
        assert(v.destination, 'Не заполнено место назначения');
        if (type === 'tasks') { assert(v.id, 'Не заполнен ID задачи'); assert(v.client, 'Не заполнен клиент'); }
        let priority = type === 'tasks' ? normalizePriority(v.priority) : null, incoming = null, createdDate = null;
        if (type === 'tasks') {
          createdDate = parseDate(v.createdDate);
          if (!priority) priority = need('priority:' + norm(v.priority), { type: 'priority', message: 'Неизвестный приоритет: ' + v.priority, line: row.line });
          let outcome = normalizeStatus(v.status), explicit = !!v.status;
          if (explicit && !outcome) outcome = need('status:' + norm(v.status), { type: 'status', message: 'Неизвестный статус: ' + v.status, line: row.line });
          const doneRaw = norm(v.done), truth = ['true', '1', 'да'], falsehood = ['false', '0', 'нет', ''];
          assert(truth.includes(doneRaw) || falsehood.includes(doneRaw), 'Неизвестное значение «Выполнение»: ' + v.done);
          const doneOutcome = truth.includes(doneRaw) ? 'completed' : 'none';
          if (!explicit) outcome = doneOutcome;
          if (explicit && outcome && v.done && (outcome === 'completed') !== (doneOutcome === 'completed')) {
            const chosen = need(prefix + ':status-source', { type: 'status-source', message: 'Статус и отметка выполнения противоречат друг другу', line: row.line, status: outcome, done: doneOutcome });
            if (chosen === 'done') outcome = doneOutcome;
          }
          const resultDate = parseDate(v.resultDate);
          assert(outcome !== 'completed' || resultDate, 'Для выполненной задачи нужна дата выполнения');
          assert(outcome !== 'failed' || resultDate && v.comment.trim(), 'Для неудачной попытки нужны дата и причина');
          assert(v.comment.length <= 4000, 'Комментарий длиннее 4 000 символов');
          incoming = { outcome: outcome || 'none', date: outcome === 'none' ? null : resultDate, comment: v.comment };
          if (!v.description) warnings.push({ line: row.line, message: 'Пустое описание задачи' });
        }
        const nameKey = norm(v.destination);
        let place = state.destinations.find(p => norm(p.name) === nameKey || p.aliases.some(a => norm(a) === nameKey));
        if (!place && own(state.destinationAliases, nameKey)) place = state.destinations.find(p => p.id === state.destinationAliases[nameKey]);
        if (!place) {
          place = { id: 'place-' + uid(), name: v.destination, metro: v.metro || '', address: v.address || '', location: v.location || '', aliases: [] };
          state.destinations.push(place); add('place-new', place.id, null, place, place.name);
        }
        if (norm(place.name) !== nameKey && !place.aliases.some(a => norm(a) === nameKey)) place.aliases.push(v.destination);
        Object.defineProperty(state.destinationAliases, nameKey, { value: place.id, writable: true, enumerable: true, configurable: true });
        const details = Object.fromEntries(['metro', 'address', 'location'].map(key => [key, v[key] || '']));
        const supplied = Object.entries(details).filter(([, value]) => value);
        const differing = supplied.filter(([key, value]) => place[key] && norm(place[key]) !== norm(value));
        let takeDetails = true;
        if (differing.length) {
          const choice = need(prefix + ':address', { type: 'address', message: 'Различаются сведения места «' + place.name + '»', line: row.line, local: { metro: place.metro, address: place.address, location: place.location }, csv: details });
          takeDetails = choice === 'csv';
        }
        if (takeDetails) {
          const before = clone(place); for (const [key, value] of supplied) place[key] = value;
          if (!equal(before, place)) add('place-changed', place.id, before, place, place.name);
        }
        if (type === 'places') { rowsSeen.add(row.line); continue; }
        if (!priority || questions.some(q => q.line === row.line && ['status', 'status-source'].includes(q.type))) continue;
        const source = { createdBy: v.createdBy, createdDate, client: v.client, documentNumber: v.documentNumber, destinationId: place.id, description: v.description, priority };
        const previous = current.tasks.find(t => t.id === v.id);
        if (!previous) {
          const task = { id: v.id, source, plannedDate: null, firstPlannedDate: null, documentsReady: false, localNote: '', result: incoming, lastCsvResult: clone(incoming), history: [], lastConfirmedExportResult: null };
          event(task, 'import-new', { source, result: incoming }); state.tasks.push(task); add('new', task.id, null, { source, result: incoming }, source.client);
        } else {
          const task = state.tasks.find(t => t.id === v.id); task.source = source;
          if (!equal(previous.source, source)) { add('source', task.id, previous.source, source, source.client); event(task, 'source-import', { before: previous.source, after: source }); }
          if (previous.source.priority !== priority) { add('priority', task.id, previous.source.priority, priority, source.client); if (task.plannedDate) affected.add(task.plannedDate); }
          if (previous.source.destinationId !== source.destinationId && task.plannedDate) affected.add(task.plannedDate);
          let selection = mergeResult(previous.lastCsvResult, previous.result, incoming);
          if (incoming.outcome === 'cancelled' && previous.result.outcome !== 'cancelled') selection = 'csv';
          if (selection === 'conflict') selection = need(prefix + ':result', { type: 'result', message: 'Различаются результаты задачи ' + task.id, line: row.line, local: previous.result, csv: incoming });
          if (selection === 'csv') {
            task.result = clone(incoming);
            if (!equal(previous.result, incoming)) {
              const kind = incoming.outcome === 'cancelled' ? 'cancelled' : ['completed', 'cancelled'].includes(previous.result.outcome) && ['none', 'failed'].includes(incoming.outcome) ? 'reopened' : 'result';
              add(kind, task.id, previous.result, incoming, source.client); event(task, kind + '-import', { before: previous.result, after: incoming });
              if (task.plannedDate) affected.add(task.plannedDate);
              if (kind === 'reopened') { task.plannedDate = null; task.documentsReady = false; }
            }
          }
          task.lastCsvResult = clone(incoming);
        }
        rowsSeen.add(row.line);
      } catch (error) { errors.push({ line: row.line, message: error.message }); }
    }
    sortAffected(state, affected, current);
    for (const date of affected) if (!equal(state.dayOrders[date] || [], current.dayOrders[date] || [])) add('order', date, current.dayOrders[date] || [], state.dayOrders[date] || [], 'Порядок поездок');
    if (options.mapping) state.importMappings[type] = clone(options.mapping);
    state.lastImport = { at: now(), type, entries, rowCount: rowsSeen.size, warnings, ignoredEmptyRows };
    return { state, errors, blockers, questions: [...new Map(questions.map(q => [q.key, q])).values()], warnings, entries, rowCount: rowsSeen.size, ignoredEmptyRows, ready: !errors.length && !blockers.length && !questions.length };
  }
  function filterTasks(state, filters) {
    const places = new Map(state.destinations.map(p => [p.id, p]));
    return state.tasks.filter(task => {
      const place = places.get(task.source.destinationId), s = status(task), active = !['completed', 'cancelled'].includes(s);
      if (filters.view === 'unplanned' && (!active || task.plannedDate) || filters.view === 'active' && !active || filters.view === 'completed' && s !== 'completed' || filters.view === 'cancelled' && s !== 'cancelled') return false;
      if (filters.status && s !== filters.status || filters.destination && place.id !== filters.destination || filters.createdBy && task.source.createdBy !== filters.createdBy || filters.priority && effectivePriority(task) !== filters.priority || filters.location && place.location !== filters.location) return false;
      if (filters.ready && task.documentsReady !== (filters.ready === 'yes')) return false;
      for (const [from, to, value] of [[filters.createdFrom, filters.createdTo, task.source.createdDate], [filters.plannedFrom, filters.plannedTo, task.plannedDate]]) if ((from || to) && (!value || from && value < from || to && value > to)) return false;
      const haystack = [task.source.client, task.source.documentNumber, task.source.description, task.source.createdBy, task.localNote, place.name, place.address].map(norm).join(' ');
      return !filters.search || haystack.includes(norm(filters.search));
    });
  }
  function summary(state) {
    const counts = new Map(); let activeCount = 0, completedCount = 0;
    for (const task of state.tasks) {
      if (task.result.outcome === 'completed') completedCount++;
      if (!['completed', 'cancelled'].includes(task.result.outcome)) { activeCount++; const id = task.source.destinationId; counts.set(id, (counts.get(id) || 0) + 1); }
    }
    const destinations = state.destinations.filter(place => counts.has(place.id)).map(place => ({ ...place, taskCount: counts.get(place.id) })).sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id));
    return { activeCount, completedCount, destinations };
  }
  function addDays(date, amount) { const d = new Date(parseDate(date) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10); }
  function weekStart(date) { const day = new Date(date + 'T00:00:00Z').getUTCDay(); return addDays(date, day === 0 ? -6 : 1 - day); }
  function isWorkday(state, date) { const day = new Date(parseDate(date) + 'T00:00:00Z').getUTCDay(); return day !== 0 && day !== 6 && !state.excludedDates.includes(date); }
  function nextWorkday(state, date) { let target = parseDate(date); while (!isWorkday(state, target)) target = addDays(target, 1); return target; }
  const activeTask = task => !['completed', 'cancelled'].includes(task.result.outcome);
  const effectivePriority = task => task.localPriority ?? task.source.priority;
  function setTaskPriority(current, ids, priority) {
    assert(priority === null || own(PRIORITIES, priority), 'Выберите допустимый приоритет');
    const state = clone(current), selected = new Set(ids), dates = new Set();
    assert(selected.size && state.tasks.filter(t => selected.has(t.id)).length === selected.size, 'Выберите существующие задачи');
    for (const task of state.tasks.filter(t => selected.has(t.id))) {
      assert(activeTask(task), 'Приоритет изменяется только у активных задач');
      if ((task.localPriority ?? null) === priority) continue;
      const before = task.localPriority ?? null; task.localPriority = priority;
      event(task, 'local-priority', { before, after: priority });
      if (task.plannedDate) dates.add(task.plannedDate);
    }
    sortAffected(state, dates, current); return state;
  }
  function trips(state, date) {
    const ranks = { urgent: 0, high: 1, normal: 2 }, groups = new Map();
    for (const task of state.tasks.filter(t => t.plannedDate === date && activeTask(t))) {
      const id = task.source.destinationId;
      if (!groups.has(id)) groups.set(id, { destination: state.destinations.find(p => p.id === id), tasks: [], priority: 'normal', accumulated: 0 });
      const trip = groups.get(id); trip.tasks.push(task);
      if (ranks[effectivePriority(task)] < ranks[trip.priority]) trip.priority = effectivePriority(task);
      if (task.history.some(h => h.type === 'auto-rollover')) trip.accumulated++;
    }
    const order = state.dayOrders[date] || [], existing = order.filter(id => groups.has(id)), fresh = [...groups.keys()].filter(id => !existing.includes(id)).sort((a, b) => norm(groups.get(a).destination.name).localeCompare(norm(groups.get(b).destination.name), 'ru') || a.localeCompare(b));
    return [...existing, ...fresh].map(id => { const trip = groups.get(id); trip.tasks.sort((a, b) => ranks[effectivePriority(a)] - ranks[effectivePriority(b)] || a.source.client.localeCompare(b.source.client, 'ru') || a.id.localeCompare(b.id)); return trip; });
  }
  function planTasks(current, ids, date, options = {}) {
    const state = clone(current), selected = new Set(ids), currentDate = options.today || today(), target = date === null ? null : parseDate(date);
    assert(selected.size && state.tasks.filter(t => selected.has(t.id)).length === selected.size, 'Выберите существующие задачи');
    if (date !== null) { assert(target, 'Выберите дату поездки'); assert(target >= currentDate, 'Нельзя назначить прошедшую дату'); assert(options.allowNonWorking || isWorkday(state, target), 'Подтвердите назначение на выходной или исключённую дату'); }
    const dates = new Set();
    for (const task of state.tasks.filter(t => selected.has(t.id))) {
      assert(activeTask(task), 'Выполненную или отменённую задачу нельзя планировать');
      if (task.plannedDate === target) continue;
      const before = task.plannedDate; if (before) dates.add(before); if (target) dates.add(target);
      task.plannedDate = target; if (target && !task.firstPlannedDate) task.firstPlannedDate = target;
      event(task, target === null ? 'unplan' : before ? 'reschedule' : 'schedule', { before, after: target });
    }
    sortAffected(state, dates, current); return state;
  }
  function reorderTrip(current, date, destinationId, targetIndex) {
    const state = clone(current), order = trips(state, date).map(t => t.destination.id), from = order.indexOf(destinationId);
    assert(from >= 0 && Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < order.length, 'Неверный порядок поездок');
    if (from === targetIndex) return state;
    const before = order.slice(); order.splice(from, 1); order.splice(targetIndex, 0, destinationId); state.dayOrders[date] = order;
    for (const task of state.tasks.filter(t => t.plannedDate === date && activeTask(t))) event(task, 'trip-order', { date, before, after: order });
    return state;
  }
  function rollover(current, currentDate = today()) {
    const state = clone(current), overdue = state.tasks.filter(t => activeTask(t) && t.plannedDate && t.plannedDate < currentDate);
    if (!overdue.length) return { state: current, count: 0, target: null };
    const target = nextWorkday(state, currentDate), dates = new Set([target]);
    for (const task of overdue) { const before = task.plannedDate; dates.add(before); task.plannedDate = target; event(task, 'auto-rollover', { before, after: target }); }
    sortAffected(state, dates, current); return { state, count: overdue.length, target };
  }
  function undoPlanning(current, before) {
    const state = clone(current); state.dayOrders = clone(before.dayOrders); state.excludedDates = clone(before.excludedDates);
    for (const task of state.tasks) {
      const old = before.tasks.find(t => t.id === task.id); if (!old) continue;
      const orderChanged = !equal(current.dayOrders[task.plannedDate] || [], before.dayOrders[task.plannedDate] || []);
      if (task.plannedDate !== old.plannedDate || task.firstPlannedDate !== old.firstPlannedDate || orderChanged) event(task, 'undo-plan', { before: task.plannedDate, after: old.plannedDate });
      task.plannedDate = old.plannedDate; task.firstPlannedDate = old.firstPlannedDate;
      if (task.documentsReady !== old.documentsReady) event(task, 'undo-documents', { before: task.documentsReady, after: old.documentsReady });
      if (task.localNote !== old.localNote) event(task, 'undo-note', { before: task.localNote, after: old.localNote });
      task.documentsReady = old.documentsReady; task.localNote = old.localNote;
    }
    return state;
  }
  function setDocuments(current, ids, ready) {
    assert(typeof ready === 'boolean', 'Неверная готовность документов');
    const state = clone(current), selected = new Set(ids);
    assert(selected.size && state.tasks.filter(t => selected.has(t.id)).length === selected.size, 'Выберите существующие задачи');
    for (const task of state.tasks.filter(t => selected.has(t.id))) {
      if (task.documentsReady === ready) continue;
      event(task, 'documents', { before: task.documentsReady, after: ready }); task.documentsReady = ready;
    }
    return state;
  }
  function setNote(current, id, note) {
    assert(typeof note === 'string' && note.length <= 2000, 'Заметка должна содержать не более 2000 символов');
    const state = clone(current), task = state.tasks.find(t => t.id === id); assert(task, 'Задача не найдена');
    if (task.localNote !== note) { event(task, 'note', { before: task.localNote, after: note }); task.localNote = note; }
    return state;
  }
  function recordResult(current, id, outcome, date, comment, currentDate = today()) {
    assert(['completed', 'failed'].includes(outcome), 'Выберите выполнение или неудачную попытку');
    assert(typeof date === 'string' && parseDate(date) === date && date <= currentDate, 'Укажите дату результата не позднее сегодняшней');
    assert(typeof comment === 'string' && comment.length <= 4000, 'Комментарий должен содержать не более 4000 символов');
    assert(outcome !== 'failed' || comment.trim(), 'Укажите причину неудачной попытки');
    const state = clone(current), task = state.tasks.find(t => t.id === id); assert(task && activeTask(task), 'Результат можно записать только активной задаче');
    const result = { outcome, date, comment };
    event(task, outcome === 'completed' ? 'completed' : 'failed', { before: task.result, after: result }); task.result = result;
    if (task.plannedDate) sortAffected(state, new Set([task.plannedDate]), current);
    return state;
  }
  const resultFieldsValid = r => r && ['none', 'failed', 'completed', 'cancelled'].includes(r.outcome) && (r.date === null || typeof r.date === 'string' && parseDate(r.date) === r.date) && typeof r.comment === 'string' && r.comment.length <= 4000 && (r.outcome !== 'completed' || r.date !== null) && (r.outcome !== 'failed' || r.date !== null && r.comment.trim());
  function csvCell(value) {
    let text = String(value ?? ''); if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
    return /[;"\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  function exportResults(state, mode = 'changes', from = null, to = null) {
    assert(['changes', 'period', 'all'].includes(mode), 'Выберите вариант экспорта');
    if (mode === 'period') assert(parseDate(from) === from && parseDate(to) === to && from && to && from <= to, 'Укажите корректный период');
    const tasks = state.tasks.filter(task => {
      if (mode === 'changes') return task.lastConfirmedExportResult ? !equal(task.result, task.lastConfirmedExportResult) : task.result.outcome !== 'none';
      if (mode === 'period') return task.result.outcome !== 'none' && task.result.date && task.result.date >= from && task.result.date <= to;
      return task.result.outcome !== 'none';
    }).sort((a, b) => a.id.localeCompare(b.id, 'ru'));
    const snapshots = tasks.map(task => ({ id: task.id, result: clone(task.result) }));
    const rows = [['ID задачи', 'Клиент', 'Номер листа', 'Статус', 'Выполнение', 'Дата выполнения', 'Комментарий'], ...tasks.map(task => [task.id, task.source.client, task.source.documentNumber, STATUSES[status(task)], task.result.outcome === 'completed' ? 'TRUE' : 'FALSE', task.result.date ? task.result.date.split('-').reverse().join('.') : '', task.result.comment])];
    return { csv: '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n', snapshots };
  }
  function registerResultsExport(current, snapshots) {
    assert(Array.isArray(snapshots) && snapshots.length, 'Нет результатов для выгрузки');
    const state = clone(current), item = { id: uid(), at: now(), snapshots: clone(snapshots) };
    state.pendingResultExports = [...(state.pendingResultExports || []), item]; return { state, item };
  }
  function confirmResultsExport(current, id) {
    const state = clone(current), item = (state.pendingResultExports || []).find(x => x.id === id); assert(item, 'Выгрузка не найдена');
    for (const snapshot of item.snapshots) { const task = state.tasks.find(t => t.id === snapshot.id); assert(task, 'Задача из выгрузки не найдена'); task.lastConfirmedExportResult = clone(snapshot.result); }
    state.pendingResultExports = state.pendingResultExports.filter(x => x.id !== id); state.lastConfirmedResultsExport = now(); return state;
  }
  function backupHash(state) {
    const data = { ...state }; for (const key of ['revision', 'lastBackupExport', 'backupContentHash', 'backupSnoozeUntil']) delete data[key];
    const text = JSON.stringify(data); let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
    return (a >>> 0).toString(16) + '-' + (b >>> 0).toString(16) + '-' + text.length;
  }
  function backupReminder(state, date = today()) {
    if (state.backupSnoozeUntil && date < state.backupSnoozeUntil) return false;
    if (JSON.stringify(state).length * 2 >= 2 * 1024 * 1024) return true;
    if (!state.tasks.length) return false;
    if (!state.lastBackupExport) return true;
    const day = Object.fromEntries(new Intl.DateTimeFormat('en', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).formatToParts(new Date(state.lastBackupExport)).map(p => [p.type, p.value]));
    return date > `${day.year}-${day.month}-${day.day}` && backupHash(state) !== state.backupContentHash;
  }
  function markBackup(current) { const state = clone(current); state.lastBackupExport = now(); state.backupSnoozeUntil = null; state.backupContentHash = backupHash(state); return state; }
  function snoozeBackup(current) { const state = clone(current); state.backupSnoozeUntil = addDays(today(), 1); return state; }
  const mapUrl = place => 'https://yandex.ru/maps/?text=' + encodeURIComponent(place.address || [place.name, place.metro, place.location].filter(Boolean).join(' '));
  /* Обмен копиями: явный выбор целых групп, без графов версий и часов устройства. */
  const COPY_GROUPS = [
    ['source', 'Исходные сведения', ['source', 'lastCsvResult']],
    ['schedule', 'Расписание', ['plannedDate', 'firstPlannedDate']],
    ['documents', 'Готовность документов', ['documentsReady']],
    ['note', 'Локальная заметка', ['localNote']],
    ['result', 'Результат', ['result', 'lastConfirmedExportResult']],
    ['priority', 'Приоритет исполнителя', ['localPriority']]
  ];
  function sameCopyData(a, b) {
    const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    return stable(a) === stable(b);
  }
  function mergeCopies(current, copy, choices = {}) {
    validateState(current); validateState(copy);
    assert(current.workspaceId === copy.workspaceId, 'Это другая рабочая область. Для первого переноса на устройство используйте «Восстановить JSON», затем обменивайтесь копиями этой области.');
    const state = clone(current), incoming = clone(copy), conflicts = [];
    const summary = { newTasks: 0, newDestinations: 0, addedHistory: 0, changedTasks: 0 };
    const pick = (parts, label, local, file) => {
      if (sameCopyData(local, file)) return clone(local);
      const key = JSON.stringify(parts), choice = own(choices, key) ? choices[key] : null;
      assert(choice === null || choice === 'local' || choice === 'file', 'Неверный выбор версии');
      conflicts.push({ key, kind: parts[0], label, local: clone(local), file: clone(file), choice });
      return clone(choice === 'file' ? file : local);
    };
    const put = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
    // Независимые импорты одного суда могут создать разные ID мест. Совпадение
    // нормализованного имени однозначно связывает их; адрес не используется.
    const remap = new Map();
    for (const place of incoming.destinations) {
      const byId = state.destinations.find(p => p.id === place.id);
      const names = state.destinations.filter(p => norm(p.name) === norm(place.name));
      const match = byId || (names.length === 1 ? names[0] : null);
      const canonical = match ? match.id : place.id; remap.set(place.id, canonical);
      const normalized = { ...place, id: canonical };
      if (!match) { state.destinations.push(clone(normalized)); summary.newDestinations++; }
      else state.destinations[state.destinations.indexOf(match)] = pick(['place', canonical], 'Учреждение: ' + match.name, match, normalized);
    }
    incoming.tasks.forEach(t => { t.source.destinationId = remap.get(t.source.destinationId); });
    for (const [date, order] of Object.entries(incoming.dayOrders)) incoming.dayOrders[date] = [...new Set(order.map(id => remap.get(id)))];
    for (const key of Object.keys(incoming.destinationAliases)) incoming.destinationAliases[key] = remap.get(incoming.destinationAliases[key]);
    const tasks = new Map(state.tasks.map(t => [t.id, t]));
    for (const other of incoming.tasks) {
      const task = tasks.get(other.id);
      if (!task) { const added = clone(other); state.tasks.push(added); tasks.set(added.id, added); summary.newTasks++; summary.addedHistory += added.history.length; continue; }
      const changedGroups = [];
      for (const [group, label, fields] of COPY_GROUPS) {
        const values = t => Object.fromEntries(fields.map(field => [field, field === 'localPriority' ? t[field] ?? null : t[field]]));
        const before = values(task), selected = pick(['task', task.id, group], task.source.client + ' · ' + task.id + ' · ' + label, before, values(other));
        if (!sameCopyData(before, selected)) {
          fields.forEach(field => { task[field] = clone(selected[field]); }); changedGroups.push(label);
        }
      }
      const events = new Map(task.history.map(e => [e.id, e]));
      for (const entry of other.history) {
        const previous = events.get(entry.id);
        if (!previous) { const added = clone(entry); task.history.push(added); events.set(added.id, added); summary.addedHistory++; }
        else if (!sameCopyData(previous, entry)) {
          const selected = pick(['history', task.id, entry.id], task.id + ' · Событие истории ' + entry.id, previous, entry);
          task.history[task.history.findIndex(e => e.id === entry.id)] = selected;
        }
      }
      if (changedGroups.length) { event(task, 'copy-merge', { groups: changedGroups }); summary.changedTasks++; }
    }
    for (const [date, order] of Object.entries(incoming.dayOrders)) {
      const selected = pick(['order', date], 'Порядок поездок: ' + date.split('-').reverse().join('.'), state.dayOrders[date] || [], order);
      // Не создавать пустой ключ только из-за отсутствующей записи в старой копии.
      if (selected.length || own(state.dayOrders, date)) state.dayOrders[date] = selected;
    }
    for (const date of Object.keys(state.dayOrders)) if (!own(incoming.dayOrders, date)) state.dayOrders[date] = pick(['order', date], 'Порядок поездок: ' + date.split('-').reverse().join('.'), state.dayOrders[date], []);
    for (const [key, id] of Object.entries(incoming.destinationAliases)) {
      put(state.destinationAliases, key, own(state.destinationAliases, key) ? pick(['alias', key], 'Привязка названия: ' + key, state.destinationAliases[key], id) : id);
    }
    state.excludedDates = pick(['settings', 'excludedDates'], 'Исключённые рабочие даты', current.excludedDates, incoming.excludedDates);
    for (const [key, mapping] of Object.entries(incoming.importMappings)) put(state.importMappings, key, own(state.importMappings, key) ? pick(['mapping', key], 'Сопоставление столбцов: ' + (key === 'tasks' ? 'задачи' : 'места'), state.importMappings[key], mapping) : clone(mapping));
    const exports = new Map((state.pendingResultExports || []).map(item => [item.id, item]));
    for (const item of incoming.pendingResultExports || []) {
      const previous = exports.get(item.id);
      exports.set(item.id, previous ? pick(['export', item.id], 'Ожидающая CSV-выгрузка: ' + item.id, previous, item) : clone(item));
    }
    if (exports.size || state.pendingResultExports !== undefined) state.pendingResultExports = [...exports.values()];
    // Дата копии/передачи, отчёт последнего импорта и напоминание относятся к
    // этому браузеру. Не присваиваем ему факт чужого скачивания или передачи.
    validateState(state);
    return { state, conflicts, summary, ready: conflicts.every(c => c.choice), changed: !sameCopyData(current, state) };
  }
  class Store {
    constructor(storage) { this.storage = storage; this.state = emptyState(); this.raw = null; this.error = null; this.stale = false; this.candidate = null; this.load(); }
    load() { this.error = null; this.stale = false; try { this.raw = this.storage.getItem(KEY); this.state = this.raw === null ? emptyState() : validateState(JSON.parse(this.raw)); } catch (e) { this.error = e.message; } }
    size(state = this.state) { return JSON.stringify(state).length * 2; }
    commit(next, restore = false) {
      const candidate = clone(next);
      try {
        assert(!this.stale, 'Данные изменены в другой вкладке. Перезагрузите страницу');
        assert(restore || !this.error, 'Сначала восстановите повреждённые данные');
        assert(this.storage.getItem(KEY) === this.raw, 'Данные изменены в другой вкладке. Перезагрузите страницу');
        candidate.revision = this.state.revision + 1; validateState(candidate);
        assert(!(this.size(candidate) > 4 * 1024 * 1024 && this.size(candidate) > this.size()), 'Размер превышает 4 MiB. Скачайте несохранённые изменения');
        const serialized = JSON.stringify(candidate); this.storage.setItem(KEY, serialized);
        this.raw = serialized; this.state = candidate; this.error = null; this.candidate = null; return true;
      } catch (e) { this.candidate = candidate; this.lastWriteError = e.message; if (/другой вкладке/.test(e.message)) this.stale = true; return false; }
    }
    checkExternal() { try { if (this.storage.getItem(KEY) !== this.raw) this.stale = true; } catch (e) { this.error = e.message; } return this.stale; }
  }
  const Core = { KEY, PRIORITIES, STATUSES, HEADERS, own, clone, norm, equal, uid, now, today, setClock, emptyState, parseDate, status, validateState, parseCSV, detectSeparator, headerIndex, mappingFor, mappedRows, isResultsCSV, openXlsx, mergeResult, buildImport, filterTasks, summary, addDays, weekStart, isWorkday, nextWorkday, trips, planTasks, reorderTrip, rollover, undoPlanning, effectivePriority, setTaskPriority, setDocuments, setNote, recordResult, csvCell, exportResults, registerResultsExport, confirmResultsExport, backupHash, backupReminder, markBackup, snoozeBackup, mapUrl, Store, COPY_GROUPS, mergeCopies };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.PlannerCore = Core;
})(typeof window !== 'undefined' ? window : globalThis);

/* Интерфейс: импорт, списки и планирование. */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  const C = window.PlannerCore, $ = selector => document.querySelector(selector);
  try { new TextDecoder('windows-1251'); new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(new Date()); }
  catch (_) { $('#main').textContent = 'Браузер не поддерживает Windows-1251 или московский часовой пояс. Используйте Chrome или Edge версии 120 и выше.'; document.querySelectorAll('button').forEach(node => node.disabled = true); return; }
  const store = new C.Store({ getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) });
  let page = 'week', wizard = null, restoreCandidate = null, mergeSession = null, toastTimer;
  let filters = { view: 'unplanned', search: '' };
  let selectedDay = C.today(), selectedTasks = new Set(), undoRecord = null, rolloverPending = false, listObserver = null;
  const modal = $('#modal');
  const kindNames = { new: 'Новая задача', source: 'Исходные сведения', priority: 'Приоритет', cancelled: 'Отмена задачи', reopened: 'Возврат в работу', result: 'Результат', order: 'Порядок поездок', 'place-new': 'Новое место', 'place-changed': 'Сведения места', skipped: 'Исключённая строка', schedule: 'Назначен день', reschedule: 'Задача перенесена', unplan: 'Дата снята', 'auto-rollover': 'Автоматический перенос', 'trip-order': 'Изменён порядок поездок', 'undo-plan': 'Отменено действие планирования' };
  kindNames['copy-merge'] = 'Объединение копий';
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'value') node.value = value;
      else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = value;
      else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    }
    for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
  }
  const button = (text, action, style = '', disabled = false) => el('button', { type: 'button', class: 'button ' + style, onclick: action, disabled }, text);
  function select(id, values, selected, change) {
    const node = el('select', { id, onchange: event => change(event.target.value) }, values.map(([value, label]) => el('option', { value }, label)));
    node.value = selected ?? ''; return node;
  }
  const field = (label, control) => el('div', { class: 'field' }, el('label', { for: control.id }, label), control);
  const input = (id, value, type = 'text', change = null) => el('input', { id, type, value: value || '', ...(change ? { oninput: e => change(e.target.value) } : {}) });
  const formatDate = date => date ? date.split('-').reverse().join('.') : 'Не указана';
  const sizeText = bytes => (bytes / 1024 / 1024).toFixed(2) + ' MiB';
  const stampText = stamp => stamp ? new Date(stamp).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'Ещё не создавалась';
  function display(value) {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
    if (typeof value === 'string') return C.own(C.PRIORITIES, value) ? C.PRIORITIES[value] : C.own(C.STATUSES, value) ? C.STATUSES[value] : value === 'none' ? 'Нет результата' : /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value || '—';
    if (Array.isArray(value)) return value.map(display).join('\n') || '—';
    if (typeof value !== 'object') return String(value);
    const labels = { id: 'ID', name: 'Учреждение', createdBy: 'Постановщик', createdDate: 'Дата постановки', client: 'Клиент', documentNumber: 'Документ', destinationId: 'ID места', description: 'Поручение', priority: 'Приоритет', metro: 'Метро', address: 'Адрес', location: 'Расположение', aliases: 'Другие названия', outcome: 'Результат', date: 'Дата', comment: 'Комментарий', source: 'Сведения задачи', result: 'Результат', before: 'До изменения', after: 'После изменения', line: 'Строка', localNote: 'Заметка', localPriority: 'Приоритет исполнителя', plannedDate: 'Дата поездки', firstPlannedDate: 'Первая дата планирования', documentsReady: 'Документы готовы', lastCsvResult: 'Последний результат таблицы', lastConfirmedExportResult: 'Подтверждённая передача в таблицу', groups: 'Принятые группы', at: 'Время события', type: 'Действие', changes: 'Изменения' };
    return Object.entries(value).map(([key, item]) => (C.own(labels, key) ? labels[key] : key) + ': ' + (key === 'localPriority' && item === null ? 'Из таблицы' : display(item))).join('\n');
  }
  function toast(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
  function download(filename, content, mime = 'application/json;charset=utf-8') {
    const blob = new Blob([content], { type: mime }), url = URL.createObjectURL(blob), a = el('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const filename = prefix => prefix + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  function backup() {
    if (store.error) { download(filename('planner-original'), store.raw || '', 'text/plain;charset=utf-8'); return; }
    const candidate = C.markBackup(store.state);
    if (store.stale) { download(filename('planner-copy'), JSON.stringify(store.state, null, 2)); toast('Скачана копия этой вкладки. Она может быть устаревшей'); return; }
    if (store.commit(candidate)) { download(filename('planner-backup'), JSON.stringify(store.state, null, 2)); render(); toast('Резервная копия скачана'); }
    else { download(filename('planner-unsaved'), JSON.stringify(candidate, null, 2)); renderAlerts(); }
  }
  function renderAlerts() {
    if (undoRecord && undoRecord.revision !== store.state.revision) undoRecord = null;
    const messages = [];
    if (!store.error && !store.stale && C.backupReminder(store.state)) messages.push(el('div', { class: 'backup-reminder', role: 'status' }, el('span', {}, 'Сохраните резервную JSON-копию: есть данные, требующие копирования.'), el('div', { class: 'button-row' }, button('Создать копию', backup, 'small'), button('Напомнить завтра', () => { if (store.commit(C.snoozeBackup(store.state))) render(); else { renderAlerts(); toast(store.lastWriteError); } }, 'small'))));
    if (store.error) messages.push(el('div', { class: 'alert' }, el('strong', {}, 'Данные не загружены. Запись заблокирована'), el('div', {}, store.error), el('div', { class: 'button-row' }, button('Скачать исходное хранилище', () => download(filename('planner-original'), store.raw || '', 'text/plain;charset=utf-8')), button('Восстановить JSON', openRestore))));
    else if (store.stale) messages.push(el('div', { class: 'alert' }, el('strong', {}, 'Данные изменены в другой вкладке'), el('div', {}, 'Эта вкладка больше не записывает изменения. Загрузите актуальные данные.'), button('Перезагрузить данные', () => location.reload(), 'small')));
    if (store.candidate) messages.push(el('div', { class: 'alert' }, el('strong', {}, 'Изменения не сохранены'), el('div', {}, store.lastWriteError), button('Скачать несохранённые изменения', () => download(filename('planner-unsaved'), JSON.stringify(store.candidate, null, 2)), 'small')));
    if (!store.error && store.size() >= 2 * 1024 * 1024) messages.push(el('div', { class: 'alert' }, 'Объём данных: ' + sizeText(store.size()) + '. Создайте резервную копию. История не удаляется автоматически.'));
    $('#alerts').replaceChildren(...messages);
    $('#save-state').textContent = store.error || store.candidate ? 'Есть проблема с сохранением' : store.stale ? 'Только просмотр' : store.raw === null ? 'Данные ещё не импортированы' : 'Все изменения сохранены';
    $('#undo-planning').hidden = !undoRecord || undoRecord.revision !== store.state.revision || store.stale || !!store.error;
  }
  function heading(title, subtitle, action = null) { return el('div', { class: 'page-heading' }, el('div', {}, el('h1', {}, title), el('p', {}, subtitle)), action); }
  function render() {
    const calendar = page === 'week' || page === 'day';
    document.querySelector('.sidebar').classList.toggle('planning-sidebar', calendar);
    $('#sidebar-backlog').hidden = !calendar;
    if (!calendar) $('#sidebar-backlog').replaceChildren();
    if (page !== 'tasks' && listObserver) { listObserver.disconnect(); listObserver = null; }
    renderAlerts();
    document.querySelectorAll('[data-page]').forEach(node => node.classList.toggle('active', node.dataset.page === page));
    if (page === 'tasks') renderTasks(); else if (page === 'exchange') renderExchange(); else if (page === 'week' || page === 'day') renderCalendar(); else renderSettings();
  }
  function stats() {
    const data = C.summary(store.state);
    const items = [[data.activeCount, 'Активных задач', 'active', () => showTasks('active')], [data.destinations.length, 'Мест назначения по активным задачам', 'destinations', showActiveDestinations], [data.completedCount, 'Выполнено', 'completed', () => showTasks('completed')]];
    return el('div', { class: 'stats', role: 'group', 'aria-label': 'Сводка задач' }, items.map(([count, label, key, action]) => el('button', { type: 'button', class: 'stat', 'data-stat': key, onclick: action }, el('strong', {}, count), el('span', {}, label))));
  }
  function showTasks(view, destination = '') {
    filters = { view, search: '', destination }; selectedTasks.clear(); page = 'tasks'; render();
  }
  function showActiveDestinations() {
    const destinations = C.summary(store.state).destinations;
    const body = destinations.length ? el('div', { class: 'task-list' }, destinations.map(place => el('article', { class: 'task-card', 'data-active-destination': place.id }, el('h3', {}, place.name), el('p', { class: 'muted' }, [place.metro, place.address, place.location].filter(Boolean).join(' · ') || 'Адрес и метро не указаны'), button('Показать задачи · ' + place.taskCount, () => { closeDialog(); showTasks('active', place.id); }, 'small')))) : el('div', { class: 'empty' }, el('h3', {}, 'Мест по активным задачам пока нет'), el('p', {}, 'Здесь появятся суды и учреждения, по которым есть невыполненные задачи.'));
    openDialog('Места назначения по активным задачам', 'Только учреждения, куда ещё нужно ехать. Выполненные и отменённые задачи не учитываются.', body, [button('Закрыть', closeDialog)]);
  }
  function renderTasks() {
    const all = store.state.tasks;
    const root = el('div', {}, heading('Задачи', 'Все поручения, документы и места — в одном списке.', button('Импортировать файл', () => openImport('tasks'), 'primary', !!store.error || store.stale)), stats());
    const tabs = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Представления задач' }, [['unplanned', 'Незапланированные'], ['active', 'Активные'], ['completed', 'Выполненные'], ['cancelled', 'Отменённые'], ['all', 'Все']].map(([value, label]) => el('button', { class: 'tab' + (filters.view === value ? ' active' : ''), type: 'button', 'aria-pressed': filters.view === value, onclick: () => { filters.view = value; selectedTasks.clear(); renderTasks(); } }, label)));
    const search = input('search', filters.search, 'search', value => { filters.search = value; selectedTasks.clear(); renderList(); }); search.placeholder = 'Клиент, документ, учреждение или текст задачи';
    const places = store.state.destinations.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const choices = (values, label) => [['', label], ...values];
    const change = key => value => { filters[key] = value; selectedTasks.clear(); renderList(); };
    const baseFilters = el('div', { class: 'filters' },
      field('Место назначения', select('filter-destination', choices(places.map(p => [p.id, p.name]), 'Все места'), filters.destination, change('destination'))),
      field('Постановщик', select('filter-createdBy', choices([...new Set(all.map(t => t.source.createdBy).filter(Boolean))].sort().map(v => [v, v]), 'Все сотрудники'), filters.createdBy, change('createdBy'))),
      field('Приоритет', select('filter-priority', choices(Object.entries(C.PRIORITIES), 'Все приоритеты'), filters.priority, change('priority'))),
      field('Статус', select('filter-status', choices(Object.entries(C.STATUSES), 'Все статусы'), filters.status, change('status'))),
      field('Готовность документов', select('filter-ready', [['', 'Любая'], ['yes', 'Готовы'], ['no', 'Не готовы']], filters.ready, change('ready'))),
      field('Расположение', select('filter-location', choices([...new Set(places.map(p => p.location).filter(Boolean))].sort().map(v => [v, v]), 'Любое'), filters.location, change('location'))));
    const dates = el('details', { class: 'filter-dates' }, el('summary', {}, 'Фильтры по датам'), el('div', { class: 'filters' }, [['createdFrom', 'Поставлена с'], ['createdTo', 'Поставлена по'], ['plannedFrom', 'Поездка с'], ['plannedTo', 'Поездка по']].map(([key, label]) => field(label, input('filter-' + key, filters[key], 'date', change(key))))));
    root.append(el('section', { class: 'panel', 'aria-label': 'Поиск и фильтры' }, tabs, field('Поиск по задачам', search), baseFilters, dates));
    root.append(el('div', { class: 'list-meta' }, el('span', { id: 'list-count', role: 'status' }), button('Сбросить фильтры', () => { filters = { view: filters.view, search: '' }; selectedTasks.clear(); renderTasks(); }, 'small')));
    root.append(el('div', { id: 'bulk-planning' }), el('div', { id: 'task-list', class: 'task-list' })); $('#main').replaceChildren(root); renderList();
  }
  function renderList() {
    if (listObserver) { listObserver.disconnect(); listObserver = null; }
    if (!$('#task-list')) return;
    const tasks = C.filterTasks(store.state, filters); $('#list-count').textContent = `Найдено ${tasks.length} · Всего ${store.state.tasks.length}`;
    const visibleIds = new Set(tasks.filter(t => !['completed', 'cancelled'].includes(C.status(t))).map(t => t.id)); selectedTasks = new Set([...selectedTasks].filter(id => visibleIds.has(id)));
    renderBulkPlanning(tasks);
    if (!tasks.length) {
      $('#task-list').replaceChildren(el('div', { class: 'empty' }, el('div', { class: 'empty-symbol', 'aria-hidden': 'true' }, '≡'), el('h2', {}, store.state.tasks.length ? 'Задач по этим условиям нет' : 'Начните с импорта задач'), el('p', {}, store.state.tasks.length ? 'Измените представление или сбросьте фильтры.' : 'Выберите Excel-файл (.xlsx) или перетащите его на страницу. У каждой задачи должен быть постоянный ID из исходной таблицы. CSV тоже поддерживается.'), !store.state.tasks.length ? button('Выбрать файл', () => openImport('tasks'), 'primary', !!store.error || store.stale) : null)); return;
    }
    if (tasks.length <= 80 || !window.IntersectionObserver) { $('#task-list').replaceChildren(...tasks.map(taskCard)); return; }
    const byId = new Map(tasks.map(task => [task.id, task]));
    const mount = node => {
      if (!node.isConnected) return;
      const focused = document.activeElement === node, card = taskCard(byId.get(node.dataset.taskId));
      listObserver?.unobserve(node); node.replaceWith(card);
      if (focused) card.querySelector('a,button,input,select')?.focus();
    };
    listObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        mount(entry.target);
      }
    }, { rootMargin: '500px 0px' });
    const placeholders = tasks.map(task => el('article', { class: 'task-card task-placeholder', 'data-task-id': task.id, tabindex: 0, onfocus: e => mount(e.currentTarget) }, el('strong', {}, task.source.client), el('small', {}, task.id)));
    $('#task-list').replaceChildren(...placeholders); placeholders.forEach(node => listObserver.observe(node));
  }
  function taskCard(task) {
    const place = store.state.destinations.find(p => p.id === task.source.destinationId), s = C.status(task);
    const detailValues = [['Постановщик', task.source.createdBy || 'Не указан'], ['Дата постановки', formatDate(task.source.createdDate)], ['Дата поездки', formatDate(task.plannedDate)], ['Первая дата планирования', formatDate(task.firstPlannedDate)], ['Документы', task.documentsReady ? 'Готовы' : 'Не отмечены готовыми'], ['Расположение', place.location || 'Не указано'], ['Локальная заметка', task.localNote || 'Нет'], ['Последний результат', C.STATUSES[s] + (task.result.date ? ' · ' + formatDate(task.result.date) : '') + (task.result.comment ? '\n' + task.result.comment : '')]];
    return el('article', { class: 'task-card priority-' + C.effectivePriority(task), 'data-task-id': task.id },
      el('div', { class: 'task-top' }, el('div', {}, el('span', { class: 'task-client' }, task.source.client), el('div', { class: 'task-id' }, task.id)), el('div', { class: 'button-row' }, el('span', { class: 'badge ' + C.effectivePriority(task) }, C.PRIORITIES[C.effectivePriority(task)]), el('span', { class: 'badge ' + s }, C.STATUSES[s]))),
      el('div', { class: 'task-place' }, place.name), mapLink(place), el('div', { class: 'muted', style: 'font-size:12px' }, [place.metro, place.address].filter(Boolean).join(' · ') || 'Адрес не указан'),
      el('p', { class: 'task-description' }, task.source.description || 'Описание не заполнено'),
      el('div', { class: 'task-meta' }, el('span', {}, 'Документ: ' + (task.source.documentNumber || 'не указан')), el('span', {}, 'Поставил: ' + (task.source.createdBy || 'не указан')), el('span', {}, formatDate(task.source.createdDate)), task.plannedDate ? el('span', {}, 'Поездка: ' + formatDate(task.plannedDate)) : null),
      C.status(task) !== 'completed' && C.status(task) !== 'cancelled' ? el('div', {}, priorityControl([task.id], task), taskPlanningControls(task)) : null,
      taskWorkControls(task),
      el('details', { class: 'task-details' }, el('summary', {}, 'Подробнее и история'), el('dl', { class: 'detail-grid' }, detailValues.map(([label, text]) => el('div', {}, el('dt', {}, label), el('dd', {}, text)))), el('h3', { class: 'top-gap' }, 'История'), task.history.map(entry => el('div', { class: 'history-event' }, stampText(entry.at) + ' · ' + (kindNames[entry.type.replace(/-import$/, '')] || (entry.type === 'import-new' ? 'Первый импорт' : entry.type)), el('div', { class: 'muted' }, display(entry.changes))))));
  }
  kindNames['local-priority'] = 'Приоритет исполнителя';
  Object.assign(kindNames, { documents: 'Готовность документов', note: 'Локальная заметка', completed: 'Задача выполнена', failed: 'Неудачная попытка', 'undo-documents': 'Отменено изменение готовности', 'undo-note': 'Отменено изменение заметки' });
  function taskWorkControls(task) {
    const blocked = !!store.error || store.stale, active = !['completed', 'cancelled'].includes(task.result.outcome);
    return el('div', { class: 'task-work' },
      el('label', { class: 'check-box' }, el('input', { type: 'checkbox', checked: task.documentsReady, disabled: blocked, onchange: e => {
        try { if (!planningSave(C.setDocuments(store.state, [task.id], e.target.checked), 'Готовность документов сохранена')) e.target.checked = task.documentsReady; } catch (error) { toast(error.message); }
      } }), 'Документы готовы'),
      task.localNote ? el('p', { class: 'local-note' }, el('strong', {}, 'Заметка: '), task.localNote) : null,
      task.result.outcome === 'failed' ? el('div', { class: 'attempt-note' }, el('strong', {}, 'Неудачная попытка · ' + formatDate(task.result.date)), el('p', {}, task.result.comment)) : null,
      el('div', { class: 'button-row' }, button(task.localNote ? 'Изменить заметку' : 'Добавить заметку', () => openNote(task.id), 'small', blocked),
        active ? button('Выполнено', () => openResult(task.id, 'completed'), 'small success', blocked) : null,
        active ? button('Не удалось', () => openResult(task.id, 'failed'), 'small', blocked) : null,
        button('История', () => openDialog('История задачи', task.source.client + ' · ' + task.id,
          el('div', {}, task.history.length ? task.history.map(entry => el('div', { class: 'history-event' }, stampText(entry.at) + ' · ' + (kindNames[entry.type.replace(/-import$/, '')] || entry.type), el('div', { class: 'muted' }, display(entry.changes)))) : el('p', {}, 'История пока пуста.')), [button('Закрыть', closeDialog)]), 'small')));
  }
  function groupDocuments(ids) {
    const blocked = !!store.error || store.stale;
    return el('div', { class: 'button-row top-gap' }, button('Все документы готовы', () => {
      openDialog('Готовность документов поездки', 'Отметить документы у всех активных задач этой поездки?',
        el('p', {}, 'Задач: ' + ids.length), [button('Отмена', closeDialog), button('Подтвердить готовность', () => { if (planningSave(C.setDocuments(store.state, ids, true), 'Все документы отмечены готовыми')) closeDialog(); }, 'primary')]);
    }, 'small', blocked), button('Снять готовность у всех', () => { planningSave(C.setDocuments(store.state, ids, false), 'Готовность документов снята'); }, 'small', blocked));
  }
  function openNote(id) {
    const task = store.state.tasks.find(t => t.id === id); if (!task || store.error || store.stale) return;
    const text = el('textarea', { id: 'note-text', rows: 6, maxlength: 2000 }, task.localNote), error = el('div', { class: 'error-text', role: 'alert' });
    openDialog('Локальная заметка', task.source.client + ' · Исходное поручение останется прежним.',
      el('div', { class: 'form-stack' }, field('Заметка — до 2000 символов', text), error),
      [button('Отмена', closeDialog), button('Сохранить заметку', () => { try { if (planningSave(C.setNote(store.state, id, text.value), 'Заметка сохранена')) closeDialog(); } catch (e) { error.textContent = e.message; } }, 'primary')]);
  }
  function openResult(id, outcome) {
    const task = store.state.tasks.find(t => t.id === id); if (!task || store.error || store.stale) return;
    const completed = outcome === 'completed', date = input('result-date', C.today(), 'date'); date.max = C.today();
    const text = el('textarea', { id: 'result-comment', rows: 5, maxlength: 4000 });
    const confirmation = el('input', { id: 'result-confirm', type: 'checkbox' }), error = el('div', { id: 'result-error', class: 'error-text', role: 'alert' });
    const submit = () => {
      try {
        if (completed && !confirmation.checked) throw new Error('Подтвердите выполнение задачи');
        const next = C.recordResult(store.state, id, outcome, date.value, text.value);
        if (!store.commit(next)) { renderAlerts(); error.textContent = store.lastWriteError; return; }
        undoRecord = null; render(); closeDialog(); toast(completed ? 'Задача выполнена' : 'Неудачная попытка сохранена');
        if (!completed) {
          const updated = store.state.tasks.find(t => t.id === id);
          openScheduling([id], updated.plannedDate && updated.plannedDate >= C.today() ? updated.plannedDate : C.today());
        }
      } catch (e) { error.textContent = e.message; }
    };
    openDialog(completed ? 'Выполнение задачи' : 'Неудачная попытка', task.source.client + ' · ' + task.id,
      el('div', { class: 'form-stack' }, field('Дата результата', date), field(completed ? 'Комментарий — до 4000 символов, необязательно' : 'Причина — обязательно, до 4000 символов', text),
        completed ? el('label', { class: 'check-box' }, confirmation, 'Подтверждаю, что задача выполнена') : null, error),
      [button('Отмена', closeDialog), button(completed ? 'Подтвердить выполнение' : 'Сохранить попытку', submit, 'primary')]);
  }
  function priorityControl(ids, task) {
    const control = select('priority-' + (task ? task.id : 'court-' + ids[0]), [
      ...(!task ? [['', 'Выберите для всех задач']] : []),
      ['source', task ? 'Из таблицы: ' + C.PRIORITIES[task.source.priority] : 'Вернуть приоритеты из таблицы'],
      ...Object.entries(C.PRIORITIES)
    ], task ? task.localPriority ?? 'source' : '', value => {
      if (!value) return;
      try {
        const next = C.setTaskPriority(store.state, ids, value === 'source' ? null : value);
        if (C.equal(next, store.state)) return;
        if (store.commit(next)) { undoRecord = null; render(); toast('Приоритет сохранён. Порядок поездок обновлён'); }
        else { renderAlerts(); toast(store.lastWriteError); }
      } catch (error) { toast(error.message); }
    });
    control.disabled = !!store.error || store.stale;
    return field(task ? 'Приоритет задачи' : 'Приоритет суда на этот день', control);
  }
  function planningSave(next, message) {
    if (C.equal(next, store.state)) { toast('Данные уже соответствуют выбранному действию'); return true; }
    const before = C.clone(store.state);
    if (!store.commit(next)) { renderAlerts(); toast(store.lastWriteError); return false; }
    undoRecord = { before, revision: store.state.revision }; selectedTasks.clear(); render(); toast(message); return true;
  }
  function checkRollover() {
    if (store.error || store.stale) return;
    if (modal.open) { rolloverPending = true; return; }
    rolloverPending = false;
    const moved = C.rollover(store.state);
    if (moved.count) {
      if (store.commit(moved.state)) { undoRecord = null; selectedTasks.clear(); render(); toast('Перенесено задач: ' + moved.count + ' · ' + formatDate(moved.target)); }
      else renderAlerts();
    }
    renderAlerts();
    $('#today').textContent = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'Europe/Moscow' }).format(new Date(C.today() + 'T12:00:00Z'));
  }
  function renderBulkPlanning(tasks = C.filterTasks(store.state, filters)) {
    const target = $('#bulk-planning'); if (!target) return;
    const ids = tasks.filter(t => !['completed', 'cancelled'].includes(C.status(t))).map(t => t.id);
    target.replaceChildren(ids.length ? el('div', { class: 'bulk-bar' }, el('span', {}, 'Выбрано: ' + selectedTasks.size), button('Выбрать все активные в списке', () => { selectedTasks = new Set(ids); renderList(); }, 'small', !!store.error || store.stale), button('Назначить день', () => openScheduling([...selectedTasks]), 'small primary', !selectedTasks.size || !!store.error || store.stale), selectedTasks.size ? button('Снять выделение', () => { selectedTasks.clear(); renderList(); }, 'small') : null) : null);
  }
  function endCalendarDrag() {
    const guide = document.querySelector('.week-transfer-bar'); if (guide) guide.hidden = true;
    document.querySelectorAll('.week-transfer-day.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
  }
  function dragStart(e, payload) {
    e.stopPropagation();
    e.dataTransfer.setData('application/x-planner', JSON.stringify(payload)); e.dataTransfer.effectAllowed = 'move';
    const guide = document.querySelector('.week-transfer-bar'), anchor = document.querySelector('#sidebar-backlog');
    if (guide && anchor) {
      const rect = anchor.getBoundingClientRect(), title = anchor.querySelector('.calendar-backlog>summary');
      const top = Math.max(8, Math.min(title ? title.getBoundingClientRect().bottom : rect.top, innerHeight - 280));
      const left = Math.max(8, Math.min(rect.left, innerWidth - 150));
      Object.assign(guide.style, { top: top + 'px', left: left + 'px', width: Math.min(rect.width, innerWidth - left - 8) + 'px', maxHeight: Math.max(100, innerHeight - top - 10) + 'px' });
      guide.hidden = false;
    }
  }
  function cardDrag(payload, blocked) {
    if (blocked) return {};
    let interactive = false;
    return { draggable: 'true', ondragend: endCalendarDrag, onpointerdown: e => { interactive = !!e.target.closest('button,input,select,textarea,a,label,summary'); }, ondragstart: e => {
      e.stopPropagation();
      if (interactive) { e.preventDefault(); return; }
      dragStart(e, payload);
    } };
  }
  function dragHandle(text, payload) { return el('span', { class: 'drag-handle', draggable: 'true', title: 'Перетащите на нужный день', ondragstart: e => dragStart(e, payload), ondragend: endCalendarDrag }, text); }
  function taskPlanningControls(task) {
    const blocked = !!store.error || store.stale;
    return el('div', { class: 'task-planning' }, el('label', { class: 'check-box' }, el('input', { type: 'checkbox', class: 'task-select', 'aria-label': 'Выбрать задачу ' + task.id, checked: selectedTasks.has(task.id), disabled: blocked, onchange: e => { if (e.target.checked) selectedTasks.add(task.id); else selectedTasks.delete(task.id); renderBulkPlanning(); } }), 'Выбрать'), el('div', { class: 'button-row' }, button(task.plannedDate ? 'Перенести' : 'Назначить день', () => openScheduling([task.id]), 'small', blocked), task.plannedDate ? button('Снять дату', () => { try { planningSave(C.planTasks(store.state, [task.id], null), 'Задача возвращена в незапланированные'); } catch (e) { toast(e.message); } }, 'small', blocked) : null, blocked ? null : dragHandle('↗ На день', { type: 'tasks', ids: [task.id] })));
  }
  function openScheduling(ids, defaultDate = null) {
    if (!ids.length || store.error || store.stale) return;
    const tasks = store.state.tasks.filter(t => ids.includes(t.id)), same = tasks.every(t => t.plannedDate === tasks[0].plannedDate);
    const initial = defaultDate || (same && tasks[0].plannedDate) || (selectedDay >= C.today() ? selectedDay : C.today());
    const dateInput = input('schedule-date', initial, 'date'); dateInput.min = C.today();
    const consent = el('input', { id: 'schedule-consent', type: 'checkbox' });
    const warning = el('div', { id: 'schedule-warning', class: 'info-box warning' });
    const errorNode = el('div', { id: 'schedule-error', class: 'error-text', role: 'alert' });
    const refreshWarning = () => { consent.checked = false; warning.replaceChildren(); if (dateInput.value && !C.isWorkday(store.state, dateInput.value)) warning.append(el('label', { class: 'check-box' }, consent, 'Это выходной или исключённая дата. Подтверждаю назначение поездки на этот день')); };
    dateInput.addEventListener('input', refreshWarning); refreshWarning();
    const submit = () => { try { const next = C.planTasks(store.state, ids, dateInput.value, { allowNonWorking: consent.checked }); if (planningSave(next, 'Дата сохранена. Поездки упорядочены по приоритетам')) closeDialog(); } catch (e) { errorNode.textContent = e.message; } };
    openDialog('Назначить день поездки', 'Задач: ' + ids.length + '. Задачи одного учреждения объединятся в одну поездку.', el('div', { class: 'form-stack' }, field('Дата поездки', dateInput), warning, errorNode), [button('Отмена', closeDialog), button('Сохранить дату', submit, 'primary')]);
  }
  function handlePlanningDrop(e, date, beforeDestination = null) {
    const raw = e.dataTransfer.getData('application/x-planner'); if (!raw) return;
    e.preventDefault(); e.stopPropagation();
    endCalendarDrag();
    try {
      const payload = JSON.parse(raw);
      if (payload.type === 'trip' && payload.date === date && beforeDestination) {
        const order = C.trips(store.state, date).map(t => t.destination.id), from = order.indexOf(payload.destinationId), target = order.indexOf(beforeDestination);
        if (from >= 0 && target >= 0 && from !== target) planningSave(C.reorderTrip(store.state, date, payload.destinationId, from < target ? target - 1 : target), 'Порядок поездок сохранён');
      } else if (!C.isWorkday(store.state, date)) openScheduling(payload.ids, date);
      else planningSave(C.planTasks(store.state, payload.ids, date), 'Задачи перенесены на ' + formatDate(date) + '. Порядок обновлён по приоритетам');
    } catch (error) { toast(error.message); }
  }
  const dragOver = e => { if (Array.from(e.dataTransfer.types).includes('application/x-planner')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } };
  function handleBacklogDrop(e) {
    const raw = e.dataTransfer.getData('application/x-planner'); if (!raw) return;
    e.preventDefault(); e.stopPropagation();
    endCalendarDrag();
    if (store.error || store.stale) return;
    try {
      const payload = JSON.parse(raw);
      if (!['tasks', 'trip'].includes(payload.type) || !Array.isArray(payload.ids) || !payload.ids.length) throw new Error('Не удалось определить переносимые задачи');
      planningSave(C.planTasks(store.state, payload.ids, null), 'Задачи возвращены в незапланированные');
    } catch (error) { toast(error.message); }
  }
  function calendarTrip(trip, date, index, count) {
    const id = trip.destination.id, ids = trip.tasks.map(t => t.id), blocked = !!store.error || store.stale;
    const move = step => { try { planningSave(C.reorderTrip(store.state, date, id, index + step), 'Порядок поездок сохранён'); } catch (e) { toast(e.message); } };
    const unplan = selected => { try { planningSave(C.planTasks(store.state, selected, null), 'Задачи возвращены в незапланированные'); } catch (error) { toast(error.message); } };
    return el('article', { class: 'trip-card priority-' + trip.priority, 'data-trip-id': id, 'data-trip-date': date, ...cardDrag({ type: 'trip', ids, date, destinationId: id }, blocked), ondragover: dragOver, ondrop: e => handlePlanningDrop(e, date, id) },
      el('div', { class: 'trip-heading' }, el('strong', {}, trip.destination.name), el('span', { class: 'badge ' + trip.priority }, C.PRIORITIES[trip.priority])),
      el('p', { class: 'trip-address' }, [trip.destination.metro, trip.destination.address, trip.destination.location].filter(Boolean).join(' · ') || 'Адрес и метро не указаны'),
      el('div', { class: 'trip-counts' }, 'Задач: ' + ids.length + ' · Документы готовы: ' + trip.tasks.filter(t => t.documentsReady).length + '/' + ids.length, trip.accumulated ? el('span', { class: 'accumulated' }, 'Накопившихся: ' + trip.accumulated) : null),
      el('div', { class: 'button-row' }, button('Перенести поездку', () => openScheduling(ids, date), 'small', blocked), button('Снять дату поездки', () => unplan(ids), 'small', blocked), button('↑', () => move(-1), 'small', blocked || index === 0), button('↓', () => move(1), 'small', blocked || index === count - 1), blocked ? null : dragHandle('↗', { type: 'trip', ids, date, destinationId: id })),
      el('div', { class: 'button-row' }, mapLink(trip.destination), button('Печать поездки', () => printPlan(date, id), 'small')),
      priorityControl(ids), groupDocuments(ids),
      el('details', { class: 'trip-tasks' }, el('summary', {}, 'Задачи поездки · ' + ids.length), trip.tasks.map(task => el('div', { class: 'trip-task priority-' + C.effectivePriority(task), 'data-trip-task': task.id, ...cardDrag({ type: 'tasks', ids: [task.id] }, blocked) },
        el('strong', {}, task.source.client), el('small', {}, 'Документ: ' + (task.source.documentNumber || 'не указан')),
        el('div', { class: 'trip-task-meta' }, el('span', {}, 'Постановщик: ' + (task.source.createdBy || 'Не указан')), el('span', {}, 'Дата постановки: ' + formatDate(task.source.createdDate)), el('span', { class: 'badge ' + C.status(task) }, C.STATUSES[C.status(task)])),
        el('p', {}, task.source.description || 'Описание не заполнено'), priorityControl([task.id], task), taskWorkControls(task),
        el('div', { class: 'button-row' }, button('Перенести задачу', () => openScheduling([task.id], date), 'small', blocked), button('Снять дату', () => unplan([task.id]), 'small', blocked), blocked ? null : dragHandle('↗', { type: 'tasks', ids: [task.id] }))))));
  }
  function backlogCourt(trip) {
    const ids = trip.tasks.map(task => task.id), blocked = !!store.error || store.stale;
    return el('article', { class: 'backlog-court priority-' + trip.priority, 'data-backlog-court': trip.destination.id },
      el('div', { class: 'trip-heading' }, el('strong', {}, trip.destination.name), el('span', { class: 'badge ' + trip.priority }, C.PRIORITIES[trip.priority])),
      el('small', {}, 'Незапланированных задач: ' + ids.length),
      el('div', { class: 'button-row' }, button('Назначить день всему суду', () => openScheduling(ids, selectedDay), 'small', blocked), blocked ? null : dragHandle('↗ Весь суд на день', { type: 'tasks', ids })),
      el('details', { class: 'backlog-court-tasks' }, el('summary', {}, 'Показать задачи · ' + ids.length),
        trip.tasks.map(task => el('div', { class: 'backlog-task priority-' + C.effectivePriority(task), 'data-backlog-task': task.id },
          el('strong', {}, task.source.client), el('span', { class: 'badge ' + C.effectivePriority(task) }, C.PRIORITIES[C.effectivePriority(task)]),
          el('small', {}, 'Документ: ' + (task.source.documentNumber || 'не указан')), el('p', {}, task.source.description || 'Описание не заполнено'),
          el('div', { class: 'button-row' }, button('Назначить день', () => openScheduling([task.id], selectedDay), 'small', blocked), blocked ? null : dragHandle('↗ На день', { type: 'tasks', ids: [task.id] }))))));
  }
  function renderCalendar() {
    const weekly = page === 'week', first = weekly ? C.weekStart(selectedDay) : selectedDay, dates = Array.from({ length: weekly ? 7 : 1 }, (_, i) => C.addDays(first, i));
    const navigate = step => { selectedDay = C.addDays(selectedDay, step * (weekly ? 7 : 1)); renderCalendar(); };
    const dateControl = input('calendar-date', selectedDay, 'date', value => { if (value) { selectedDay = value; renderCalendar(); } });
    const toolbar = el('div', { class: 'calendar-toolbar' }, button('← Назад', () => navigate(-1), 'small'), button('Сегодня', () => { selectedDay = C.today(); renderCalendar(); }, 'small'), button('Вперёд →', () => navigate(1), 'small'), field(weekly ? 'Неделя с выбранной датой' : 'Дата', dateControl), button('Незапланированные', () => showTasks('unplanned'), 'small'), button('Печать дня', () => printPlan(selectedDay), 'small'));
    const columns = dates.map(date => {
      const journeys = C.trips(store.state, date), tasksCount = journeys.reduce((n, t) => n + t.tasks.length, 0);
      const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
      return el('section', { class: 'day-column' + (weekly && date === selectedDay ? ' is-selected' : '') + (date === C.today() ? ' is-today' : '') + (!C.isWorkday(store.state, date) ? ' non-working' : ''), 'data-day': date, ondragover: dragOver, ondrop: e => handlePlanningDrop(e, date) }, el('header', { class: 'day-heading' }, button(weekday + ' · ' + formatDate(date).slice(0, 5), () => { selectedDay = date; if (weekly) renderCalendar(); else { page = 'day'; render(); } }, 'small'), el('small', {}, journeys.length + ' поездок · ' + tasksCount + ' задач'), store.state.excludedDates.includes(date) ? el('span', { class: 'badge' }, 'Исключённая дата') : null), journeys.length > 10 || tasksCount > 30 ? el('div', { class: 'info-box warning' }, 'Большая нагрузка: ' + journeys.length + ' поездок, ' + tasksCount + ' задач. Перенесите часть задач на другой день.', button('Выбрать задачи', () => { filters = { view: 'active', search: '', plannedFrom: date, plannedTo: date }; page = 'tasks'; render(); }, 'small')) : null, journeys.length ? journeys.map((trip, index) => calendarTrip(trip, date, index, journeys.length)) : el('div', { class: 'empty-day' }, 'Поездок пока нет', el('small', {}, 'Перетащите задачу или назначьте дату в списке.')));
    });
    const backlog = store.state.tasks.filter(t => !t.plannedDate && !['completed', 'cancelled'].includes(C.status(t)));
    const backlogGroups = C.trips(store.state, null);
    const palette = el('details', { class: 'calendar-backlog', open: '', ondragover: e => { dragOver(e); if (e.defaultPrevented && !store.error && !store.stale) e.currentTarget.classList.add('drop-ready'); }, ondragleave: e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop-ready'); }, ondrop: e => { e.currentTarget.classList.remove('drop-ready'); handleBacklogDrop(e); } }, el('summary', {}, el('span', { class: 'backlog-title' }, 'Незапланированные задачи'), el('span', { class: 'backlog-totals' }, 'По судам · Задач: ' + backlog.length + ' · Учреждений: ' + backlogGroups.length)),
      el('p', { class: 'backlog-drop-hint' }, 'Перетащите сюда задачу или поездку, чтобы снять дату.'),
      backlogGroups.length ? el('div', { class: 'backlog-grid' }, backlogGroups.map(backlogCourt)) : el('p', { class: 'muted top-gap' }, 'Все активные задачи распределены по дням.'));
    const board = el('div', { class: weekly ? 'week-grid' : 'day-plan' }, columns);
    const scrollbar = weekly ? el('div', { class: 'week-scrollbar', tabindex: 0, 'aria-label': 'Горизонтальная прокрутка недели' }, el('div', { class: 'week-scrollbar-space' })) : null;
    const transferDates = items => el('div', { class: 'week-transfer-days' }, items.map(date => el('div', { class: 'week-transfer-day', 'data-transfer-day': date,
        ondragover: e => { dragOver(e); if (e.defaultPrevented) e.currentTarget.classList.add('is-drop-target'); }, ondragleave: e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('is-drop-target'); }, ondrop: e => handlePlanningDrop(e, date) },
        el('strong', {}, new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))), el('span', {}, formatDate(date).slice(0, 5)))));
    const transferBar = weekly ? el('div', { class: 'week-transfer-bar', hidden: '' }, el('div', { class: 'week-transfer-inner' },
      el('small', {}, 'Отпустите карточку на нужной дате'), el('div', { class: 'week-transfer-caption' }, 'Эта неделя'), transferDates(dates),
      el('div', { class: 'week-transfer-caption' }, 'Следующая неделя'), transferDates(dates.map(date => C.addDays(date, 7))),
      el('div', { class: 'week-transfer-unplanned', ondragover: dragOver, ondrop: handleBacklogDrop }, 'Вернуть в незапланированные'))) : null;
    $('#main').replaceChildren(...[heading(weekly ? 'План недели' : 'План дня', weekly ? formatDate(first) + ' — ' + formatDate(dates[6]) : formatDate(selectedDay)), toolbar, el('div', { class: 'info-box bottom-gap' }, 'Порядок можно изменить стрелками или перетаскиванием поездки перед другой. При добавлении задач порядок обновляется по приоритетам.'), scrollbar, transferBar, board].filter(Boolean));
    if (scrollbar) {
      scrollbar.addEventListener('scroll', () => { if (Math.abs(board.scrollLeft - scrollbar.scrollLeft) > 1) board.scrollLeft = scrollbar.scrollLeft; });
      board.addEventListener('scroll', () => { if (Math.abs(board.scrollLeft - scrollbar.scrollLeft) > 1) scrollbar.scrollLeft = board.scrollLeft; });
    }
    document.querySelector('.sidebar').classList.add('planning-sidebar');
    $('#sidebar-backlog').hidden = false; $('#sidebar-backlog').replaceChildren(palette);
    if (weekly) centerSelectedDay();
  }
  function centerSelectedDay() {
    const board = document.querySelector('.week-grid'), chosen = board?.querySelector('.is-selected');
    if (!chosen) return;
    board.scrollLeft += chosen.getBoundingClientRect().left - board.getBoundingClientRect().left - (board.clientWidth - chosen.getBoundingClientRect().width) / 2;
    const scrollbar = document.querySelector('.week-scrollbar');
    if (scrollbar) { scrollbar.firstElementChild.style.width = board.scrollWidth + 'px'; scrollbar.scrollLeft = board.scrollLeft; }
  }
  window.addEventListener('resize', () => { if (page === 'week') centerSelectedDay(); });
  function mapLink(place) { return el('a', { class: 'map-link', href: C.mapUrl(place), target: '_blank', rel: 'noopener noreferrer' }, 'На карте ↗'); }
  function printPlan(date, destinationId = null) {
    const journeys = C.trips(store.state, date).filter(trip => !destinationId || trip.destination.id === destinationId), root = $('#print-root');
    root.replaceChildren(el('div', {}, el('h1', {}, 'План поездок · ' + formatDate(date)), journeys.length ? journeys.map((trip, i) => el('section', { class: 'print-trip' },
      el('h2', {}, (C.trips(store.state, date).findIndex(t => t.destination.id === trip.destination.id) + 1) + '. ' + trip.destination.name + ' · ' + C.PRIORITIES[trip.priority]),
      el('p', {}, [trip.destination.address, trip.destination.metro, trip.destination.location].filter(Boolean).join(' · ') || 'Адрес и метро не указаны'),
      trip.tasks.map(task => el('article', { class: 'print-task' }, el('h3', {}, task.source.client + ' · ' + task.id),
        el('p', {}, 'Документ: ' + (task.source.documentNumber || 'не указан') + ' · Приоритет: ' + C.PRIORITIES[C.effectivePriority(task)]),
        el('p', {}, task.source.description || 'Описание не заполнено'), task.localNote ? el('p', {}, 'Заметка: ' + task.localNote) : null,
        el('p', {}, (task.documentsReady ? '☑' : '☐') + ' Документы готовы'), el('div', { class: 'print-blanks' }, 'Результат: ______________________________________________\nЗаписи: _________________________________________________'))))) : el('p', {}, 'Поездок на этот день нет.')));
    window.print();
  }
  function resultsExchange() {
    const blocked = !!store.error || store.stale, mode = select('export-mode', [['changes', 'Изменения после передачи'], ['period', 'За период'], ['all', 'Все результаты']], 'changes', value => { period.hidden = value !== 'period'; });
    const from = input('export-from', C.today(), 'date'), to = input('export-to', C.today(), 'date'), period = el('div', { class: 'grid-two', hidden: true }, field('С даты', from), field('По дату', to));
    const error = el('div', { id: 'export-error', class: 'error-text', role: 'alert' });
    const pending = store.state.pendingResultExports || [], selectExport = select('export-pending', [['', 'Выберите переданную выгрузку'], ...pending.map(item => [item.id, stampText(item.at) + ' · ' + item.id.slice(-6) + ' · ' + item.snapshots.length + ' задач'])], '', () => {});
    return el('section', { class: 'panel' }, el('h2', {}, 'Результаты для таблицы'),
      el('p', { class: 'muted' }, 'Скачайте CSV и вручную обновите исходную таблицу. После этого выберите выгрузку ниже и подтвердите передачу.'),
      field('Что выгрузить', mode), period,
      el('p', { class: 'muted top-gap' }, 'UTF-8, разделитель «;». CSV защищён от формул: перед =, +, -, @ добавляется апостроф. Он может быть виден, в том числе перед телефоном или комментарием с дефисом.'),
      button('Скачать CSV результатов', () => {
        try {
          const data = C.exportResults(store.state, mode.value, from.value, to.value), next = C.registerResultsExport(store.state, data.snapshots);
          if (!store.commit(next.state)) { renderAlerts(); error.textContent = store.lastWriteError; return; }
          download('planner-results-' + next.item.id + '.csv', data.csv, 'text/csv;charset=utf-8'); render(); toast('CSV скачан. Передача в таблицу ещё не подтверждена');
        } catch (e) { error.textContent = e.message; }
      }, 'primary', blocked), error,
      el('div', { class: 'top-gap' }, field('Подтвердить ручную передачу', selectExport),
        button('Подтвердить передачу выбранной выгрузки', () => {
          const item = pending.find(x => x.id === selectExport.value); if (!item) { error.textContent = 'Выберите выгрузку'; return; }
          openDialog('Передача результатов в таблицу', 'Подтверждайте только после ручного обновления исходной таблицы.', el('p', {}, 'Выгрузка ' + item.id + ' · задач: ' + item.snapshots.length + '. Будут отмечены именно значения этого файла.'),
            [button('Отмена', closeDialog), button('Подтверждаю передачу', () => { try { if (store.commit(C.confirmResultsExport(store.state, item.id))) { closeDialog(); render(); toast('Передача отмечена'); } else { renderAlerts(); toast(store.lastWriteError); } } catch (e) { toast(e.message); } }, 'primary')]);
        }, 'small top-gap', blocked || !pending.length)), el('p', { class: 'muted top-gap' }, 'Последняя передача: ' + stampText(store.state.lastConfirmedResultsExport)));
  }
  function renderExchange() {
    const unavailable = !!store.error || store.stale;
    const cards = el('div', { class: 'grid-two' }, el('section', { class: 'panel' }, el('h2', {}, 'Задачи из таблицы'), el('p', { class: 'muted' }, 'Новые поручения, исправления и приоритеты. Перед сохранением — просмотр изменений.'), button('Импортировать задачи', () => openImport('tasks'), 'primary', unavailable)), el('section', { class: 'panel' }, el('h2', {}, 'Справочник мест · необязательно'), el('p', { class: 'muted' }, 'Единый список учреждений с адресами и метро помогает сопоставлять названия. Если эти сведения уже есть в задачах, отдельная загрузка не нужна: места можно создать при их импорте.'), button('Импортировать справочник', () => openImport('places'), '', unavailable)));
    const copy = el('section', { class: 'panel' }, el('h2', {}, 'Резервная копия и обмен'), el('p', { class: 'muted' }, 'JSON содержит все задачи, историю и настройки. Для первого переноса на телефон восстановите копию компьютера. После работы на двух устройствах выберите «Объединить JSON» и разберите различия. Восстановление полностью заменяет данные.'), el('div', { class: 'info-box bottom-gap' }, 'Копия содержит сведения о клиентах. Сохраняйте её в защищённой рабочей папке, не публикуйте ссылку и удаляйте лишние копии из «Загрузок».'), el('div', { class: 'button-row' }, button('Скачать JSON', backup, 'primary', !!store.error), button('Объединить JSON', openMerge, '', unavailable), button('Восстановить JSON', openRestore, '', store.stale)), el('p', { class: 'muted top-gap', style: 'font-size:12px' }, 'Последняя копия: ' + stampText(store.state.lastBackupExport)));
    const children = [heading('Обмен данными', 'Выберите Excel (.xlsx) или CSV; файл можно перетащить на страницу.'), cards, resultsExchange(), copy];
    if (store.state.lastImport) children.push(el('section', { class: 'panel' }, el('h2', {}, 'Последний импорт'), el('p', { class: 'muted' }, stampText(store.state.lastImport.at) + ' · ' + store.state.lastImport.rowCount + ' принятых строк'), button('Посмотреть отчёт изменений', () => showReport(store.state.lastImport), 'small')));
    $('#main').replaceChildren(...children);
  }
  function renderSettings() {
    const bytes = store.size();
    const exclusionDate = input('excluded-date', '', 'date');
    const exceptions = el('section', { class: 'panel' }, el('h2', {}, 'Исключённые рабочие даты'), el('p', { class: 'muted' }, 'Автоматический перенос пропустит эти даты. Суббота и воскресенье уже считаются выходными; праздники добавляйте вручную.'), el('div', { class: 'button-row' }, field('Дата исключения', exclusionDate), button('Добавить исключение', () => { try { const date = C.parseDate(exclusionDate.value); if (!date) throw new Error('Выберите дату'); const next = C.clone(store.state); next.excludedDates = [...new Set([...next.excludedDates, date])].sort(); planningSave(next, 'Дата исключена из автоматического планирования'); } catch (e) { toast(e.message); } }, '', !!store.error || store.stale)), el('div', { class: 'button-row top-gap' }, store.state.excludedDates.map(date => button('Убрать ' + formatDate(date), () => { const next = C.clone(store.state); next.excludedDates = next.excludedDates.filter(d => d !== date); planningSave(next, 'Исключение убрано'); }, 'small', !!store.error || store.stale))));
    $('#main').replaceChildren(heading('Настройки', 'Сведения о приложении и локальном хранении.'), exceptions, el('section', { class: 'panel' }, el('h2', {}, 'Хранилище этого браузера'), el('p', {}, sizeText(bytes) + ' · ' + store.state.tasks.length + ' задач · ' + store.state.destinations.length + ' мест'), el('div', { class: 'storage-meter' }, el('span', { style: 'width:' + Math.min(100, bytes / (4 * 1024 * 1024) * 100) + '%' })), el('p', { class: 'muted' }, 'Размер — оценка по UTF-16. От 2 MiB появится предупреждение; увеличивающая данные операция свыше 4 MiB будет отклонена. История автоматически не удаляется.'), el('div', { class: 'info-box' }, 'Используйте постоянные браузер, профиль и папку приложения. Очистка данных браузера удалит задачи. Перед переносом или обновлением файлов скачайте JSON-копию.'), el('div', { class: 'button-row top-gap' }, button('Скачать резервную копию', backup, '', !!store.error))), el('section', { class: 'panel' }, el('h2', {}, 'Версия'), el('p', {}, 'Приложение: 1.1.2\nСхема данных: 1'), el('p', { class: 'muted' }, 'Импорт, планирование, результаты, экспорт и печать. Ручной обмен JSON с телефоном и выбор различий между копиями.')));
  }
  function openDialog(title, subtitle, body, footer, step = '') {
    $('#modal-content').replaceChildren(el('header', { class: 'modal-header' }, el('div', {}, step ? el('div', { class: 'step-label' }, step) : null, el('h2', { id: 'modal-title' }, title), el('p', {}, subtitle)), button('Закрыть', closeDialog, 'small')), el('div', { class: 'modal-body' }, body), el('footer', { class: 'modal-footer' }, footer));
    if (!modal.open) modal.showModal();
  }
  function closeDialog() { wizard = null; restoreCandidate = null; mergeSession = null; modal.close(); checkRollover(); }
  modal.addEventListener('cancel', e => { e.preventDefault(); closeDialog(); });
  function openImport(type) { if (store.error || store.stale) return; wizard = { type, stage: 0, encoding: 'utf-8', separator: 'auto', buffer: null, name: '', records: [], header: 0, mapping: {}, resolve: {}, excluded: [], analysis: null, book: null, sheet: 0, loading: false }; renderWizard(); }
  function wizardError(text) { const target = $('#wizard-error'); if (target) { target.textContent = text; target.focus(); } }
  function preferredSheet(book, type) { const found = book.sheets.findIndex(sheet => C.norm(sheet.name) === (type === 'tasks' ? 'задачи' : 'справочник')); return found >= 0 ? found : 0; }
  async function acceptFile(files) {
    const current = wizard; if (!current || current.stage !== 0) return;
    if (files.length !== 1) { wizardError('Выберите или перетащите один файл'); return; }
    const selected = files[0], extension = selected.name.split('.').pop().toLowerCase();
    current.buffer = null; current.book = null; current.name = ''; current.records = []; current.mapping = {}; current.resolve = {}; current.excluded = []; current.analysis = null; current.loading = true; renderWizard();
    try {
      if (extension === 'xls') throw new Error('Старый формат .xls не поддерживается. В Excel выберите «Сохранить как» → «Книга Excel (*.xlsx)»');
      if (!['xlsx', 'csv', 'tsv', 'txt'].includes(extension)) throw new Error('Выберите Excel (.xlsx) или CSV');
      if (extension === 'xlsx' && selected.size > 50 * 1024 * 1024) throw new Error('Excel-файл превышает 50 MiB');
      const buffer = await selected.arrayBuffer(), book = extension === 'xlsx' ? await C.openXlsx(buffer) : null;
      if (wizard !== current) return;
      current.buffer = buffer; current.book = book; current.sheet = book ? preferredSheet(book, current.type) : 0; current.name = selected.name; current.loading = false; renderWizard();
    } catch (err) { if (wizard === current) { current.loading = false; renderWizard(); wizardError('Файл не принят: ' + err.message); } }
  }
  async function decodeWizard() {
    const current = wizard;
    if (current.book) current.records = await current.book.readSheet(current.sheet);
    else {
      const text = new TextDecoder(current.encoding, { fatal: current.encoding === 'utf-8' }).decode(current.buffer);
      const delimiter = current.separator === 'auto' ? C.detectSeparator(text) : current.separator;
      current.records = C.parseCSV(text, delimiter); current.delimiter = delimiter;
    }
    current.header = C.headerIndex(current.records); current.mapping = C.mappingFor(current.records[current.header].cells, current.type);
    const saved = store.state.importMappings[current.type];
    if (saved) for (const [key, name] of Object.entries(saved)) { const index = current.records[current.header].cells.findIndex(h => C.norm(h) === C.norm(name)); if (index >= 0 && C.own(current.mapping, key)) current.mapping[key] = index; }
  }
  function analyze() {
    const mappingNames = Object.fromEntries(Object.entries(wizard.mapping).map(([key, column]) => [key, column >= 0 ? wizard.records[wizard.header].cells[column] : '']));
    wizard.analysis = C.buildImport(store.state, C.mappedRows(wizard.records, wizard.header, wizard.mapping), { type: wizard.type, resolve: wizard.resolve, excluded: wizard.excluded, mapping: mappingNames });
    return wizard.analysis;
  }
  function previewTable(rows, headings) { return el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, headings.map(h => el('th', {}, h || 'Без заголовка')))), el('tbody', {}, rows.map(r => el('tr', {}, r.cells.map(value => el('td', {}, value))))))); }
  function renderWizard() {
    if (!wizard) return;
    const title = wizard.type === 'tasks' ? 'Импорт задач' : 'Импорт справочника';
    const errorNode = el('div', { id: 'wizard-error', class: 'error-text', role: 'alert', tabindex: '-1' });
    if (wizard.stage === 0) {
      const file = el('input', { id: 'csv-file', class: 'drop-input', type: 'file', tabindex: '-1', accept: '.xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values', 'aria-label': 'Excel или CSV-файл', disabled: wizard.loading, onchange: e => { if (e.target.files.length) acceptFile(Array.from(e.target.files)); } });
      const drop = el('div', { id: 'file-drop', class: 'file-drop', tabindex: '0', role: 'group', 'aria-label': 'Перетащите Excel или CSV-файл', ondragover: e => { e.preventDefault(); e.stopPropagation(); drop.classList.add('drag-over'); }, ondragleave: () => drop.classList.remove('drag-over'), ondrop: e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('drag-over'); if (!wizard.loading) acceptFile(Array.from(e.dataTransfer.files)); }, onkeydown: e => { if (e.target === drop && ['Enter', ' '].includes(e.key)) { e.preventDefault(); file.click(); } } }, el('div', { class: 'drop-symbol', 'aria-hidden': 'true' }, '↓'), el('strong', {}, 'Перетащите Excel-файл сюда'), el('p', { class: 'muted' }, '.xlsx или CSV · данные остаются в вашем браузере'), button('Выбрать файл', () => file.click(), '', wizard.loading), file, el('div', { id: 'file-name', class: 'selected-file', role: 'status' }, wizard.loading ? 'Читаем файл…' : wizard.name));
      const body = el('div', { class: 'form-stack' }, el('div', { class: 'info-box' }, 'ID добавляет постановщик задачи в исходной таблице, в столбце «ID задачи»: например TASK-000001. ID не меняется при сортировке. До подтверждения импорт не меняет данные.'), field('Тип данных', select('import-type', [['tasks', 'Задачи'], ['places', 'Справочник мест']], wizard.type, value => { wizard.type = value; wizard.resolve = {}; wizard.excluded = []; wizard.analysis = null; if (wizard.book) wizard.sheet = preferredSheet(wizard.book, value); renderWizard(); })), drop);
      if (wizard.book) body.append(field('Лист Excel-книги', select('excel-sheet', wizard.book.sheets.map((sheet, index) => [index, sheet.name]), wizard.sheet, value => { wizard.sheet = Number(value); wizard.resolve = {}; wizard.excluded = []; wizard.analysis = null; })));
      else body.append(field('Кодировка CSV', select('csv-encoding', [['utf-8', 'UTF-8'], ['windows-1251', 'Windows-1251']], wizard.encoding, value => wizard.encoding = value)), field('Разделитель CSV', select('csv-separator', [['auto', 'Определить автоматически'], [';', 'Точка с запятой ;'], [',', 'Запятая ,'], ['\t', 'Табуляция']], wizard.separator, value => wizard.separator = value)));
      body.append(errorNode);
      body.querySelectorAll('select').forEach(control => control.disabled = wizard.loading);
      openDialog(title, 'Excel: одна книга, выбранный лист. CSV тоже поддерживается.', body, [button('Отмена', closeDialog), button('Прочитать файл', async () => { const current = wizard; try { if (!current.buffer) throw new Error('Сначала выберите файл'); current.loading = true; renderWizard(); await decodeWizard(); if (wizard !== current) return; current.loading = false; current.stage = 1; renderWizard(); } catch (e) { if (wizard === current) { current.loading = false; renderWizard(); wizardError('Не удалось прочитать таблицу: ' + e.message); } } }, 'primary', wizard.loading)], '1 / 4 · Файл');
    } else if (wizard.stage === 1) {
      const headers = wizard.records[wizard.header].cells;
      const columns = [[-1, 'Не импортировать'], ...headers.map((value, index) => [index, (index + 1) + '. ' + (value || 'Без заголовка')])];
      const headerSelect = select('csv-header', wizard.records.slice(0, 10).map((r, index) => [index, 'Строка ' + r.line + ': ' + r.cells.slice(0, 3).join(' · ').slice(0, 100)]), wizard.header, value => { wizard.header = Number(value); wizard.mapping = C.mappingFor(wizard.records[wizard.header].cells, wizard.type); wizard.resolve = {}; wizard.excluded = []; renderWizard(); });
      const body = el('div', { class: 'form-stack' }, field('Строка заголовков', headerSelect), el('div', { class: 'mapping-grid' }, Object.keys(wizard.mapping).map(key => field(C.HEADERS[key] + (['id', 'client', 'destination'].includes(key) ? ' *' : ''), select('map-' + key, columns, wizard.mapping[key], value => { wizard.mapping[key] = Number(value); wizard.resolve = {}; wizard.excluded = []; })))), el('small', {}, '* Обязательные столбцы. Пустое описание будет отмечено предупреждением.'), previewTable(wizard.records.slice(wizard.header + 1, wizard.header + 4), headers), errorNode);
      openDialog(title, wizard.name + (wizard.book ? ' · ' + wizard.book.sheets[wizard.sheet].name : '') + ' · сопоставьте поля, если названия отличаются.', body, [button('Назад', () => { wizard.stage = 0; renderWizard(); }), button('Проверить данные', () => { const required = wizard.type === 'tasks' ? C.isResultsCSV(wizard.records, wizard.header) ? ['id'] : ['id', 'client', 'destination'] : ['destination']; if (required.some(key => wizard.mapping[key] < 0)) { wizardError('Сопоставьте обязательные столбцы'); return; } const selected = Object.values(wizard.mapping).filter(v => v >= 0); if (new Set(selected).size !== selected.length) { wizardError('Один столбец нельзя назначить двум полям'); return; } if (!wizard.records.slice(wizard.header + 1).length) { wizardError('После заголовка нет строк данных'); return; } wizard.stage = 2; renderWizard(); }, 'primary')], '2 / 4 · Поля и просмотр');
    } else if (wizard.stage === 2) {
      const a = analyze(), body = el('div', {});
      for (const item of a.blockers) body.append(el('div', { class: 'info-box error bottom-gap' }, 'Строка ' + item.line + ': ' + item.message + '. Исправьте ID в исходной таблице.'));
      for (const item of a.errors) body.append(el('div', { class: 'issue' }, el('strong', {}, 'Строка ' + item.line), el('p', {}, item.message), el('label', { class: 'check-box' }, el('input', { type: 'checkbox', onchange: e => { if (e.target.checked && !wizard.excluded.includes(item.line)) wizard.excluded.push(item.line); else wizard.excluded = wizard.excluded.filter(line => line !== item.line); } }), 'Я подтверждаю исключение этой строки из импорта')));
      for (const q of a.questions) body.append(questionCard(q));
      if (a.warnings.length) body.append(el('div', { class: 'info-box warning bottom-gap' }, a.warnings.map(w => el('div', {}, 'Строка ' + w.line + ': ' + w.message))));
      if (a.ignoredEmptyRows) body.append(el('div', { class: 'info-box bottom-gap' }, 'Пустые строки пропущены: ' + a.ignoredEmptyRows + '. ID нужен только для строки с данными задачи.'));
      if (wizard.excluded.length) body.append(el('div', { class: 'info-box warning bottom-gap' }, 'Исключены строки: ' + wizard.excluded.join(', '), button('Вернуть исключённые строки', () => { wizard.excluded = []; renderWizard(); }, 'small')));
      if (a.ready) body.append(el('div', { class: 'info-box' }, 'Проверка пройдена. Можно перейти к итоговому отчёту.'));
      body.append(errorNode);
      openDialog(title, 'Суды и учреждения определяются по названию автоматически. Проверьте данные и различия; ошибки ID нельзя пропустить.', body, [button('Назад', () => { wizard.stage = 1; renderWizard(); }), button('Продолжить проверку', () => { const next = analyze(); if (next.ready) wizard.stage = 3; renderWizard(); }, 'primary', !!a.blockers.length)], '3 / 4 · Проверка и различия');
    } else {
      const a = wizard.analysis;
      const cancellation = a.entries.some(e => e.kind === 'cancelled');
      const confirmation = el('input', { type: 'checkbox', id: 'confirm-cancellation' });
      const body = el('div', {}, el('div', { class: 'info-box bottom-gap' }, 'Будет принято строк: ' + a.rowCount + '. Существующие задачи, которых нет в CSV, остаются в приложении.'), reportContent({ entries: a.entries, warnings: a.warnings, ignoredEmptyRows: a.ignoredEmptyRows }), cancellation ? el('label', { class: 'check-box top-gap' }, confirmation, 'Подтверждаю отмену указанных задач из таблицы; локальные результаты сохранятся в истории') : null, errorNode);
      openDialog(title, 'Проверьте, что изменится. После подтверждения изменения сохранятся в браузере.', body, [button('Назад', () => { wizard.stage = 2; renderWizard(); }), button('Применить импорт', () => { if (cancellation && !confirmation.checked) { wizardError('Подтвердите отмену задач отдельной отметкой'); return; } if (store.commit(a.state)) { closeDialog(); render(); toast('Импорт завершён: ' + a.rowCount + ' строк'); } else { renderAlerts(); wizardError(store.lastWriteError); } }, 'primary', store.stale)], '4 / 4 · Итог и подтверждение');
    }
  }
  function questionCard(q) {
    const card = el('div', { class: 'issue' }, el('h3', {}, q.message), el('small', {}, 'Строка ' + q.line));
    const choose = value => { Object.defineProperty(wizard.resolve, q.key, { value, writable: true, enumerable: true, configurable: true }); };
    if (q.type === 'priority') card.append(field('Приоритет для этого значения', select('q-' + q.key, [['', 'Выберите приоритет'], ...Object.entries(C.PRIORITIES)], wizard.resolve[q.key], choose)));
    else if (q.type === 'status') card.append(field('Статус для этого значения', select('q-' + q.key, [['', 'Выберите статус'], ['none', 'Новая / запланирована'], ['failed', 'Не удалось выполнить'], ['completed', 'Выполнена'], ['cancelled', 'Отменена']], wizard.resolve[q.key], choose)));
    else {
      if (q.local) card.append(el('div', { class: 'diff top-gap' }, el('div', {}, el('strong', {}, 'В приложении'), display(q.local)), el('div', {}, el('strong', {}, 'В CSV'), display(q.csv))));
      const options = q.type === 'status-source' ? [['status', 'Использовать статус: ' + (C.STATUSES[q.status] || 'Новая')], ['done', 'Использовать отметку выполнения: ' + (C.STATUSES[q.done] || 'Новая')]] : [['local', 'Оставить данные приложения'], ['csv', 'Принять данные CSV']];
      card.append(...options.map(([value, label]) => el('label', { class: 'choice' }, el('input', { type: 'radio', name: q.key, value, checked: wizard.resolve[q.key] === value, onchange: () => choose(value) }), label)));
    }
    return card;
  }
  function reportContent(report) {
    const counts = {}; for (const entry of report.entries) counts[entry.kind] = (counts[entry.kind] || 0) + 1;
    return el('div', {}, el('div', { class: 'report-summary' }, Object.entries(counts).map(([kind, count]) => el('span', { class: 'badge' }, (kindNames[kind] || kind) + ': ' + count))), report.ignoredEmptyRows ? el('p', { class: 'muted' }, 'Пустые строки пропущены: ' + report.ignoredEmptyRows) : null, report.entries.length ? report.entries.map(entry => el('details', { class: 'report-entry' }, el('summary', {}, (kindNames[entry.kind] || entry.kind) + ' · ' + (entry.label || entry.id) + ' · ' + entry.id), el('div', { class: 'diff top-gap' }, el('div', {}, el('strong', {}, 'Было'), display(entry.before)), el('div', {}, el('strong', {}, 'Станет'), display(entry.after))))) : el('p', { class: 'muted' }, 'Сведения совпадают. Задачи не будут дублироваться.'), report.warnings?.length ? el('div', { class: 'info-box warning top-gap' }, report.warnings.map(w => el('div', {}, 'Строка ' + w.line + ': ' + w.message))) : null);
  }
  function showReport(report) { openDialog('Отчёт изменений', stampText(report.at), reportContent(report), [button('Закрыть', closeDialog)]); }
  function openMerge() {
    if (store.error || store.stale) return;
    const session = { incoming: null, choices: Object.create(null), baseRaw: store.raw, sequence: 0, reviewed: false };
    mergeSession = session;
    const preview = el('div', { id: 'merge-preview' }), error = el('div', { id: 'merge-error', class: 'error-text', role: 'alert' });
    const confirmation = el('input', { id: 'merge-confirm', type: 'checkbox' });
    const invalidate = () => { session.reviewed = false; confirmation.checked = false; apply.disabled = true; error.textContent = ''; };
    const describe = value => {
      if (Array.isArray(value)) return value.map(id => typeof id === 'string' ? store.state.destinations.find(p => p.id === id)?.name || session.incoming.destinations.find(p => p.id === id)?.name || id : display(id)).join('\n') || 'Пустой список';
      return display(value);
    };
    const review = () => {
      try {
        if (!session.incoming) throw new Error('Сначала выберите JSON-копию');
        if (store.stale || store.error || store.raw !== session.baseRaw) throw new Error('Данные изменились. Закройте форму, загрузите актуальные данные и повторите объединение.');
        const analysis = C.mergeCopies(store.state, session.incoming, session.choices), s = analysis.summary;
        session.reviewed = analysis.ready; confirmation.checked = false; apply.disabled = !analysis.ready; error.textContent = '';
        const newTasks = analysis.state.tasks.filter(t => !store.state.tasks.some(old => old.id === t.id));
        preview.replaceChildren(el('div', { class: 'info-box bottom-gap' }, 'Новых задач: ' + s.newTasks + ' · Новых учреждений: ' + s.newDestinations + ' · Добавляемых событий истории: ' + s.addedHistory + ' · Изменяемых задач: ' + s.changedTasks,
          el('p', { class: 'merge-review-status' }, analysis.ready ? analysis.changed ? 'Все различия разобраны. Проверьте выбор и подтвердите объединение.' : 'Данные уже совпадают с выбранными версиями. Повторная запись не требуется.' : 'Не выбран вариант для различий: ' + analysis.conflicts.filter(c => !c.choice).length)),
          newTasks.length ? el('details', { class: 'bottom-gap' }, el('summary', {}, 'Добавляемые задачи · ' + newTasks.length), newTasks.map(t => el('p', {}, t.id + ' · ' + t.source.client + ' · ' + t.source.description))) : el('span', { hidden: '' }),
          ...analysis.conflicts.map(conflict => el('details', { class: 'merge-conflict issue', 'data-merge-kind': conflict.kind, 'data-merge-key': conflict.key, ...(analysis.conflicts.length <= 6 ? { open: '' } : {}) },
            el('summary', {}, conflict.label + (conflict.choice ? ' · Выбрано: ' + (conflict.choice === 'local' ? 'это устройство' : 'файл') : ' · Требуется выбор')),
            el('div', { class: 'diff top-gap' }, el('div', {}, el('strong', {}, 'На этом устройстве'), describe(conflict.local)), el('div', {}, el('strong', {}, 'В JSON-файле'), describe(conflict.file))),
            ...[['local', 'Оставить версию этого устройства'], ['file', 'Принять версию из файла']].map(([value, label]) => el('label', { class: 'choice' }, el('input', { type: 'radio', name: conflict.key, value, checked: session.choices[conflict.key] === value, onchange: () => { session.choices[conflict.key] = value; invalidate(); } }), label)))));
      } catch (e) { session.reviewed = false; apply.disabled = true; error.textContent = e.message; }
    };
    const apply = button('Применить объединение', () => {
      try {
        if (!session.reviewed || !confirmation.checked) throw new Error('Проверьте различия и подтвердите объединение');
        if (store.stale || store.error || store.raw !== session.baseRaw) throw new Error('Данные изменились. Закройте форму и повторите объединение с актуальными данными.');
        const analysis = C.mergeCopies(store.state, session.incoming, session.choices);
        if (!analysis.ready) throw new Error('Выберите версии всех различающихся групп');
        if (!analysis.changed) { closeDialog(); toast('Данные уже совпадают. Изменений нет'); return; }
        if (!store.commit(analysis.state)) { renderAlerts(); throw new Error(store.lastWriteError); }
        undoRecord = null; selectedTasks.clear(); closeDialog(); render(); toast('Копии объединены. Новых задач: ' + analysis.summary.newTasks + ' · Изменено задач: ' + analysis.summary.changedTasks);
      } catch (e) { error.textContent = e.message; }
    }, 'primary', true); apply.id = 'merge-apply';
    const file = el('input', { id: 'merge-file', type: 'file', onchange: async e => {
      const sequence = ++session.sequence; session.incoming = null; session.choices = Object.create(null); invalidate(); preview.replaceChildren();
      try {
        if (!e.target.files[0]) return;
        const text = await e.target.files[0].text();
        if (mergeSession !== session || !modal.open || session.sequence !== sequence) return;
        session.incoming = C.validateState(JSON.parse(text)); review();
      } catch (e) { if (mergeSession === session && session.sequence === sequence) { session.incoming = null; error.textContent = 'Копия не принята: ' + e.message; } }
    } });
    openDialog('Объединение JSON-копий', 'До подтверждения данные этого браузера не меняются.',
      el('div', { class: 'form-stack' }, el('div', { class: 'info-box' }, 'Выбирайте отдельно сведения, расписание, готовность, заметку, результат и приоритет. История добавляется без дублей. Порядок дня и справочник разбираются отдельно. Автоматической синхронизации нет.'),
        button('Скачать текущую копию', () => download(filename('planner-before-merge'), JSON.stringify(store.state, null, 2))), field('JSON с другого устройства', file), preview,
        el('label', { class: 'check-box' }, confirmation, 'Подтверждаю объединение с выбранными версиями'), error),
      [button('Отмена', closeDialog), button('Проверить объединение', review), apply]);
  }
  function openRestore() {
    if (store.stale) return;
    wizard = null; restoreCandidate = null;
    const file = el('input', { id: 'json-file', type: 'file', onchange: async e => {
      restoreCandidate = null; $('#restore-preview').replaceChildren(); $('#restore-apply').disabled = true;
      try {
        if (!e.target.files[0]) return;
        restoreCandidate = C.validateState(JSON.parse(await e.target.files[0].text()));
        $('#restore-preview').replaceChildren(el('div', { class: 'info-box' }, `${restoreCandidate.tasks.length} задач · ${restoreCandidate.destinations.length} мест · ${sizeText(store.size(restoreCandidate))}`, el('div', {}, 'Рабочая область: ' + restoreCandidate.workspaceId)), el('p', { class: 'muted top-gap' }, 'Текущее хранилище будет полностью заменено, включая расписание и историю.'));
        $('#restore-apply').disabled = false;
      } catch (err) { $('#restore-preview').replaceChildren(el('div', { class: 'info-box error' }, 'Копия не принята: ' + err.message)); restoreCandidate = null; }
    } });
    const confirm = el('input', { id: 'restore-confirm', type: 'checkbox' });
    const apply = button('Заменить данные', () => { if (!restoreCandidate || !confirm.checked) { $('#restore-error').textContent = 'Выберите корректную копию и подтвердите замену'; return; } if (store.commit(restoreCandidate, true)) { closeDialog(); render(); toast('Данные восстановлены'); } else { $('#restore-error').textContent = store.lastWriteError; renderAlerts(); } }, 'primary', true); apply.id = 'restore-apply';
    openDialog('Восстановление JSON', 'Это замена данных, а не объединение двух копий.', el('div', { class: 'form-stack' }, el('div', { class: 'info-box warning' }, 'Перед заменой скачайте текущее хранилище. JSON содержит данные клиентов.'), button(store.error ? 'Скачать исходное хранилище' : 'Скачать текущую копию', () => { if (store.error) download(filename('planner-original'), store.raw || '', 'text/plain;charset=utf-8'); else download(filename('planner-current'), JSON.stringify(store.state, null, 2)); }), field('JSON-копия', file), el('p', { class: 'muted' }, 'Выберите резервную копию: её содержимое будет проверено перед восстановлением. Если файл на iPhone серый, скопируйте его в «Файлы → На iPhone» и выберите оттуда.'), el('div', { id: 'restore-preview' }), el('label', { class: 'check-box' }, confirm, 'Подтверждаю полную замену данных в этом браузере'), el('div', { id: 'restore-error', class: 'error-text', role: 'alert' })), [button('Отмена', closeDialog), apply]);
  }
  document.querySelectorAll('[data-page]').forEach(node => node.addEventListener('click', () => { page = node.dataset.page; render(); }));
  $('.brand').addEventListener('click', e => { e.preventDefault(); page = 'tasks'; render(); });
  window.addEventListener('dragover', e => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    if (modal.open && (!wizard || wizard.stage !== 0 || wizard.loading)) { toast('Завершите или закройте текущую форму перед загрузкой другого файла'); return; }
    if (!modal.open) openImport('tasks');
    if (wizard) acceptFile(Array.from(e.dataTransfer.files));
  });
  window.addEventListener('storage', e => { if (e.key === C.KEY || e.key === null) { store.checkExternal(); renderAlerts(); const apply = $('#restore-apply'); if (apply) apply.disabled = store.stale; } });
  window.addEventListener('dragend', endCalendarDrag);
  window.addEventListener('drop', endCalendarDrag);
  $('#undo-planning').addEventListener('click', () => {
    if (!undoRecord || undoRecord.revision !== store.state.revision || store.stale || store.error) return;
    if (store.commit(C.undoPlanning(store.state, undoRecord.before))) { undoRecord = null; selectedTasks.clear(); render(); toast('Последнее действие отменено'); } else renderAlerts();
  });
  try { new TextDecoder('windows-1251'); checkRollover(); } catch (_) { store.error = 'Браузер не поддерживает Windows-1251 или московский часовой пояс. Используйте Chrome или Edge версии 120 и выше.'; }
  window.addEventListener('focus', checkRollover);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkRollover(); });
  setInterval(checkRollover, 60000);
  render();
})();
