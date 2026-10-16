'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js'), records = C.parseCSV(fs.readFileSync(path.join(__dirname, 'fixtures/tasks.csv'), 'utf8'));
function seed() {
  const state = C.buildImport(C.emptyState(), C.mappedRows(records, 0, C.mappingFor(records[0].cells, 'tasks'))).state;
  for (const [name, priority] of [['B', 'high'], ['C', 'urgent'], ['D', 'normal']]) {
    state.destinations.push({ id: name, name: 'Суд ' + name, metro: '', address: '', location: '', aliases: [] });
    const task = C.clone(state.tasks[0]); task.id = 'TASK-' + name; task.source.client = 'Клиент ' + name; task.source.destinationId = name; task.source.priority = priority; task.history = []; state.tasks.push(task);
  }
  C.validateState(state); return state;
}
const url = pathToFileURL(path.join(__dirname, '../index.html')).href, results = [];
async function read(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('tripPlanner.state.v1'))); }
async function install(page, state) { await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: C.KEY, state }); await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click(); }
async function choose(page, date, consent = false) { await page.locator('#schedule-date').fill(date); if (consent) await page.locator('#schedule-consent').check(); await page.getByRole('button', { name: 'Сохранить дату', exact: true }).click(); }
async function schedule(page, id, date) { await page.locator('[data-task-id="' + id + '"]').getByRole('button', { name: /Назначить день|Перенести/, exact: true }).click(); await choose(page, date); }
async function day(page, date) { await page.getByRole('button', { name: 'День', exact: true }).click(); await page.locator('#calendar-date').fill(date); }
async function clock(page, iso) { await page.evaluate(iso => PlannerCore.setClock(() => new Date(iso)), iso); }
(async () => {
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel, headless: true }), context = await browser.newContext({ viewport: { width: 1920, height: 1100 } }), page = await context.newPage(); page.setDefaultTimeout(10000);
    await page.clock.install({ time: new Date('2026-10-15T09:00:00Z') });
    const errors = [], checks = []; page.on('pageerror', e => errors.push(e.message));
    const check = async (name, action) => { await action(); checks.push(name); console.log('PASS ' + channel + ' · ' + name); };
    try {
      await page.goto(url); await page.getByRole('button', { name: 'Задачи', exact: true }).click(); await install(page, seed());
      await check('назначение, объединение суда, снятие даты и отмена последнего действия', async () => {
        await schedule(page, 'TASK-000001', '2026-10-16'); await schedule(page, 'TASK-000002', '2026-10-16'); await day(page, '2026-10-16'); assert.equal(await page.locator('.trip-card').count(), 1); assert.match(await page.locator('.trip-counts').textContent(), /Задач: 2/);
        await page.getByRole('button', { name: 'Отменить действие', exact: true }).click(); assert.equal((await read(page)).tasks[1].plannedDate, null); assert.equal((await read(page)).tasks[0].plannedDate, '2026-10-16');
        await page.getByRole('button', { name: 'Задачи', exact: true }).click(); await page.getByRole('button', { name: 'Активные', exact: true }).click(); await page.locator('[data-task-id=TASK-000001]').getByRole('button', { name: 'Снять дату', exact: true }).click(); assert.equal((await read(page)).tasks[0].plannedDate, null); assert.equal((await read(page)).tasks[0].history.at(-1).type, 'unplan');
      });
      await check('массовое назначение и сохранение после перезагрузки', async () => {
        await page.getByRole('button', { name: 'Выбрать все активные в списке', exact: true }).click(); assert.equal(await page.locator('.task-select:checked').count(), 5); await page.locator('#bulk-planning').getByRole('button', { name: 'Назначить день', exact: true }).click(); await choose(page, '2026-10-16');
        assert.equal((await read(page)).tasks.filter(t => t.plannedDate === '2026-10-16').length, 5); await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click(); await day(page, '2026-10-16'); assert.equal(await page.locator('.trip-card').count(), 4);
      });
      await check('исключённые даты, выходные и запрет прошедшей даты', async () => {
        await install(page, seed()); await page.getByRole('button', { name: 'Настройки', exact: true }).click(); await page.locator('#excluded-date').fill('2026-10-19'); await page.getByRole('button', { name: 'Добавить исключение', exact: true }).click(); assert.deepEqual((await read(page)).excludedDates, ['2026-10-19']);
        await page.getByRole('button', { name: 'Задачи', exact: true }).click(); await page.locator('[data-task-id=TASK-D]').getByRole('button', { name: 'Назначить день', exact: true }).click(); await choose(page, '2026-10-14'); assert.match(await page.locator('#schedule-error').textContent(), /прошедшую/);
        await choose(page, '2026-10-19'); assert.match(await page.locator('#schedule-error').textContent(), /Подтвердите/); await page.locator('#schedule-consent').check(); await page.getByRole('button', { name: 'Сохранить дату', exact: true }).click(); assert.equal((await read(page)).tasks.find(t => t.id === 'TASK-D').plannedDate, '2026-10-19');
      });
      await check('перетаскивание задач и целой поездки, перенос между неделями кнопкой', async () => {
        await install(page, seed()); await page.getByRole('button', { name: 'Неделя', exact: true }).click(); assert.equal(await page.locator('[data-day]').count(), 7);
        await page.locator('[data-backlog-task=TASK-000001]').locator('..').evaluate(e => e.open = true); await page.locator('[data-backlog-task=TASK-000001] .drag-handle').dragTo(page.locator('[data-day="2026-10-16"]'), { targetPosition: { x: 20, y: 20 } }); assert.equal((await read(page)).tasks[0].plannedDate, '2026-10-16');
        await page.locator('[data-backlog-task=TASK-000002]').locator('..').evaluate(e => e.open = true); await page.locator('[data-backlog-task=TASK-000002] .drag-handle').dragTo(page.locator('[data-day="2026-10-16"]'), { targetPosition: { x: 20, y: 20 } }); assert.equal(await page.locator('.trip-card').count(), 1);
        await page.locator('.trip-card > .button-row .drag-handle').dragTo(page.locator('[data-day="2026-10-15"]'), { targetPosition: { x: 20, y: 20 } }); assert.equal((await read(page)).tasks[0].plannedDate, '2026-10-15'); assert.equal((await read(page)).tasks[1].plannedDate, '2026-10-15');
        await page.getByRole('button', { name: 'Перенести поездку', exact: true }).click(); await choose(page, '2026-10-20'); assert.equal((await read(page)).tasks[1].plannedDate, '2026-10-20'); await page.locator('#calendar-date').fill('2026-10-20'); assert.equal(await page.locator('.trip-card').count(), 1);
        await page.getByText('Задачи поездки · 2', { exact: true }).click(); await page.locator('[data-trip-task=TASK-000001]').getByRole('button', { name: 'Перенести задачу', exact: true }).click(); await choose(page, '2026-10-21'); assert.equal((await read(page)).tasks[1].plannedDate, '2026-10-20'); assert.equal(await page.locator('.trip-card').count(), 2);
      });
      await check('стрелки, перетаскивание порядка и новая автосортировка', async () => {
        let state = seed(); state = C.planTasks(state, ['TASK-000001', 'TASK-B', 'TASK-C'], '2026-10-16', { today: '2026-10-15' }); await install(page, state); await day(page, '2026-10-16');
        const names = () => page.locator('.trip-card .trip-heading strong').allTextContents(); assert.deepEqual(await names(), ['Суд C', 'Суд B', 'Суд А']);
        await page.locator('.trip-card').last().getByRole('button', { name: '↑', exact: true }).click(); assert.deepEqual(await names(), ['Суд C', 'Суд А', 'Суд B']);
        const sourceHandle = page.locator('.trip-card').nth(1).locator(':scope > .button-row .drag-handle'); await sourceHandle.scrollIntoViewIfNeeded(); const sourceBox = await sourceHandle.boundingBox(); await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2); await page.mouse.down(); await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 10, sourceBox.y + sourceBox.height / 2 + 10, { steps: 5 }); await page.locator('.trip-card').first().evaluate(e => e.scrollIntoView({ block: 'center' })); const targetBox = await page.locator('.trip-card').first().boundingBox(); await page.mouse.move(targetBox.x + 20, targetBox.y + 20, { steps: 10 }); await page.mouse.up(); assert.deepEqual(await names(), ['Суд А', 'Суд C', 'Суд B']);
        await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click(); await day(page, '2026-10-16'); assert.deepEqual(await names(), ['Суд А', 'Суд C', 'Суд B']);
        await page.locator('[data-backlog-task=TASK-D]').locator('..').evaluate(e => e.open = true); await page.locator('[data-backlog-task=TASK-D]').getByRole('button', { name: 'Назначить день', exact: true }).click(); await choose(page, '2026-10-16'); assert.deepEqual(await names(), ['Суд C', 'Суд B', 'Суд А', 'Суд D']);
      });
      await check('автоперенос на загрузке, после фокуса и без дублей', async () => {
        const state = seed(); state.tasks[0].plannedDate = '2026-10-01'; await install(page, state); assert.equal((await read(page)).tasks[0].plannedDate, '2026-10-15');
        await clock(page, '2026-10-17T09:00:00Z'); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); assert.equal((await read(page)).tasks[0].plannedDate, '2026-10-19');
        const count = (await read(page)).tasks[0].history.filter(h => h.type === 'auto-rollover').length; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); assert.equal((await read(page)).tasks[0].history.filter(h => h.type === 'auto-rollover').length, count);
      });
      await check('таймер, отложенный перенос в форме и сохранение введённой даты', async () => {
        await install(page, seed()); await schedule(page, 'TASK-000001', '2026-10-15'); await page.getByRole('button', { name: 'Активные', exact: true }).click(); await page.locator('[data-task-id=TASK-000001]').getByRole('button', { name: 'Перенести', exact: true }).click(); await page.locator('#schedule-date').fill('2026-10-20');
        await clock(page, '2026-10-17T09:00:00Z'); await page.clock.runFor(61000); assert.equal((await read(page)).tasks[0].plannedDate, '2026-10-15'); assert.equal(await page.locator('#schedule-date').inputValue(), '2026-10-20');
        await page.getByRole('button', { name: 'Отмена', exact: true }).click(); assert.equal((await read(page)).tasks[0].plannedDate, '2026-10-19'); assert.equal(await page.locator('#undo-planning').isVisible(), false);
      });
      await check('предупреждение нагрузки и массовый перенос выбранного дня', async () => {
        const state = seed(), template = state.tasks[0]; state.tasks = Array.from({ length: 35 }, (_, i) => ({ ...C.clone(template), id: 'BULK-' + i, plannedDate: '2026-10-16', firstPlannedDate: '2026-10-16' })); await install(page, state); await day(page, '2026-10-16'); assert.equal(await page.getByText(/Большая нагрузка: 1 поездок, 35 задач/).count(), 1);
        await page.getByRole('button', { name: 'Выбрать задачи', exact: true }).click(); await page.getByRole('button', { name: 'Выбрать все активные в списке', exact: true }).click(); await page.locator('#bulk-planning').getByRole('button', { name: 'Назначить день', exact: true }).click(); await choose(page, '2026-10-20'); assert.equal((await read(page)).tasks.filter(t => t.plannedDate === '2026-10-20').length, 35);
      });
      await check('порог числа поездок и резервная копия полного плана', async () => {
        const state = seed(), template = C.clone(state.tasks[0]); state.tasks = [];
        for (let i = 0; i < 11; i++) { const id = 'EXTRA-' + i; state.destinations.push({ id, name: 'Суд ' + i, address: '', metro: '', location: '', aliases: [] }); const t = C.clone(template); t.id = 'TRIP-' + i; t.source.destinationId = id; t.plannedDate = '2026-10-16'; t.firstPlannedDate = '2026-10-16'; state.tasks.push(t); }
        state.excludedDates = ['2026-10-19']; await install(page, state); await day(page, '2026-10-16'); assert.equal(await page.getByText(/Большая нагрузка: 11 поездок, 11 задач/).count(), 1);
        await page.getByRole('button', { name: 'Обмен данными', exact: true }).click(); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать JSON', exact: true }).click(); const download = await downloading; const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8')); C.validateState(backup); assert.equal(backup.tasks.length, 11); assert.deepEqual(backup.excludedDates, ['2026-10-19']);
      });
      await check('недельная навигация, сегодня, снимки и узкая компоновка', async () => {
        let state = C.planTasks(seed(), ['TASK-000001', 'TASK-B', 'TASK-C'], '2026-10-16', { today: '2026-10-15' }); await install(page, state); await page.getByRole('button', { name: 'Неделя', exact: true }).click();
        await page.getByRole('button', { name: 'Вперёд →', exact: true }).click(); assert.equal(await page.locator('[data-day]').first().getAttribute('data-day'), '2026-10-19'); await page.getByRole('button', { name: 'Сегодня', exact: true }).click(); assert.equal(await page.locator('[data-day]').first().getAttribute('data-day'), '2026-10-12');
        await page.screenshot({ path: path.join(__dirname, 'step2-week-' + channel + '.png'), fullPage: true }); await page.setViewportSize({ width: 360, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.equal(await page.locator('[data-day]').count(), 7); assert.deepEqual(errors, []);
      });
      results.push({ channel, version: await browser.version(), checks, errors });
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(__dirname, 'step2-browser-results.json'), JSON.stringify({ results }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
