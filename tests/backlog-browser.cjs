'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js'), records = C.parseCSV(fs.readFileSync(path.join(__dirname, 'fixtures/tasks.csv'), 'utf8'));
function seed() {
  const s = C.buildImport(C.emptyState(), C.mappedRows(records, 0, C.mappingFor(records[0].cells, 'tasks'))).state;
  const a = s.tasks[0], other = C.clone(a); other.id = 'OTHER-COURT'; other.source.destinationId = s.destinations.find(p => p.id !== a.source.destinationId).id; s.tasks.push(other);
  const planned = C.clone(a); planned.id = 'PLANNED'; planned.plannedDate = '2026-10-19'; s.tasks.push(planned);
  const cancelled = C.clone(a); cancelled.id = 'CANCELLED'; cancelled.result.outcome = 'cancelled'; s.tasks.push(cancelled);
  return C.validateState(s);
}
(async () => {
  const results = [], s = seed(), courtId = s.tasks[0].source.destinationId;
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel, headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const checks = [], errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000);
    await page.clock.install({ time: new Date('2026-10-15T09:00:00Z') });
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('tripPlanner.state.v1')));
    const reset = async view => { await page.evaluate(s => localStorage.setItem('tripPlanner.state.v1', JSON.stringify(s)), s); await page.reload(); await page.getByRole('button', { name: view, exact: true }).click(); };
    const court = () => page.locator('[data-backlog-court="' + courtId + '"]');
    const check = async (name, action) => { await action(); checks.push(name); console.log('PASS ' + channel + ': ' + name); };
    try {
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href); await reset('Неделя');
      await check('группировка только активных незапланированных задач', async () => {
        assert.equal(await page.locator('.backlog-court').count(), 2); assert.equal(await court().locator('[data-backlog-task]').count(), 2);
        assert.match(await page.locator('.calendar-backlog>summary').textContent(), /3.*2/);
        assert.equal(await page.locator('.calendar-backlog [data-backlog-task=PLANNED]').count(), 0);
        assert.equal(await page.locator('.calendar-backlog [data-backlog-task=CANCELLED]').count(), 0);
        await page.screenshot({ path: path.join(__dirname, 'backlog-' + channel + '.png'), fullPage: true });
      });
      await check('перетаскивание всего суда в неделю, объединение и сохранение', async () => {
        await court().locator(':scope > .button-row .drag-handle').dragTo(page.locator('[data-day="2026-10-16"]'));
        let stored = await read(); assert(stored.tasks.slice(0, 2).every(t => t.plannedDate === '2026-10-16')); assert.equal(stored.tasks.find(t => t.id === 'PLANNED').plannedDate, '2026-10-19');
        assert.equal(await court().count(), 0); assert.equal(await page.locator('[data-day="2026-10-16"] .trip-card').count(), 1);
        await page.reload(); stored = await read(); assert(stored.tasks.slice(0, 2).every(t => t.plannedDate === '2026-10-16'));
      });
      await check('отдельная задача из раскрытого суда', async () => {
        await reset('Неделя'); await court().locator('details>summary').click();
        await court().locator('[data-backlog-task=TASK-000001] .drag-handle').dragTo(page.locator('[data-day="2026-10-16"]'));
        const stored = await read(); assert.equal(stored.tasks[1].plannedDate, null); assert.equal(await court().locator('[data-backlog-task]').count(), 1);
        await court().locator(':scope > .button-row .drag-handle').dragTo(page.locator('[data-day="2026-10-16"]'));
        assert.equal(await page.locator('[data-day="2026-10-16"] .trip-card').count(), 1);
      });
      await check('день: групповая кнопка и отмена', async () => {
        await reset('День'); await court().getByRole('button', { name: 'Назначить день всему суду', exact: true }).click();
        await page.locator('#schedule-date').fill('2026-10-16'); await page.getByRole('button', { name: 'Сохранить дату', exact: true }).click();
        assert((await read()).tasks.slice(0, 2).every(t => t.plannedDate === '2026-10-16'));
        await page.getByRole('button', { name: 'Отменить действие', exact: true }).click(); assert((await read()).tasks.slice(0, 2).every(t => t.plannedDate === null));
        await court().locator(':scope > .button-row .drag-handle').dragTo(page.locator('[data-day="2026-10-15"]')); assert((await read()).tasks.slice(0, 2).every(t => t.plannedDate === '2026-10-15'));
      });
      await check('выходной требует согласия и отмена не записывает данные', async () => {
        await reset('Неделя'); const before = await read();
        await court().locator(':scope > .button-row .drag-handle').dragTo(page.locator('[data-day="2026-10-17"]'));
        assert.equal(await page.locator('#schedule-consent').isVisible(), true); assert.deepEqual(await read(), before);
        await page.locator('dialog').getByRole('button', { name: 'Отмена', exact: true }).click(); assert.deepEqual(await read(), before);
      });
      await check('узкий экран и отсутствие ошибок', async () => {
        await page.setViewportSize({ width: 360, height: 900 }); await court().locator('details>summary').click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
      });
      results.push({ channel, version: browser.version(), checks, errors });
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(__dirname, 'backlog-results.json'), JSON.stringify({ results }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
