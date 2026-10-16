'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const packages = path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(packages, 'playwright'));
const JSZip = require(path.join(packages, 'jszip'));
const C = require('../script.js');
const root = path.resolve(__dirname, '..'), url = pathToFileURL(path.join(root, 'index.html')).href;
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relns = 'http://schemas.openxmlformats.org/package/2006/relationships';
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const checks = [];
const csv = fs.readFileSync(path.join(__dirname, 'fixtures/tasks.csv'), 'utf8');
function column(index) { let name = ''; for (index++; index > 0; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name; return name; }
async function book(options = {}) {
  const zip = new JSZip(), shared = [], sharedIndex = text => { let index = shared.indexOf(text); if (index < 0) { index = shared.length; shared.push(text); } return index; };
  const matrix = C.parseCSV(csv).map(r => r.cells);
  if (options.missingId) matrix[1][0] = '';
  if (options.duplicateId) matrix[2][0] = matrix[1][0];
  if (options.noDescription) matrix[1][6] = '';
  const excelSerial = (date, system1904) => (Date.parse(date + 'T00:00:00Z') - Date.UTC(system1904 ? 1904 : 1899, system1904 ? 0 : 11, system1904 ? 1 : 30)) / 86400000;
  let tasksXML = '';
  matrix.forEach((row, r) => {
    tasksXML += `<row r="${r + 1}">`;
    row.forEach((text, c) => {
      if (!text) return;
      const ref = column(c) + (r + 1);
      if (r > 0 && [2, 10].includes(c) && text) tasksXML += `<c r="${ref}" s="1"><v>${excelSerial(C.parseDate(text), options.date1904)}</v></c>`;
      else if (r === 1 && c === 4) tasksXML += `<c r="${ref}" s="2"><v>1</v></c>`;
      else if (r > 0 && c === 9) tasksXML += `<c r="${ref}" t="b"><v>${text === 'TRUE' ? 1 : 0}</v></c>`;
      else if (r === 1 && c === 3) tasksXML += `<c r="${ref}" t="str"><f>CONCAT("Клиент ","А")</f>${options.noFormulaCache ? '' : '<v>Клиент А</v>'}</c>`;
      else if (r === 2 && c === 6) tasksXML += `<c r="${ref}" t="inlineStr"><is><r><t xml:space="preserve">Передать "оригинал"; </t></r><r><t>получить отметку\nВторая строка</t></r></is></c>`;
      else tasksXML += `<c r="${ref}" t="s"><v>${sharedIndex(text)}</v></c>`;
    });
    tasksXML += '</row>';
  });
  if (options.blankRows) tasksXML += '<row r="8"><c r="J8" t="b"><v>0</v></c></row><row r="9"><c r="A9" t="inlineStr"><is><t>TASK-000001</t></is></c><c r="H9" t="inlineStr"><is><t>Обычный</t></is></c><c r="I9" t="inlineStr"><is><t>Новая</t></is></c><c r="J9" t="b"><v>0</v></c></row><row r="10"><c r="Q10"><v>123</v></c></row><row r="11"><c r="B11" s="1"/></row>';
  const placesRows = [['Место направления', 'Метро', 'Адрес', 'Расположение'], ['Суд А', 'м. Центральная', 'Тестовая ул., 1', 'внутри МКАД'], ['ОСП Б', 'м. Южная', 'Тестовая ул., 2', 'за МКАД']];
  const placesXML = placesRows.map((row, r) => `<row r="${r + 4}">${row.map((text, c) => `<c r="${column(c)}${r + 4}" t="inlineStr"><is><t>${esc(text)}</t></is></c>`).join('')}</row>`).join('');
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="${relns}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${office}"><workbookPr date1904="${options.date1904 ? 1 : 0}"/><sheets><sheet name="задачи" sheetId="1" r:id="rId1"/><sheet name="справочник" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${relns}"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${office}/worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${office}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="${office}/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${ns}"><sheetData>${tasksXML}</sheetData></worksheet>`);
  zip.file('xl/worksheets/sheet2.xml', `<worksheet xmlns="${ns}"><sheetData>${placesXML}</sheetData></worksheet>`);
  zip.file('xl/sharedStrings.xml', `<sst xmlns="${ns}" count="${shared.length}" uniqueCount="${shared.length}">${shared.map(text => `<si><t xml:space="preserve">${esc(text)}</t></si>`).join('')}</sst>`);
  zip.file('xl/styles.xml', `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="000"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: options.stored ? 'STORE' : 'DEFLATE' });
}
async function drop(page, buffer, target = '#file-drop', name = 'tasks.xlsx') {
  await page.evaluate(({ bytes, target, name }) => { const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(bytes)], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); document.querySelector(target).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, { bytes: [...buffer], target, name });
  await page.waitForFunction(() => document.querySelector('#file-name')?.textContent.endsWith('.xlsx'));
}
async function selected(page, buffer) { await page.locator('#csv-file').setInputFiles({ name: 'tasks.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer }); await page.waitForFunction(() => document.querySelector('#file-name')?.textContent.endsWith('.xlsx')); }
async function validate(page) { await page.getByRole('button', { name: 'Прочитать файл', exact: true }).click(); await page.getByRole('button', { name: 'Проверить данные', exact: true }).click(); }
async function finish(page) { await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).click(); await page.getByRole('button', { name: 'Применить импорт', exact: true }).click(); }
const read = page => page.evaluate(() => JSON.parse(localStorage.getItem('tripPlanner.state.v1')));
async function run(channel) {
  const browser = await chromium.launch({ channel, headless: true }), context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } }), page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = [], network = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
  const check = async (name, action) => { await action(); const label = channel + ' · ' + name; checks.push(label); console.log('PASS ' + label); };
  const buffer = await book();
  try {
    await page.goto(url); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
    await check('выбор Excel, лист справочника, номера строк и отсутствие записи до подтверждения', async () => {
      await page.getByRole('button', { name: 'Обмен данными', exact: true }).click(); await page.getByRole('button', { name: 'Импортировать справочник', exact: true }).click();
      const chooserEvent = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Выбрать файл', exact: true }).click(); const chooser = await chooserEvent; await chooser.setFiles({ name: 'tasks.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer }); await page.waitForFunction(() => document.querySelector('#file-name')?.textContent.endsWith('.xlsx'));
      assert.equal(await page.locator('#excel-sheet').inputValue(), '1'); assert.equal(await page.locator('#csv-encoding').count(), 0); await validate(page); assert.equal(await page.getByText('Проверка пройдена. Можно перейти к итоговому отчёту.', { exact: true }).count(), 1);
      assert.equal(await read(page), null); await finish(page); assert.equal((await read(page)).destinations.length, 2); assert.equal((await read(page)).tasks.length, 0);
    });
    await check('перетаскивание на страницу, даты Excel, логические ячейки, ведущие нули и rich text', async () => {
      await drop(page, buffer, 'body'); assert.equal(await page.locator('#excel-sheet').inputValue(), '0'); await validate(page); await finish(page);
      const state = await read(page); assert.equal(state.tasks.length, 3); assert.equal(state.tasks[0].source.documentNumber, '001'); assert.equal(state.tasks[0].source.createdDate, '2026-10-01'); assert.equal(state.tasks[0].source.client, 'Клиент А'); assert.equal(state.tasks[2].result.outcome, 'completed'); assert.equal(state.tasks[2].result.date, '2026-10-05'); assert.match(state.tasks[1].source.description, /\nВторая строка/);
      await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click(); assert.equal((await read(page)).tasks.length, 3);
    });
    await check('перетаскивание в область мастера и повторный импорт без дублей', async () => {
      await page.getByRole('button', { name: 'Импортировать файл', exact: true }).click(); await drop(page, buffer); await validate(page); await finish(page); assert.equal((await read(page)).tasks.length, 3);
    });
    await check('пустые строки, FALSE, резервный ID и несопоставленные столбцы пропускаются', async () => {
      await page.getByRole('button', { name: 'Импортировать файл', exact: true }).click(); await selected(page, await book({ blankRows: true })); await validate(page);
      assert.equal(await page.getByText('Пустые строки пропущены: 3. ID нужен только для строки с данными задачи.', { exact: true }).count(), 1); assert(!(await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).isDisabled()));
      await finish(page); const state = await read(page); assert.equal(state.tasks.length, 3); assert.equal(state.lastImport.rowCount, 3); assert.equal(state.lastImport.ignoredEmptyRows, 3);
    });
    await check('без справочника и описания: суды создаются автоматически, адрес и метро пусты', async () => {
      const freshContext = await browser.newContext(), fresh = await freshContext.newPage();
      try {
        await fresh.goto(url); await fresh.getByRole('button', { name: 'Задачи', exact: true }).click(); await fresh.getByRole('button', { name: 'Импортировать файл', exact: true }).click(); await selected(fresh, await book({ noDescription: true })); await validate(fresh);
        assert.equal(await fresh.getByText(/Укажите место для/).count(), 0); await finish(fresh); const state = await read(fresh);
        assert.equal(state.tasks.length, 3); assert.equal(state.tasks[0].source.description, ''); assert.equal(state.destinations.length, 2); assert.equal(state.tasks[0].source.destinationId, state.tasks[1].source.destinationId);
        assert(state.destinations.every(p => p.metro === '' && p.address === '' && p.location === ''));
        await fresh.reload(); await fresh.getByRole('button', { name: 'Задачи', exact: true }).click(); assert.equal((await read(fresh)).tasks.length, 3); assert.equal(await fresh.getByText('Описание не заполнено', { exact: true }).count(), 1);
      } finally { await freshContext.close(); }
    });
    await check('смена типа данных и листа; отмена импорта без изменения хранилища', async () => {
      const before = await read(page); await page.getByRole('button', { name: 'Импортировать файл', exact: true }).click(); await selected(page, buffer); await page.locator('#import-type').selectOption('places'); assert.equal(await page.locator('#excel-sheet').inputValue(), '1'); await page.locator('#excel-sheet').selectOption('0'); assert.equal(await page.locator('#excel-sheet').inputValue(), '0'); await page.getByRole('button', { name: 'Отмена', exact: true }).click(); assert.deepEqual(await read(page), before);
    });
    await check('отсутствующий и повторный ID Excel блокируются', async () => {
      for (const options of [{ missingId: true }, { duplicateId: true }]) { await page.getByRole('button', { name: 'Импортировать файл', exact: true }).click(); await selected(page, await book(options)); await validate(page); assert(await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).isDisabled()); await page.getByRole('button', { name: 'Закрыть', exact: true }).click(); }
    });
    await check('битая книга, неизвестный формат и старый XLS не меняют данные', async () => {
      const before = await read(page); await page.getByRole('button', { name: 'Импортировать файл', exact: true }).click();
      for (const payload of [{ name: 'bad.xlsx', buffer: Buffer.from('broken') }, { name: 'old.xls', buffer: Buffer.from('old') }, { name: 'not-excel.pdf', buffer: Buffer.from('pdf') }]) { await page.locator('#csv-file').setInputFiles({ ...payload, mimeType: 'application/octet-stream' }); await page.waitForFunction(() => document.querySelector('#wizard-error').textContent.includes('Файл не принят')); assert.deepEqual(await read(page), before); }
      await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    });
    await check('система дат 1904 и несжатый ZIP', async () => {
      for (const options of [{ date1904: true }, { stored: true }]) { await page.getByRole('button', { name: 'Импортировать файл', exact: true }).click(); await selected(page, await book(options)); await validate(page); await finish(page); assert.equal((await read(page)).tasks[0].source.createdDate, '2026-10-01'); }
    });
    await check('формула без сохранённого результата отклоняется', async () => {
      const before = await read(page); await page.getByRole('button', { name: 'Импортировать файл', exact: true }).click(); await selected(page, await book({ noFormulaCache: true })); await page.getByRole('button', { name: 'Прочитать файл', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#wizard-error')?.textContent.includes('нет сохранённого результата формулы')); assert.deepEqual(await read(page), before); await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    });
    await check('несколько файлов и drop во время подтверждения не затирают текущий импорт', async () => {
      await page.getByRole('button', { name: 'Импортировать файл', exact: true }).click();
      await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['1'], 'a.xlsx')); dt.items.add(new File(['2'], 'b.xlsx')); document.querySelector('#file-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
      assert.match(await page.locator('#wizard-error').textContent(), /один файл/); await selected(page, buffer); await validate(page); await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).click();
      await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'other.xlsx')); document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
      assert.equal(await page.getByRole('button', { name: 'Применить импорт', exact: true }).count(), 1); await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    });
    await check('узкий экран области загрузки, отсутствие ошибок и сетевых запросов', async () => {
      await page.setViewportSize({ width: 360, height: 800 }); await page.getByRole('button', { name: 'Импортировать файл', exact: true }).click(); await selected(page, buffer); assert(await page.evaluate(() => document.querySelector('#modal').scrollWidth <= document.querySelector('#modal').clientWidth));
      await page.screenshot({ path: path.join(__dirname, 'excel-drop-' + channel + '.png'), fullPage: true }); assert.deepEqual(errors, []); assert.deepEqual(network, []);
    });
    return { channel, version: await browser.version(), checks: checks.filter(name => name.startsWith(channel)), errors, network };
  } finally { await browser.close(); }
}
(async () => { fs.writeFileSync(path.join(__dirname, 'fixtures/excel-import.xlsx'), await book()); const results = []; for (const channel of ['chrome', 'msedge']) results.push(await run(channel)); fs.writeFileSync(path.join(__dirname, 'excel-import-results.json'), JSON.stringify({ results }, null, 2)); })().catch(error => { console.error(error); process.exitCode = 1; });
