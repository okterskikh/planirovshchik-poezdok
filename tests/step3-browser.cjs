'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js'), fixture = path.join(__dirname, 'fixtures/tasks.csv'), csv = C.parseCSV(fs.readFileSync(fixture, 'utf8'));
const rows = C.mappedRows(csv, 0, C.mappingFor(csv[0].cells, 'tasks'));
const seed = () => C.buildImport(C.emptyState(), rows).state;
(async () => {
  const results = [];
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel, headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.setDefaultTimeout(10000); await page.clock.install({ time: new Date('2026-10-15T09:00:00Z') });
    const checks = [], errors = []; page.on('pageerror', e => errors.push(e.message));
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('tripPlanner.state.v1')));
    const task = id => page.locator('#task-list [data-task-id="' + id + '"]');
    const first = () => task('TASK-000001');
    const reset = async state => { await page.evaluate(state => localStorage.setItem('tripPlanner.state.v1', JSON.stringify(state)), state); await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click(); await page.getByRole('button', { name: 'Задачи', exact: true }).click(); await page.getByRole('button', { name: 'Активные', exact: true }).click(); };
    const undo = () => page.getByRole('button', { name: 'Отменить действие', exact: true }).click();
    const close = () => page.locator('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
    const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + channel + ' · ' + name); };
    const importCSV = async payload => {
      await page.getByRole('button', { name: 'Обмен данными', exact: true }).click(); await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click();
      await page.locator('#csv-file').setInputFiles(payload); await page.waitForFunction(() => document.querySelector('#file-name')?.textContent);
      await page.getByRole('button', { name: 'Прочитать файл', exact: true }).click(); await page.getByRole('button', { name: 'Проверить данные', exact: true }).click();
    };
    const apply = async () => { await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).click(); await page.getByRole('button', { name: 'Применить импорт', exact: true }).click(); };
    const complete = async id => { await task(id).getByRole('button', { name: 'Выполнено', exact: true }).click(); await page.locator('#result-confirm').check(); await page.getByRole('button', { name: 'Подтвердить выполнение', exact: true }).click(); };
    try {
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href); await reset(seed());
      await check('документы, отмена и сохранение после перезагрузки', async () => {
        await first().getByRole('checkbox', { name: 'Документы готовы', exact: true }).check(); assert.equal((await read()).tasks[0].documentsReady, true);
        await undo(); assert.equal((await read()).tasks[0].documentsReady, false);
        await first().getByRole('checkbox', { name: 'Документы готовы', exact: true }).check(); await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click(); await page.getByRole('button', { name: 'Активные', exact: true }).click();
        assert.equal(await first().getByRole('checkbox', { name: 'Документы готовы', exact: true }).isChecked(), true);
      });
      await check('заметка, лимит, поиск, очистка и отмена', async () => {
        await first().getByRole('button', { name: 'Добавить заметку', exact: true }).click(); assert.equal(await page.locator('#note-text').getAttribute('maxlength'), '2000');
        await page.locator('#note-text').fill('Кабинет 25\nПриём до 16:00'); await page.getByRole('button', { name: 'Сохранить заметку', exact: true }).click();
        assert.match(await first().locator('.local-note').textContent(), /Кабинет 25/); await page.locator('#search').fill('Кабинет 25'); assert.equal(await page.locator('#task-list .task-card').count(), 1);
        await page.locator('#search').fill(''); await first().getByRole('button', { name: 'Изменить заметку', exact: true }).click(); await page.locator('#note-text').fill(''); await page.getByRole('button', { name: 'Сохранить заметку', exact: true }).click();
        await undo(); assert.match((await read()).tasks[0].localNote, /Кабинет 25/);
      });
      await check('групповая готовность с подтверждением и снятием', async () => {
        let s = seed(); s = C.planTasks(s, s.tasks.slice(0, 2).map(t => t.id), '2026-10-15', { today: '2026-10-15' }); await reset(s);
        await page.getByRole('button', { name: 'День', exact: true }).click(); await page.getByRole('button', { name: 'Все документы готовы', exact: true }).click(); await close(); assert.equal((await read()).tasks[0].documentsReady, false);
        await page.getByRole('button', { name: 'Все документы готовы', exact: true }).click(); await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click(); assert((await read()).tasks.slice(0, 2).every(t => t.documentsReady));
        await page.getByRole('button', { name: 'Снять готовность у всех', exact: true }).click(); assert((await read()).tasks.slice(0, 2).every(t => !t.documentsReady)); await undo(); assert((await read()).tasks.slice(0, 2).every(t => t.documentsReady));
      });
      await check('валидация выполнения и обязательное подтверждение', async () => {
        await reset(seed()); await first().getByRole('button', { name: 'Выполнено', exact: true }).click();
        await page.getByRole('button', { name: 'Подтвердить выполнение', exact: true }).click(); assert.match(await page.locator('#result-error').textContent(), /Подтвердите/);
        await page.locator('#result-confirm').check(); await page.locator('#result-date').fill('2026-10-16'); await page.getByRole('button', { name: 'Подтвердить выполнение', exact: true }).click(); assert.match(await page.locator('#result-error').textContent(), /не позднее/);
        assert.equal((await read()).tasks[0].result.outcome, 'none'); await close();
      });
      await check('завершение из поездки и удаление пустой поездки', async () => {
        let s = seed(); s = C.planTasks(s, s.tasks.slice(0, 2).map(t => t.id), '2026-10-15', { today: '2026-10-15' }); await reset(s); await page.getByRole('button', { name: 'День', exact: true }).click(); await page.locator('.trip-tasks>summary').click();
        await page.locator('[data-trip-task=TASK-000001]').getByRole('button', { name: 'Выполнено', exact: true }).click(); await page.locator('#result-confirm').check(); await page.getByRole('button', { name: 'Подтвердить выполнение', exact: true }).click(); assert.match(await page.locator('.trip-counts').textContent(), /Задач: 1/);
        await page.locator('.trip-tasks>summary').click(); await page.locator('[data-trip-task=TASK-000002]').getByRole('button', { name: 'Выполнено', exact: true }).click(); await page.locator('#result-confirm').check(); await page.getByRole('button', { name: 'Подтвердить выполнение', exact: true }).click(); assert.equal(await page.locator('.trip-card').count(), 0); assert.equal(await page.locator('#undo-planning').isVisible(), false);
      });
      await check('попытки, обязательная причина, история и новая дата', async () => {
        await reset(seed());
        for (const reason of ['Приём закрыт', 'Документы не приняли']) {
          await first().getByRole('button', { name: 'Не удалось', exact: true }).click(); await page.locator('#result-comment').fill('   '); await page.getByRole('button', { name: 'Сохранить попытку', exact: true }).click(); assert.match(await page.locator('#result-error').textContent(), /причину/);
          await page.locator('#result-comment').fill(reason); await page.getByRole('button', { name: 'Сохранить попытку', exact: true }).click(); assert.equal(await page.locator('#schedule-date').isVisible(), true); await close();
        }
        assert.equal((await read()).tasks[0].history.filter(h => h.type === 'failed').length, 2); assert.match(await first().locator('.attempt-note').textContent(), /Документы не приняли/);
        await first().getByRole('button', { name: 'История', exact: true }).click(); assert.match(await page.locator('dialog').textContent(), /Приём закрыт/); await page.locator('dialog').getByRole('button', { name: 'Закрыть', exact: true }).first().click();
      });
      await check('выполнение в форме при смене дня не переносится, черновик сохранён', async () => {
        let s = C.planTasks(seed(), ['TASK-000001'], '2026-10-15', { today: '2026-10-15' }); await reset(s); await first().getByRole('button', { name: 'Выполнено', exact: true }).click(); await page.locator('#result-comment').fill('Получена отметка');
        await page.evaluate(() => PlannerCore.setClock(() => new Date('2026-10-16T09:00:00Z'))); await page.clock.runFor(60000); assert.equal(await page.locator('#result-comment').inputValue(), 'Получена отметка'); assert.equal((await read()).tasks[0].plannedDate, '2026-10-15');
        await page.locator('#result-confirm').check(); await page.getByRole('button', { name: 'Подтвердить выполнение', exact: true }).click(); assert.equal((await read()).tasks[0].plannedDate, '2026-10-15'); assert.equal((await read()).tasks[0].result.outcome, 'completed');
      });
      await check('заметка при смене дня: отложенный перенос сохраняет текст', async () => {
        let s = C.planTasks(seed(), ['TASK-000001'], '2026-10-15', { today: '2026-10-15' }); await reset(s); await first().getByRole('button', { name: 'Добавить заметку', exact: true }).click(); await page.locator('#note-text').fill('Не потерять черновик');
        await page.evaluate(() => PlannerCore.setClock(() => new Date('2026-10-16T09:00:00Z'))); await page.clock.runFor(60000); assert.equal(await page.locator('#note-text').inputValue(), 'Не потерять черновик');
        await page.getByRole('button', { name: 'Сохранить заметку', exact: true }).click(); const stored = await read(); assert.equal(stored.tasks[0].localNote, 'Не потерять черновик'); assert.equal(stored.tasks[0].plannedDate, '2026-10-16');
      });
      await check('повторный CSV сохраняет выполнение; реальное изменение вызывает один конфликт', async () => {
        await reset(seed()); await complete('TASK-000001'); await importCSV(fixture); assert.equal(await page.getByText('Различаются результаты задачи TASK-000001', { exact: true }).count(), 0); await apply(); assert.equal((await read()).tasks[0].result.outcome, 'completed');
        const changed = fs.readFileSync(fixture, 'utf8').replace('Новая;FALSE;;', 'Не удалось выполнить;FALSE;15.10.2026;Другая попытка');
        assert.notEqual(changed, fs.readFileSync(fixture, 'utf8')); await importCSV({ name: 'changed.csv', mimeType: 'text/csv', buffer: Buffer.from(changed) });
        assert.equal(await page.getByText('Различаются результаты задачи TASK-000001', { exact: true }).count(), 1); await page.locator('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
      });
      await check('возврат и отмена из таблицы сохраняют заметку и историю', async () => {
        let s = C.planTasks(seed(), ['TASK-000001'], '2026-10-15', { today: '2026-10-15' }); s = C.setDocuments(s, ['TASK-000001'], true); s = C.setNote(s, 'TASK-000001', 'Окно 3'); await reset(s); await complete('TASK-000001');
        const payload = text => ({ name: 'updated.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
        const original = fs.readFileSync(fixture, 'utf8'); await importCSV(payload(original.replace('Новая;FALSE;;', 'Выполнена;TRUE;15.10.2026;'))); await apply();
        await importCSV(fixture); await apply(); let stored = await read(); assert.equal(stored.tasks[0].result.outcome, 'none'); assert.equal(stored.tasks[0].plannedDate, null); assert.equal(stored.tasks[0].documentsReady, false); assert.equal(stored.tasks[0].localNote, 'Окно 3'); assert(stored.tasks[0].history.some(h => h.type === 'completed'));
        await importCSV(payload(original.replace('Новая;FALSE;;', 'Отменена;FALSE;;'))); await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).click(); await page.locator('#confirm-cancellation').check(); await page.getByRole('button', { name: 'Применить импорт', exact: true }).click();
        stored = await read(); assert.equal(stored.tasks[0].result.outcome, 'cancelled'); assert.equal(stored.tasks[0].localNote, 'Окно 3');
      });
      await check('ошибка записи сохраняет форму и старый результат', async () => {
        await reset(seed()); await first().getByRole('button', { name: 'Выполнено', exact: true }).click(); await page.locator('#result-comment').fill('Черновик результата'); await page.locator('#result-confirm').check();
        await page.evaluate(() => { window.savedSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('TEST_QUOTA'); }; });
        await page.getByRole('button', { name: 'Подтвердить выполнение', exact: true }).click(); assert.match(await page.locator('#result-error').textContent(), /TEST_QUOTA/); assert.equal(await page.locator('#result-comment').inputValue(), 'Черновик результата'); assert.equal((await read()).tasks[0].result.outcome, 'none');
        await page.evaluate(() => Storage.prototype.setItem = window.savedSetItem); await close();
      });
      await check('узкая компоновка и отсутствие ошибок', async () => {
        await reset(seed()); await page.setViewportSize({ width: 360, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await first().getByRole('button', { name: 'Добавить заметку', exact: true }).click(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await close();
        await page.setViewportSize({ width: 1440, height: 1100 }); await page.screenshot({ path: path.join(__dirname, 'step3-' + channel + '.png'), fullPage: true }); assert.deepEqual(errors, []);
      });
      results.push({ channel, version: browser.version(), checks, errors });
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(__dirname, 'step3-browser-results.json'), JSON.stringify({ results }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
