'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js'), csv = fs.readFileSync(path.join(__dirname, 'fixtures/tasks.csv'), 'utf8');
const records = C.parseCSV(csv), state = C.buildImport(C.emptyState(), C.mappedRows(records, 0, C.mappingFor(records[0].cells, 'tasks'))).state;
state.destinations.push({ id: 'unused', name: 'Неиспользуемый суд', address: '', metro: '', location: '', aliases: [] });
const results = [];
(async () => {
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel, headless: true }), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage();
    const checks = [], errors = []; page.on('pageerror', e => errors.push(e.message));
    const check = async (name, action) => { await action(); checks.push(name); console.log('PASS ' + channel + ' · ' + name); };
    try {
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
      await check('нулевые счётчики доступны, пустые места открываются без ошибок', async () => {
        assert.equal(await page.locator('[data-stat=destinations] strong').textContent(), '0'); await page.locator('[data-stat=destinations]').click(); assert.equal(await page.getByRole('heading', { name: 'Мест по активным задачам пока нет' }).count(), 1); await page.locator('#modal .modal-footer button').click();
      });
      await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: C.KEY, state }); await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
      const raw = await page.evaluate(key => localStorage.getItem(key), C.KEY);
      await check('счётчик мест исключает завершённые и неиспользуемые учреждения', async () => {
        assert.equal(await page.locator('[data-stat=active] strong').textContent(), '2'); assert.equal(await page.locator('[data-stat=completed] strong').textContent(), '1'); assert.equal(await page.locator('[data-stat=destinations] strong').textContent(), '1'); assert.match(await page.locator('[data-stat=destinations]').textContent(), /Мест назначения по активным задачам/);
      });
      await check('активные и выполненные плашки открывают данные и сбрасывают старые фильтры', async () => {
        await page.locator('#search').fill('несуществующее'); await page.locator('#filter-priority').selectOption('urgent'); await page.locator('[data-stat=active]').click(); assert.equal(await page.locator('.task-card').count(), 2); assert.equal(await page.locator('#search').inputValue(), ''); assert.equal(await page.locator('#filter-priority').inputValue(), '');
        await page.locator('[data-stat=completed]').click(); assert.equal(await page.locator('.task-card').count(), 1); assert.equal(await page.locator('.task-card').getAttribute('data-task-id'), 'TASK-000003');
      });
      await check('места показывают активный суд и ведут к его задачам', async () => {
        await page.locator('[data-stat=destinations]').click(); assert.equal(await page.locator('[data-active-destination]').count(), 1); assert.equal(await page.getByRole('heading', { name: 'Суд А', exact: true }).count(), 1); assert.equal(await page.getByRole('heading', { name: 'ОСП Б', exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Показать задачи · 2', exact: true }).click(); assert.equal(await page.locator('#modal').evaluate(e => e.open), false); assert.equal(await page.locator('#task-list .task-card').count(), 2); assert.equal(await page.locator('#filter-destination').inputValue(), state.tasks[0].source.destinationId);
      });
      await check('клавиатура и узкий экран; просмотр не изменяет сохранённые данные', async () => {
        await page.locator('[data-stat=completed]').focus(); await page.keyboard.press('Enter'); assert.equal(await page.locator('#task-list .task-card').count(), 1); await page.setViewportSize({ width: 360, height: 800 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.equal(await page.evaluate(key => localStorage.getItem(key), C.KEY), raw); assert.deepEqual(errors, []);
      });
      results.push({ channel, version: await browser.version(), checks, errors });
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(__dirname, 'stats-browser-results.json'), JSON.stringify({ results }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
