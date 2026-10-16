'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const C = require('../script.js');
const checks = [];
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
async function inputCSV(page, payload) {
  await page.locator('#csv-file').setInputFiles(payload);
  await page.waitForFunction(() => document.querySelector('#file-name')?.textContent);
  await page.getByRole('button', { name: 'Прочитать файл', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить данные', exact: true }).click();
}
async function finishImport(page) { await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).click(); await page.getByRole('button', { name: 'Применить импорт', exact: true }).click(); }
async function readState(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), C.KEY); }
async function writeState(page, state) { await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: C.KEY, state }); await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click(); }
function csvPayload(text, name = 'modified.csv') { return { name, mimeType: 'text/csv', buffer: Buffer.from(text) }; }
async function run(channel) {
  const browser = await chromium.launch({ channel, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-15T09:00:00Z') });
  page.setDefaultTimeout(10000);
  const consoleErrors = [], network = []; page.on('pageerror', e => consoleErrors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
  const title = name => channel + ' · ' + name;
  const url = pathToFileURL(path.join(root, 'index.html')).href;
  try {
    await page.goto(url); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
    await check(title('пустое состояние, навигация, доступный план недели'), async () => {
      assert.equal(await page.getByRole('heading', { name: 'Задачи', exact: true }).count(), 1);
      assert(await page.getByRole('button', { name: 'Неделя', exact: true }).isEnabled());
      assert.equal(await page.locator('.task-card').count(), 0);
      await page.getByRole('button', { name: 'Настройки', exact: true }).click(); assert.equal(await page.getByRole('heading', { name: 'Настройки', exact: true }).count(), 1);
      await page.getByRole('button', { name: 'Обмен данными', exact: true }).click();
    });
    await check(title('импорт справочника, определение заголовка, отмена без записи'), async () => {
      await page.getByRole('button', { name: 'Импортировать справочник', exact: true }).click();
      await page.locator('#csv-file').setInputFiles(path.join(__dirname, 'fixtures/places.csv'));
      await page.waitForFunction(() => document.querySelector('#file-name')?.textContent);
      await page.getByRole('button', { name: 'Прочитать файл', exact: true }).click();
      assert.equal(await page.locator('#csv-header option:checked').textContent(), 'Строка 4: Место направления · Метро · Адрес');
      await page.getByRole('button', { name: 'Проверить данные', exact: true }).click(); await finishImport(page);
      const s = await readState(page); assert.equal(s.destinations.length, 2); assert.equal(s.tasks.length, 0);
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, path.join(__dirname, 'fixtures/tasks.csv'));
      await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).click(); await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
      assert.deepEqual(await readState(page), s);
    });
    await check(title('базовый CSV, подтверждение, список и перезагрузка'), async () => {
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, path.join(__dirname, 'fixtures/tasks.csv')); await finishImport(page);
      const s = await readState(page); assert.equal(s.tasks.length, 3); assert.equal(s.tasks[0].source.documentNumber, '001'); assert.equal(s.tasks[1].source.priority, 'high');
      await page.getByRole('button', { name: 'Задачи', exact: true }).click(); assert.equal(await page.locator('.task-card').count(), 2);
      await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click(); assert.equal(await page.locator('.task-card').count(), 2); assert.equal((await readState(page)).tasks.length, 3);
    });
    await check(title('поиск, сочетания фильтров, сброс и подробности'), async () => {
      await page.locator('#search').fill('КЛИЕНТ Б'); assert.equal(await page.locator('.task-card').count(), 1);
      await page.locator('#filter-priority').selectOption('urgent'); assert.equal(await page.locator('.task-card').count(), 0);
      await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click(); assert.equal(await page.locator('.task-card').count(), 2);
      await page.getByRole('button', { name: 'Выполненные', exact: true }).click(); assert.equal(await page.locator('.task-card').count(), 1);
      await page.getByText('Подробнее и история', { exact: true }).click(); assert(await page.locator('details.task-details').evaluate(e => e.open));
      await page.getByRole('button', { name: 'Все', exact: true }).click(); assert.equal(await page.locator('.task-card').count(), 3);
      await page.screenshot({ path: path.join(__dirname, 'step1-' + channel + '.png'), fullPage: true });
    });
    const sourceCSV = fs.readFileSync(path.join(__dirname, 'fixtures/tasks.csv'), 'utf8');
    await check(title('повторный импорт и отчёт совпадений'), async () => {
      await page.getByRole('button', { name: 'Обмен данными', exact: true }).click(); await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(sourceCSV)); await finishImport(page);
      assert.equal((await readState(page)).tasks.length, 3); await page.getByRole('button', { name: 'Посмотреть отчёт изменений', exact: true }).click(); assert.equal(await page.getByText('Сведения совпадают. Задачи не будут дублироваться.', { exact: true }).count(), 1); await page.getByRole('button', { name: 'Закрыть', exact: true }).first().click();
    });
    await check(title('ошибки ID блокируют подтверждение'), async () => {
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(sourceCSV.replace('TASK-000002', 'TASK-000001')));
      assert(await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).isDisabled()); assert.equal(await page.getByText(/Повторный ID задачи/).count(), 1); await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    });
    await check(title('ошибка даты, явное исключение строки и отчёт'), async () => {
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(sourceCSV.replace('01.10.2026', '31.02.2026')));
      await page.getByLabel('Я подтверждаю исключение этой строки из импорта').check(); await finishImport(page);
      assert.equal((await readState(page)).lastImport.entries.filter(e => e.kind === 'skipped').length, 1);
    });
    await check(title('Windows-1251, BOM, запятая, табуляция, многострочные поля'), async () => {
      const cp = Uint8Array.from([...sourceCSV].map(ch => { const n = ch.codePointAt(0); return n >= 0x410 && n <= 0x44f ? n - 0x410 + 0xc0 : n === 0x2116 ? 0xb9 : n < 128 ? n : 63; }));
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await page.locator('#csv-encoding').selectOption('windows-1251'); await inputCSV(page, { name: '1251.csv', mimeType: 'text/csv', buffer: Buffer.from(cp) }); await finishImport(page); assert.equal((await readState(page)).tasks[0].source.client, 'Клиент А');
      const records = C.parseCSV(sourceCSV);
      for (const separator of [',', '\t']) {
        const text = '\uFEFF' + records.map(r => r.cells.map(cell => '"' + cell.replaceAll('"', '""') + '"').join(separator)).join('\r\n');
        await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(text)); await finishImport(page);
        assert.equal((await readState(page)).tasks.length, 3);
      }
      const text = sourceCSV.replace('Подать заявление', '"Первая строка\nВторая строка"');
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(text)); await finishImport(page); assert.equal((await readState(page)).tasks[0].source.description, 'Первая строка\nВторая строка');
    });
    await check(title('новое учреждение создаётся автоматически; выбор приоритета сохраняется'), async () => {
      const text = sourceCSV.replace('Суд А;Подать', 'Суд А, канцелярия;Подать').replace('обычный;Новая', 'особый;Новая');
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(text));
      await page.getByLabel('Приоритет для этого значения').selectOption('urgent'); await finishImport(page);
      const next = await readState(page); assert.equal(next.destinations.find(p => p.id === next.tasks[0].source.destinationId).name, 'Суд А, канцелярия'); assert.equal(next.tasks[0].source.priority, 'urgent');
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(text.replace('особый', 'срочно'))); await finishImport(page); assert.equal((await readState(page)).destinations.length, 3);
    });
    await check(title('противоречие статуса и отметки: выбор через радиокнопку'), async () => {
      const text = sourceCSV.replace('обычный;Новая;FALSE;;', 'обычный;Новая;TRUE;05.10.2026;');
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(text));
      await page.getByLabel('Использовать статус: Новая', { exact: true }).check(); await finishImport(page); assert.equal((await readState(page)).tasks[0].result.outcome, 'none');
    });
    await check(title('отмена требует отдельного подтверждения, возврат сбрасывает локальный план'), async () => {
      const text = sourceCSV.replace('обычный;Новая;FALSE;;', 'обычный;Отменена;FALSE;;');
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(text)); await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).click();
      await page.getByRole('button', { name: 'Применить импорт', exact: true }).click(); assert.equal((await readState(page)).tasks[0].result.outcome, 'none'); await page.locator('#confirm-cancellation').check(); await page.getByRole('button', { name: 'Применить импорт', exact: true }).click(); assert.equal((await readState(page)).tasks[0].result.outcome, 'cancelled');
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(sourceCSV)); await finishImport(page); assert.equal((await readState(page)).tasks[0].result.outcome, 'none'); assert.equal((await readState(page)).tasks[0].plannedDate, null);
    });
    await check(title('неизвестный статус, адрес и русские подписи различий'), async () => {
      const text = sourceCSV.replace('обычный;Новая;FALSE;;', 'обычный;готово;TRUE;05.10.2026;Принято');
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(text)); await page.getByLabel('Статус для этого значения').selectOption('completed'); await finishImport(page);
      assert.equal((await readState(page)).tasks[0].result.outcome, 'completed');
      const places = fs.readFileSync(path.join(__dirname, 'fixtures/places.csv'), 'utf8').replace('Тестовая ул., 1', 'Новая тестовая ул., 5');
      await page.getByRole('button', { name: 'Импортировать справочник', exact: true }).click(); await inputCSV(page, csvPayload(places, 'places-changed.csv'));
      assert.equal(await page.getByText('Адрес: Тестовая ул., 1', { exact: false }).count() > 0, true);
      await page.getByLabel('Принять данные CSV', { exact: true }).check(); await finishImport(page); assert.equal((await readState(page)).destinations[0].address, 'Новая тестовая ул., 5');
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(sourceCSV)); await finishImport(page);
    });
    await check(title('локальное выполнение не теряется; реальный конфликт выбирается'), async () => {
      const s = await readState(page); s.tasks[0].result = { outcome: 'completed', date: '2026-10-07', comment: 'Локально выполнено' }; s.tasks[0].documentsReady = true; s.tasks[0].localNote = 'Кабинет 7'; s.tasks[0].plannedDate = '2026-10-20'; s.revision++; await writeState(page, s);
      await page.getByRole('button', { name: 'Обмен данными', exact: true }).click(); await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(sourceCSV)); await finishImport(page); assert.equal((await readState(page)).tasks[0].result.outcome, 'completed');
      const conflicting = sourceCSV.replace('обычный;Новая;FALSE;;', 'обычный;Не удалось выполнить;FALSE;08.10.2026;Закрыто');
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(conflicting));
      assert.equal(await page.getByRole('heading', { name: 'Различаются результаты задачи TASK-000001' }).count(), 1);
      await page.getByLabel('Оставить данные приложения', { exact: true }).check(); await finishImport(page); const next = await readState(page); assert.equal(next.tasks[0].result.outcome, 'completed'); assert.equal(next.tasks[0].lastCsvResult.outcome, 'failed'); assert.equal(next.tasks[0].localNote, 'Кабинет 7');
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(conflicting)); await finishImport(page); assert.equal((await readState(page)).tasks[0].result.outcome, 'completed');
    });
    await check(title('скачивание JSON, валидность и восстановление'), async () => {
      const dlPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать JSON', exact: true }).click(); const dl = await dlPromise; const file = await dl.path(); const copy = JSON.parse(fs.readFileSync(file, 'utf8')); C.validateState(copy); assert.equal(copy.tasks.length, 3);
      await page.getByRole('button', { name: 'Восстановить JSON', exact: true }).click();
      await page.locator('#json-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') }); assert(await page.getByRole('button', { name: 'Заменить данные', exact: true }).isDisabled());
      await page.locator('#json-file').setInputFiles({ name: 'new-schema.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...copy, schemaVersion: 2 })) }); await page.waitForFunction(() => document.querySelector('#restore-preview').textContent.includes('более новой')); assert(await page.locator('#restore-apply').isDisabled());
      await page.locator('#json-file').setInputFiles({ name: 'copy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) }); await page.waitForFunction(() => !document.querySelector('#restore-apply').disabled);
      await page.locator('#restore-confirm').check(); await page.getByRole('button', { name: 'Заменить данные', exact: true }).click(); assert.equal((await readState(page)).tasks[0].localNote, 'Кабинет 7');
    });
    await check(title('безопасное отображение HTML из CSV'), async () => {
      const injected = sourceCSV.replace('Клиент Б', '<img src=x onerror="window.__unsafe=1">');
      // Кавычки CSV экранируются как текст, исходный атрибут здесь без кавычек.
      const safeCSV = injected.replace('onerror="window.__unsafe=1"', 'onerror=window.__unsafe=1');
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(safeCSV));
      const conflicts = await page.getByLabel('Оставить данные приложения', { exact: true }).count(); if (conflicts) await page.getByLabel('Оставить данные приложения', { exact: true }).check(); await finishImport(page);
      await page.getByRole('button', { name: 'Задачи', exact: true }).click(); await page.getByRole('button', { name: 'Все', exact: true }).click();
      assert.equal(await page.locator('.task-card img').count(), 0); assert.equal(await page.evaluate(() => window.__unsafe), undefined); assert.equal(await page.getByText('<img src=x onerror=window.__unsafe=1>', { exact: true }).count(), 1);
    });
    await check(title('устаревшая вкладка не записывает данные'), async () => {
      const second = await context.newPage(); await second.goto(url); const s = await readState(page); s.revision++; s.tasks[1].localNote = 'Из второй вкладки';
      await second.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: C.KEY, state: s });
      await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Только просмотр'); assert.equal(await page.getByRole('button', { name: 'Перезагрузить данные', exact: true }).count(), 1);
      await second.close(); await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
    });
    await check(title('ошибка записи: старое состояние и скачиваемый кандидат'), async () => {
      await page.getByRole('button', { name: 'Обмен данными', exact: true }).click();
      const before = await readState(page); await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Тестовая квота', 'QuotaExceededError'); }; });
      await page.getByRole('button', { name: 'Импортировать задачи', exact: true }).click(); await inputCSV(page, csvPayload(sourceCSV));
      const conflicts = await page.getByLabel('Оставить данные приложения', { exact: true }).count(); if (conflicts) await page.getByLabel('Оставить данные приложения', { exact: true }).check(); await page.getByRole('button', { name: 'Продолжить проверку', exact: true }).click(); await page.getByRole('button', { name: 'Применить импорт', exact: true }).click();
      assert.deepEqual(await readState(page), before); await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
      const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать несохранённые изменения', exact: true }).click(); const dl = await downloadPromise; const candidate = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); C.validateState(candidate); await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
    });
    await check(title('повреждённое хранилище: блокировка, исходный файл и восстановление'), async () => {
      const copy = await readState(page); await page.evaluate(key => localStorage.setItem(key, '{broken'), C.KEY); await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
      assert.equal(await page.getByText('Данные не загружены. Запись заблокирована', { exact: true }).count(), 1); assert(await page.getByRole('button', { name: 'Импортировать файл', exact: true }).isDisabled());
      const dlPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать исходное хранилище', exact: true }).click(); const dl = await dlPromise; assert.equal(fs.readFileSync(await dl.path(), 'utf8'), '{broken');
      await page.getByRole('button', { name: 'Восстановить JSON', exact: true }).click(); await page.locator('#json-file').setInputFiles({ name: 'copy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) }); await page.waitForFunction(() => !document.querySelector('#restore-apply').disabled); await page.locator('#restore-confirm').check(); await page.getByRole('button', { name: 'Заменить данные', exact: true }).click(); assert.equal((await readState(page)).tasks.length, 3);
    });
    await check(title('узкий экран, фокус, консоль, отсутствие сетевых запросов'), async () => {
      await page.setViewportSize({ width: 360, height: 800 }); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.keyboard.press('Tab'); assert(await page.evaluate(() => document.activeElement !== document.body));
      assert.deepEqual(consoleErrors, []); assert.deepEqual(network, []);
    });
    console.log('BROWSER ' + channel + ' ' + await browser.version());
    return { channel, version: await browser.version(), checks: checks.filter(s => s.startsWith(channel)), consoleErrors, network };
  } finally { await browser.close(); }
}
async function persistentCheck(channel) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-step1-'));
  const url = pathToFileURL(path.join(root, 'index.html')).href;
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel, headless: true });
    let page = await context.newPage(); await page.goto(url); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
    await page.getByRole('button', { name: 'Импортировать файл', exact: true }).click(); await inputCSV(page, path.join(__dirname, 'fixtures/tasks.csv'));
    await finishImport(page);
    const before = await readState(page); await context.close(); context = null;
    context = await chromium.launchPersistentContext(profile, { channel, headless: true }); page = await context.newPage(); await page.goto(url); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
    assert.deepEqual(await readState(page), before); assert.equal(await page.locator('.task-card').count(), 2);
    console.log('PASS ' + channel + ' · сохранение после полного закрытия и нового запуска браузера');
    return { channel, persistence: true };
  } finally {
    if (context) await context.close();
    // Удаляется только проверенная временная тестовая папка, созданная выше.
    const resolved = fs.realpathSync(profile), tmp = fs.realpathSync(os.tmpdir());
    const relative = path.relative(tmp, resolved);
    assert(!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(resolved).startsWith('planner-step1-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
(async () => { const results = [], persistence = []; for (const channel of ['chrome', 'msedge']) { results.push(await run(channel)); persistence.push(await persistentCheck(channel)); } fs.writeFileSync(path.join(__dirname, 'step1-browser-results.json'), JSON.stringify({ results, persistence }, null, 2)); })().catch(error => { console.error(error); process.exitCode = 1; });
