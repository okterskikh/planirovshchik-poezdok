'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js');
const records = C.parseCSV(fs.readFileSync(path.join(__dirname, 'fixtures/tasks.csv'), 'utf8'));
const rows = C.mappedRows(records, 0, C.mappingFor(records[0].cells, 'tasks'));
function seed() {
  let s = C.buildImport(C.emptyState(), rows).state;
  s.tasks[0].source.priority = 'normal'; s.tasks[1].source.priority = 'normal';
  s = C.planTasks(s, [s.tasks[0].id, s.tasks[1].id], '2026-10-16', { today: '2026-10-15' });
  const other = C.clone(s.tasks[0]); other.id = 'OTHER-DAY'; other.plannedDate = '2026-10-19'; s.tasks.push(other);
  const court = C.clone(s.tasks[0]); court.id = 'OTHER-COURT'; court.source.destinationId = s.destinations.find(p => p.id !== other.source.destinationId).id; court.source.priority = 'high'; s.tasks.push(court);
  C.validateState(s); return s;
}
(async () => {
  const s = seed(), ids = s.tasks.slice(0, 2).map(t => t.id), changed = C.setTaskPriority(s, [ids[0]], 'urgent');
  assert.equal(s.tasks[0].localPriority, undefined); assert.equal(changed.tasks[0].source.priority, 'normal');
  assert.equal(C.effectivePriority(changed.tasks[0]), 'urgent'); assert.equal(C.trips(changed, '2026-10-16')[0].destination.id, s.tasks[0].source.destinationId);
  assert.equal(C.filterTasks(changed, { priority: 'urgent', view: 'active' }).length, 1);
  const updated = C.buildImport(changed, rows).state; assert.equal(updated.tasks[0].localPriority, 'urgent');
  const reset = C.setTaskPriority(updated, [ids[0]], null); assert.equal(C.effectivePriority(reset.tasks[0]), reset.tasks[0].source.priority);
  const grouped = C.setTaskPriority(s, ids, 'high'); assert.equal(grouped.tasks[1].localPriority, 'high'); assert.equal(grouped.tasks.find(t => t.id === 'OTHER-DAY').localPriority, undefined);
  assert.equal(C.validateState(JSON.parse(JSON.stringify(grouped))).tasks[0].localPriority, 'high');
  assert.throws(() => C.setTaskPriority(s, [s.tasks[2].id], 'high')); assert.throws(() => C.setTaskPriority(s, ids, 'wrong'));
  const bad = C.clone(s); bad.tasks[0].localPriority = 'wrong'; assert.throws(() => C.validateState(bad));
  console.log('PASS core: изоляция, приоритет и фильтр, сортировка, импорт и сброс, группа, JSON, валидация');
  const results = [];
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], checks = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-10-15T09:00:00Z') });
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('tripPlanner.state.v1')));
    const check = async (name, action) => { await action(); checks.push(name); console.log('PASS ' + channel + ': ' + name); };
    try {
      await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
      await page.evaluate(s => localStorage.setItem('tripPlanner.state.v1', JSON.stringify(s)), s); await page.reload();
      await page.getByRole('button', { name: 'Задачи', exact: true }).click();
      await page.getByRole('button', { name: 'Активные', exact: true }).click();
      const card = page.locator('[data-task-id="' + ids[0] + '"]');
      await check('приоритет одной задачи, цвет и сохранение', async () => {
        await card.getByLabel('Приоритет задачи', { exact: true }).selectOption('urgent');
        assert.match(await card.getAttribute('class'), /priority-urgent/); assert.equal((await read()).tasks[0].source.priority, 'normal');
        await page.reload(); await page.getByRole('button', { name: 'Задачи', exact: true }).click();
        await page.getByRole('button', { name: 'Активные', exact: true }).click();
        assert.equal(await card.getByLabel('Приоритет задачи', { exact: true }).inputValue(), 'urgent');
        await card.getByLabel('Приоритет задачи', { exact: true }).selectOption('high'); assert.match(await card.getAttribute('class'), /priority-high/);
        await page.screenshot({ path: path.join(__dirname, 'priority-' + channel + '.png'), fullPage: true });
      });
      await check('приоритет всему суду только на выбранный день', async () => {
        await page.getByRole('button', { name: 'День', exact: true }).click(); await page.locator('#calendar-date').fill('2026-10-16');
        const court = page.locator('[data-trip-id="' + s.tasks[0].source.destinationId + '"]');
        await court.getByLabel('Приоритет суда на этот день', { exact: true }).selectOption('urgent');
        const stored = await read(); assert.equal(stored.tasks[0].localPriority, 'urgent'); assert.equal(stored.tasks[1].localPriority, 'urgent'); assert.equal(stored.tasks.find(t => t.id === 'OTHER-DAY').localPriority, undefined);
        assert.match(await court.getAttribute('class'), /priority-urgent/); assert.equal(await page.locator('.trip-card').first().getAttribute('data-trip-id'), s.tasks[0].source.destinationId);
      });
      await check('отдельная задача внутри суда и возврат к таблице', async () => {
        const court = page.locator('[data-trip-id="' + s.tasks[0].source.destinationId + '"]');
        await court.locator('details').evaluate(e => e.open = true);
        await court.locator('[data-trip-task="' + ids[0] + '"]').getByLabel('Приоритет задачи', { exact: true }).selectOption('normal');
        assert.equal((await read()).tasks[1].localPriority, 'urgent');
        await court.getByLabel('Приоритет суда на этот день', { exact: true }).selectOption('source');
        assert.equal((await read()).tasks[0].localPriority, null); assert.equal((await read()).tasks[1].localPriority, null);
        assert.match(await court.getAttribute('class'), /priority-normal/);
      });
      await check('узкая компоновка и история', async () => {
        await page.setViewportSize({ width: 360, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert((await read()).tasks[0].history.some(h => h.type === 'local-priority')); assert.deepEqual(errors, []);
      });
      results.push({ channel, version: browser.version(), checks, errors });
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(__dirname, 'priority-results.json'), JSON.stringify({ core: 'passed', results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
