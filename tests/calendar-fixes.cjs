'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js'), sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/iphone-check.json'), 'utf8'));
const date = '2026-10-16', url = process.env.PLANNER_TEST_URL || 'http://127.0.0.1:4173/';
function seed() {
  let s = C.clone(sample); const active = s.tasks.filter(t => C.status(t) !== 'completed');
  for (const t of active) { t.source.createdBy = 'Постановщик тестового поручения'; t.source.createdDate = '2026-10-01'; t.source.destinationId = active[0].source.destinationId; t.localPriority = 'urgent'; t.localNote = 'Окно 3'; t.documentsReady = true; }
  s = C.planTasks(s, active.map(t => t.id), date, { today: date });
  const future = C.clone(s.tasks[0]); future.id = 'FUTURE'; future.plannedDate = '2026-10-19'; s.tasks.push(future);
  return C.validateState(s);
}
(async () => {
  const results = [];
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel, headless: true }), page = await browser.newPage({ viewport: { width: 1366, height: 768 } }), errors = [], checks = [];
    page.on('pageerror', e => errors.push(e.message)); await page.clock.install({ time: new Date(date + 'T09:00:00Z') });
    const initial = seed(), ids = initial.tasks.filter(t => t.plannedDate === date && C.status(t) !== 'completed').map(t => t.id);
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('tripPlanner.state.v1')));
    const card = id => page.locator('[data-trip-task="' + id + '"]');
    const reset = async () => { await page.evaluate(s => localStorage.setItem('tripPlanner.state.v1', JSON.stringify(s)), initial); await page.reload(); };
    const day = async () => { await page.getByRole('button', { name: 'День', exact: true }).click(); await page.locator('.trip-tasks>summary').click(); };
    const undo = () => page.getByRole('button', { name: 'Отменить действие', exact: true }).click();
    const drop = async payload => page.locator('.calendar-backlog').evaluate((node, payload) => { const dt = new DataTransfer(); dt.setData('application/x-planner', JSON.stringify(payload)); node.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }, payload);
    try {
      await page.goto(url); await reset(); await day();
      assert.match(await card(ids[0]).textContent(), /Постановщик: Постановщик тестового поручения/); assert.match(await card(ids[0]).textContent(), /Дата постановки: 01.10.2026/); assert.equal(await card(ids[0]).locator('.badge.planned').textContent(), 'Запланирована'); checks.push('day metadata');
      for (const width of [1366, 991, 390]) {
        await page.setViewportSize({ width, height: 844 });
        assert(await card(ids[0]).evaluate(node => {
          const bounds = node.getBoundingClientRect();
          return [...node.querySelectorAll('select,input,button,.field label')].every(el => { const r = el.getBoundingClientRect(); return r.left >= bounds.left + 6 && r.right <= bounds.right - 6; });
        }));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      checks.push('day control bounds at 1366/991/390');
      await page.setViewportSize({ width: 991, height: 768 }); await page.getByRole('button', { name: 'Неделя', exact: true }).click(); await page.locator('[data-day="' + date + '"] .trip-tasks>summary').click();
      assert(await card(ids[0]).evaluate(node => { const r = node.getBoundingClientRect(); return [...node.querySelectorAll('select,input,button')].every(n => { const b = n.getBoundingClientRect(); return b.left >= r.left + 6 && b.right <= r.right - 6; }); }));
      await page.screenshot({ path: path.join(__dirname, 'calendar-fixes-' + channel + '.png'), fullPage: true }); checks.push('week compact card bounds');
      await card(ids[0]).getByRole('button', { name: 'Снять дату', exact: true }).click(); assert.equal((await read()).tasks.find(t => t.id === ids[0]).plannedDate, null); await undo(); assert.equal((await read()).tasks.find(t => t.id === ids[0]).plannedDate, date); checks.push('single button and undo');
      await page.locator('[data-day="' + date + '"] .trip-card').getByRole('button', { name: 'Снять дату поездки', exact: true }).click(); assert((await read()).tasks.filter(t => ids.includes(t.id)).every(t => t.plannedDate === null)); await undo(); checks.push('trip button and undo');
      await page.setViewportSize({ width: 1366, height: 768 }); await day();
      await card(ids[0]).locator('.drag-handle').dragTo(page.locator('.backlog-title'));
      let saved = await read(); assert.equal(saved.tasks.find(t => t.id === ids[0]).plannedDate, null); assert.equal(saved.tasks.find(t => t.id === ids[1]).plannedDate, date); await page.reload(); assert.equal((await read()).tasks.find(t => t.id === ids[0]).plannedDate, null); await day(); checks.push('native drag single and reload');
      await drop({ type: 'trip', ids: [ids[1]], date, destinationId: initial.tasks[0].source.destinationId });
      assert.equal(await page.locator('.day-plan .trip-card').count(), 0); assert.equal(await page.locator('.calendar-backlog.drop-ready').count(), 0); await undo(); assert.equal((await read()).tasks.find(t => t.id === ids[1]).plannedDate, date); checks.push('empty trip disappears and undo');
      await reset(); await page.locator('.trip-card[data-trip-date="' + date + '"] > .button-row .drag-handle').dragTo(page.locator('.backlog-title')); saved = await read();
      for (const id of ids) { const t = saved.tasks.find(t => t.id === id); assert.equal(t.plannedDate, null); assert.equal(t.documentsReady, true); assert.equal(t.localNote, 'Окно 3'); assert.equal(t.localPriority, 'urgent'); assert(t.history.some(h => h.type === 'unplan')); }
      assert.deepEqual(saved.tasks.find(t => t.id === 'FUTURE'), initial.tasks.find(t => t.id === 'FUTURE'));
      assert.deepEqual(saved.tasks.find(t => t.result.outcome === 'completed'), initial.tasks.find(t => t.result.outcome === 'completed')); await undo(); checks.push('trip drop preserves data and other tasks');
      const before = await read(), done = before.tasks.find(t => t.result.outcome === 'completed'); await drop({ type: 'tasks', ids: [ids[0], done.id] }); assert.deepEqual(await read(), before); checks.push('completed task rejects entire drop');
      await page.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; }); await drop({ type: 'tasks', ids: [ids[0]] }); assert.deepEqual(await read(), before); assert(await page.getByRole('button', { name: 'Скачать несохранённые изменения', exact: true }).isVisible()); checks.push('write failure retains saved data');
      assert.deepEqual(errors, []); results.push({ channel, version: browser.version(), url, checks, errors }); console.log('PASS ' + channel + ' · ' + checks.length + ' checks');
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(__dirname, 'calendar-fixes-results.json'), JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
