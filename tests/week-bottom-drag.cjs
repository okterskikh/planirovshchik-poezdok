'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js'), sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/iphone-check.json'), 'utf8'));
const url = process.env.PLANNER_TEST_URL || 'https://court-trip-planner-7c4a.okterskikh.chatgpt.site/';
const monday = '2026-10-19', tuesday = '2026-10-20';
function seed() {
  const s = C.clone(sample), template = C.clone(s.tasks[0]); s.tasks = s.tasks.filter(t => t.result.outcome === 'completed'); s.dayOrders = { [monday]: [] };
  for (let i = 0; i < 12; i++) {
    const id = 'court-' + i; s.destinations.push({ id, name: 'Тестовый суд ' + i, metro: '', address: '', location: '', aliases: [] });
    const t = C.clone(template); t.id = 'LONG-' + i; t.source.destinationId = id; t.source.client = 'Клиент ' + i; t.source.priority = 'normal'; t.plannedDate = t.firstPlannedDate = monday; t.localNote = 'Окно 3'; t.documentsReady = true; t.history = []; s.tasks.push(t); s.dayOrders[monday].push(id);
  }
  return C.validateState(s);
}
(async () => {
  const results = [];
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel, headless: true }), page = await browser.newPage({ viewport: { width: 1366, height: 768 } }), errors = [], checks = [];
    await page.clock.install({ time: new Date(monday + 'T09:00:00Z') }); page.on('pageerror', e => errors.push(e.message));
    const initial = seed(), read = () => page.evaluate(() => JSON.parse(localStorage.getItem('tripPlanner.state.v1')));
    const reset = async state => { await page.evaluate(s => localStorage.setItem('tripPlanner.state.v1', JSON.stringify(s)), state || initial); await page.reload(); };
    const court = () => page.locator('[data-trip-id="court-11"]');
    const begin = async source => {
      await source.scrollIntoViewIfNeeded(); const box = await source.boundingBox(); const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 12, y + 12, { steps: 6 }); return { x, y };
    };
    const sameHeight = async source => {
      const { y } = await begin(source); const target = await page.locator('[data-day="' + tuesday + '"]').boundingBox();
      // После начала захвата не прокручивать страницу и не искать верх колонки.
      await page.mouse.move(target.x + target.width / 2, y, { steps: 16 }); await page.mouse.up();
    };
    const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + channel + ' · ' + name); };
    try {
      await page.goto(url); await reset();
      await check('последний из 12 судов переносится за название на той же высоте', async () => {
        await sameHeight(court().locator('.trip-heading strong')); assert.equal((await read()).tasks.find(t => t.id === 'LONG-11').plannedDate, tuesday);
        assert((await read()).tasks.filter(t => /^LONG-/.test(t.id) && t.id !== 'LONG-11').every(t => t.plannedDate === monday));
        await page.reload(); assert.equal((await read()).tasks.find(t => t.id === 'LONG-11').plannedDate, tuesday);
      });
      await check('нижняя стрелка суда переносит карточку без подъёма страницы', async () => { await reset(); await sameHeight(court().locator(':scope > .button-row .drag-handle')); assert.equal((await read()).tasks.find(t => t.id === 'LONG-11').plannedDate, tuesday); });
      await check('нижняя вложенная задача переносится в пустой день', async () => {
        await reset(); await court().locator('.trip-tasks>summary').click(); await sameHeight(court().locator('.trip-task>strong')); const t = (await read()).tasks.find(t => t.id === 'LONG-11'); assert.equal(t.plannedDate, tuesday); assert.equal(t.localNote, 'Окно 3'); assert.equal(t.documentsReady, true);
      });
      await check('закреплённые даты видны при захвате снизу и принимают перенос', async () => {
        await reset(); const before = await begin(court().locator('.trip-heading strong'));
        const bar = page.locator('.week-transfer-bar'); assert(await bar.locator('.week-transfer-inner').isVisible()); const target = page.locator('[data-transfer-day="2026-10-21"]'); const box = await target.boundingBox(); assert(box.y >= 0 && box.y + box.height <= 768);
        await page.screenshot({ path: path.join(__dirname, 'week-bottom-drag-' + channel + '.png') });
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 }); await page.mouse.up(); assert.equal((await read()).tasks.find(t => t.id === 'LONG-11').plannedDate, '2026-10-21'); assert.equal(await page.locator('.week-transfer-inner').isVisible(), false);
        assert(before.y > 0);
      });
      await check('отмена перетаскивания скрывает даты и не меняет данные', async () => {
        await reset(); const before = await read(); await begin(court().locator('.trip-heading strong')); await page.keyboard.press('Escape'); await page.mouse.up(); assert.equal(await page.locator('.week-transfer-inner').isVisible(), false); assert.deepEqual(await read(), before);
      });
      const releaseOnDate = async date => {
        const box = await page.locator('[data-transfer-day="' + date + '"]').boundingBox(); assert(box.y >= 0 && box.y + box.height <= page.viewportSize().height);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 }); await page.mouse.up();
      };
      await check('нижняя задача переносится захватом на понедельник следующей недели', async () => {
        await reset(); await court().locator('.trip-tasks>summary').click(); await begin(court().locator('.trip-task>strong')); assert.equal(await page.locator('[data-transfer-day]').count(), 14); await releaseOnDate('2026-10-26');
        const state = await read(), t = state.tasks.find(t => t.id === 'LONG-11'); assert.equal(t.plannedDate, '2026-10-26'); assert.equal(t.firstPlannedDate, monday); assert.equal(t.localNote, 'Окно 3'); assert(state.tasks.filter(t => /^LONG-/.test(t.id) && t.id !== 'LONG-11').every(t => t.plannedDate === monday));
        await page.reload(); assert.equal((await read()).tasks.find(t => t.id === 'LONG-11').plannedDate, '2026-10-26');
      });
      await check('нижняя поездка переносит обе задачи на следующую неделю и объединяется с существующей', async () => {
        const s = C.clone(initial), buddy = C.clone(s.tasks.find(t => t.id === 'LONG-11')); buddy.id = 'BUDDY'; s.tasks.push(buddy);
        const existing = C.clone(buddy); existing.id = 'EXISTING'; existing.plannedDate = '2026-10-28'; s.tasks.push(existing); await reset(s);
        await begin(court().locator('.trip-heading strong'));
        await releaseOnDate('2026-10-28'); const state = await read(); assert(state.tasks.filter(t => ['LONG-11', 'BUDDY', 'EXISTING'].includes(t.id)).every(t => t.plannedDate === '2026-10-28'));
        assert.equal(C.trips(state, '2026-10-28').filter(t => t.destination.id === 'court-11').length, 1);
      });
      await check('выходной следующей недели требует подтверждения', async () => {
        await reset(); await begin(court().locator('.trip-heading strong')); await releaseOnDate('2026-10-31'); assert.equal(await page.locator('#schedule-date').inputValue(), '2026-10-31');
        await page.getByRole('button', { name: 'Сохранить дату', exact: true }).click(); assert.equal((await read()).tasks.find(t => t.id === 'LONG-11').plannedDate, monday);
        await page.locator('#schedule-consent').check(); await page.getByRole('button', { name: 'Сохранить дату', exact: true }).click(); assert.equal((await read()).tasks.find(t => t.id === 'LONG-11').plannedDate, '2026-10-31');
      });
      await check('перенос захватом на следующую неделю через границу года', async () => {
        const s = C.clone(initial); for (const t of s.tasks.filter(t => /^LONG-/.test(t.id))) t.plannedDate = '2026-12-28'; s.dayOrders['2026-12-28'] = s.dayOrders[monday]; delete s.dayOrders[monday];
        await reset(s); await page.locator('#calendar-date').fill('2026-12-28'); await begin(court().locator('.trip-heading strong')); await releaseOnDate('2027-01-04'); assert.equal((await read()).tasks.find(t => t.id === 'LONG-11').plannedDate, '2027-01-04');
      });
      await check('даты следующей недели доступны на ноутбуке 1280×720', async () => {
        await page.setViewportSize({ width: 1280, height: 720 }); await reset(); await begin(court().locator('.trip-heading strong'));
        const last = await page.locator('[data-transfer-day="2026-11-01"]').boundingBox(); assert(last.y >= 0 && last.y + last.height <= 720); await releaseOnDate('2026-10-26'); assert.equal((await read()).tasks.find(t => t.id === 'LONG-11').plannedDate, '2026-10-26');
      });
      assert.deepEqual(errors, []); results.push({ channel, version: browser.version(), url, checks, errors });
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(__dirname, 'week-bottom-drag-results.json'), JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
