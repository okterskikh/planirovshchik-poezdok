'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js'), sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/iphone-check.json'), 'utf8'));
const url = process.env.PLANNER_TEST_URL || 'https://court-trip-planner-7c4a.okterskikh.chatgpt.site/';
const start = '2026-10-19', target = '2026-10-20';
(async () => {
  const results = [];
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel, headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], checks = [];
    page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message)); await page.clock.install({ time: new Date(start + 'T09:00:00Z') });
    let initial = C.clone(sample); const ids = initial.tasks.filter(t => t.result.outcome === 'none').map(t => t.id); initial = C.planTasks(initial, ids, start, { today: start });
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('tripPlanner.state.v1')));
    const reset = async state => { await page.evaluate(s => localStorage.setItem('tripPlanner.state.v1', JSON.stringify(s)), state || initial); await page.reload(); };
    const day = date => page.locator('[data-day="' + date + '"]');
    const openTasks = () => day(start).locator('.trip-tasks>summary').click();
    const task = id => page.locator('[data-trip-task="' + id + '"]');
    const drag = async (source, destination) => {
      await source.scrollIntoViewIfNeeded(); const from = await source.boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 6 });
      await destination.scrollIntoViewIfNeeded(); const to = await destination.boundingBox();
      await page.mouse.move(to.x + 20, to.y + 20, { steps: 15 }); await page.mouse.up();
    };
    const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + channel + ' · ' + name); };
    try {
      await page.goto(url); await reset();
      await check('перенос задачи за текст карточки между днями недели', async () => {
        await openTasks();
        await page.evaluate(() => { window.dragAudit = []; for (const type of ['dragstart', 'drop', 'dragend']) document.addEventListener(type, e => window.dragAudit.push({ type, target: e.target.className, id: e.target.dataset.tripTask || e.target.dataset.tripDate, data: e.dataTransfer.getData('application/x-planner') }), true); });
        await drag(task(ids[0]).locator(':scope > strong'), day(target).locator('.day-heading'));
        if ((await read()).tasks.find(t => t.id === ids[0]).plannedDate !== target) console.log(JSON.stringify(await page.evaluate(() => ({ events: window.dragAudit, toast: document.querySelector('#toast').textContent, taskDraggable: document.querySelector('.trip-task').draggable })), null, 2));
        const state = await read(); assert.equal(state.tasks.find(t => t.id === ids[0]).plannedDate, target); assert.equal(state.tasks.find(t => t.id === ids[1]).plannedDate, start);
        await page.reload(); assert.equal((await read()).tasks.find(t => t.id === ids[0]).plannedDate, target);
      });
      await check('перенос всей поездки за название суда', async () => {
        await reset(); await drag(day(start).locator('.trip-heading strong'), day(target).locator('.day-heading')); assert((await read()).tasks.filter(t => ids.includes(t.id)).every(t => t.plannedDate === target));
        await page.getByRole('button', { name: 'Отменить действие', exact: true }).click(); assert((await read()).tasks.filter(t => ids.includes(t.id)).every(t => t.plannedDate === start));
      });
      await check('вложенная задача не захватывает всю поездку при броске на другой суд', async () => {
        const s = C.clone(initial), extra = C.clone(s.tasks[0]); extra.id = 'OTHER'; extra.source.destinationId = s.destinations.find(p => p.id !== extra.source.destinationId).id; extra.plannedDate = extra.firstPlannedDate = target; s.tasks.push(extra); await reset(s); await openTasks();
        await drag(task(ids[0]).locator(':scope > strong'), day(target).locator('.trip-heading strong')); const state = await read(); assert.equal(state.tasks.find(t => t.id === ids[0]).plannedDate, target); assert.equal(state.tasks.find(t => t.id === ids[1]).plannedDate, start); assert.equal(state.tasks.find(t => t.id === 'OTHER').plannedDate, target);
      });
      await check('выходной требует подтверждения, отказ не переносит', async () => {
        await reset(); await drag(day(start).locator('.trip-heading strong'), day('2026-10-24').locator('.day-heading')); assert(await page.locator('#schedule-consent').isVisible()); assert((await read()).tasks.filter(t => ids.includes(t.id)).every(t => t.plannedDate === start));
        await page.locator('dialog').getByRole('button', { name: 'Отмена', exact: true }).click(); assert((await read()).tasks.filter(t => ids.includes(t.id)).every(t => t.plannedDate === start));
      });
      await check('кнопки и поля внутри перетаскиваемой карточки работают', async () => {
        await reset(); await openTasks(); await task(ids[0]).getByRole('checkbox', { name: 'Документы готовы', exact: true }).click(); assert.equal((await read()).tasks.find(t => t.id === ids[0]).documentsReady, true);
        await openTasks(); await task(ids[0]).getByRole('button', { name: 'Перенести задачу', exact: true }).click(); await page.locator('#schedule-date').fill(target); await page.getByRole('button', { name: 'Сохранить дату', exact: true }).click(); assert.equal((await read()).tasks.find(t => t.id === ids[0]).plannedDate, target);
      });
      assert.deepEqual(errors, []); results.push({ channel, version: browser.version(), url, checks, errors });
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(__dirname, 'week-card-drag-results.json'), JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
