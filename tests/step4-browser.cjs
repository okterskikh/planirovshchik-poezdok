'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js'), records = C.parseCSV(fs.readFileSync(path.join(__dirname, 'fixtures/tasks.csv'), 'utf8'));
const seed = () => C.buildImport(C.emptyState(), C.mappedRows(records, 0, C.mappingFor(records[0].cells, 'tasks'))).state;
(async () => {
  const results = [];
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel, headless: true }), context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true }), page = await context.newPage();
    page.setDefaultTimeout(12000); await page.clock.install({ time: new Date('2026-10-15T09:00:00Z') });
    const checks = [], errors = [], network = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('tripPlanner.state.v1')));
    const reset = async state => { await page.evaluate(state => localStorage.setItem('tripPlanner.state.v1', JSON.stringify(state)), state); await page.reload(); };
    const exchange = () => page.getByRole('button', { name: 'Обмен данными', exact: true }).click();
    const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + channel + ' · ' + name); };
    const download = async name => { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); const item = await wait; return { bytes: fs.readFileSync(await item.path()), name: item.suggestedFilename() }; };
    try {
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
      await check('начальный раздел, совместимость и ссылка карты', async () => {
        assert.equal(await page.locator('.week-grid').count(), 1); await reset(seed()); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
        const link = page.locator('#task-list .map-link').first(); assert.equal(new URL(await link.getAttribute('href')).searchParams.get('text'), 'Суд А'); assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
        assert.equal(await page.evaluate(() => new TextDecoder('windows-1251').decode(new Uint8Array([0xcf,0xf0,0xe8,0xe2,0xe5,0xf2]))), 'Привет');
      });
      let firstExport;
      await check('скачивание CSV не подтверждает передачу; снимок переживает перезагрузку', async () => {
        let s = C.recordResult(seed(), 'TASK-000001', 'failed', '2026-10-15', '- позвонить; "ок"\nВторая строка', '2026-10-15'); await reset(s); await exchange();
        const dl = await download('Скачать CSV результатов'); assert.deepEqual([...dl.bytes.subarray(0,3)], [239,187,191]); const parsed = C.parseCSV(dl.bytes.toString('utf8')); assert.equal(parsed.length, 3); assert.equal(parsed[1].cells[6], "'- позвонить; \"ок\"\nВторая строка");
        s = await read(); assert.equal(s.tasks[0].lastConfirmedExportResult, null); firstExport = s.pendingResultExports[0].id; assert(dl.name.includes(firstExport));
        await page.reload(); await exchange(); assert.equal(await page.locator('#export-pending option').count(), 2);
      });
      await check('подтверждение старой выгрузки сохраняет новый результат в изменениях', async () => {
        await page.getByRole('button', { name: 'Задачи', exact: true }).click(); await page.getByRole('button', { name: 'Активные', exact: true }).click(); await page.locator('[data-task-id=TASK-000001]').getByRole('button', { name: 'Выполнено', exact: true }).click(); await page.locator('#result-confirm').check(); await page.getByRole('button', { name: 'Подтвердить выполнение', exact: true }).click(); await exchange();
        await page.locator('#export-pending').selectOption(firstExport); await page.getByRole('button', { name: 'Подтвердить передачу выбранной выгрузки', exact: true }).click(); await page.getByRole('button', { name: 'Подтверждаю передачу', exact: true }).click();
        const state = await read(); assert.equal(state.tasks[0].lastConfirmedExportResult.outcome, 'failed'); assert.equal(C.exportResults(state, 'changes').snapshots.length, 1);
        const dl = await download('Скачать CSV результатов'); assert.equal(C.parseCSV(dl.bytes.toString('utf8')).length, 2);
      });
      await check('варианты периода и всех результатов, ошибки дат', async () => {
        await page.locator('#export-mode').selectOption('period'); assert.equal(await page.locator('#export-from').isVisible(), true);
        await page.locator('#export-from').fill('2026-10-16'); await page.locator('#export-to').fill('2026-10-15'); await page.getByRole('button', { name: 'Скачать CSV результатов', exact: true }).click(); assert.match(await page.locator('#export-error').textContent(), /период/);
        await page.locator('#export-from').fill('2026-10-15'); const dl = await download('Скачать CSV результатов'); assert.equal(C.parseCSV(dl.bytes.toString('utf8')).length, 2);
        await page.locator('#export-mode').selectOption('all'); const all = await download('Скачать CSV результатов'); assert.equal(C.parseCSV(all.bytes.toString('utf8')).length, 3);
      });
      await check('JSON восстанавливает ожидающие файлы, отметки и состояние резервной копии', async () => {
        const copy = JSON.parse((await download('Скачать JSON')).bytes.toString('utf8')); C.validateState(copy); assert(copy.pendingResultExports.length); assert.equal(copy.tasks[0].lastConfirmedExportResult.outcome, 'failed');
        await page.getByRole('button', { name: 'Восстановить JSON', exact: true }).click(); await page.locator('#json-file').setInputFiles({ name: 'copy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) }); await page.waitForFunction(() => !document.querySelector('#restore-apply').disabled); await page.locator('#restore-confirm').check(); await page.locator('#restore-apply').click();
        const state = await read(); assert.deepEqual(state.pendingResultExports, copy.pendingResultExports); assert.equal(state.backupContentHash, copy.backupContentHash);
      });
      await check('напоминание, отложение, следующий день и успешная копия', async () => {
        await reset(seed()); assert.equal(await page.locator('.backup-reminder').count(), 1); await page.getByRole('button', { name: 'Напомнить завтра', exact: true }).click(); assert.equal(await page.locator('.backup-reminder').count(), 0);
        await page.evaluate(() => PlannerCore.setClock(() => new Date('2026-10-16T09:00:00Z'))); await page.clock.runFor(60000); assert.equal(await page.locator('.backup-reminder').count(), 1);
        await download('Создать копию'); assert.equal(await page.locator('.backup-reminder').count(), 0);
        await page.evaluate(() => PlannerCore.setClock(() => new Date('2026-10-17T09:00:00Z'))); await page.clock.runFor(60000); assert.equal(await page.locator('.backup-reminder').count(), 0);
      });
      await check('собственный CSV: защитный апостроф снимается без перезаписи источника', async () => {
        let state = C.recordResult(seed(), 'TASK-000001', 'completed', '2026-10-15', '  - телефон', '2026-10-15'), csv = C.exportResults(state, 'all').csv; await reset(state); await exchange();
        await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await page.locator('#csv-file').setInputFiles({ name: 'planner-results.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await page.waitForFunction(() => document.querySelector('#file-name')?.textContent); await page.getByRole('button', { name: 'Прочитать файл', exact: true }).click(); await page.getByRole('button', { name: 'Проверить данные', exact: true }).click(); await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).click(); await page.getByRole('button', { name: 'Применить импорт', exact: true }).click();
        const restored = await read(); assert.equal(restored.tasks[0].result.comment, '  - телефон'); assert.deepEqual(restored.tasks[0].source, state.tasks[0].source);
      });
      await check('печать полного дня и одной поездки без истории и управления', async () => {
        let state = seed(); const other = C.clone(state.tasks[0]); other.id = 'OTHER'; other.source.destinationId = state.destinations.find(p => p.id !== other.source.destinationId).id; other.source.client = 'Другой клиент'; state.tasks.push(other);
        state = C.setNote(state, 'TASK-000001', 'ПЕЧАТНАЯ ЗАМЕТКА'); state = C.planTasks(state, ['TASK-000001','TASK-000002','OTHER'], '2026-10-15', { today: '2026-10-15' }); await reset(state); await page.evaluate(() => { window.printCalls = 0; window.print = () => window.printCalls++; });
        await page.getByRole('button', { name: 'Печать дня', exact: true }).focus(); await page.keyboard.press('Enter'); assert.equal(await page.locator('#print-root .print-task').count(), 3, JSON.stringify({ print: await page.locator('#print-root').textContent(), date: await page.locator('#calendar-date').inputValue(), tasks: (await read()).tasks.map(t=>({id:t.id,date:t.plannedDate,result:t.result.outcome})) })); assert.match(await page.locator('#print-root').textContent(), /ПЕЧАТНАЯ ЗАМЕТКА/); assert.equal(await page.locator('#print-root button,#print-root input,#print-root .history-event').count(), 0);
        await page.emulateMedia({ media: 'print' }); assert.equal(await page.locator('.app-shell').isVisible(), false); await page.pdf({ path: path.join(__dirname, 'step4-day-' + channel + '.pdf'), preferCSSPageSize: true }); await page.screenshot({ path: path.join(__dirname, 'step4-print-' + channel + '.png'), fullPage: true }); await page.emulateMedia({ media: 'screen' });
        await page.locator('.trip-card').filter({ hasText: 'Суд А' }).getByRole('button', { name: 'Печать поездки', exact: true }).click(); assert.equal(await page.locator('#print-root .print-task').count(), 2); assert.doesNotMatch(await page.locator('#print-root').textContent(), /Другой клиент/);
        assert.equal(await page.evaluate(() => printCalls), 2);
      });
      await check('длинная печать и форма экспорта на узком экране', async () => {
        let state = C.planTasks(seed(), ['TASK-000001'], '2026-10-15', { today: '2026-10-15' }); state.tasks[0].source.description = ('Длинное поручение с полным текстом.\n').repeat(200) + 'КОНЕЦ ПОРУЧЕНИЯ'; await reset(state); await page.evaluate(() => window.print = () => {}); await page.getByRole('button', { name: 'Печать дня', exact: true }).click(); await page.emulateMedia({ media: 'print' }); await page.pdf({ path: path.join(__dirname, 'step4-long-' + channel + '.pdf'), preferCSSPageSize: true }); assert.match(await page.locator('#print-root').textContent(), /КОНЕЦ ПОРУЧЕНИЯ/); await page.emulateMedia({ media: 'screen' });
        await exchange(); await page.setViewportSize({ width: 360, height: 900 }); await page.locator('#export-mode').selectOption('period'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []); assert.deepEqual(network, []);
      });
      results.push({ channel, version: browser.version(), checks, errors, network });
    } finally { await browser.close(); }
    const compatibility = await browserSafeCompatibility(channel); results[results.length-1].unsupportedBrowserMessage = compatibility;
  }
  fs.writeFileSync(path.join(__dirname, 'step4-browser-results.json'), JSON.stringify({ results }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
async function browserSafeCompatibility(channel) {
  const browser = await chromium.launch({ channel, headless: true }); try { const page = await browser.newPage(); await page.addInitScript(() => { window.TextDecoder = class { constructor() { throw Error('unsupported'); } }; }); await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href); assert.match(await page.locator('#main').textContent(), /не поддерживает/); assert.equal(await page.evaluate(() => localStorage.getItem('tripPlanner.state.v1')), null); return 'passed'; } finally { await browser.close(); }
}
