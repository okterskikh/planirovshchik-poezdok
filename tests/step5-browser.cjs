'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js'), fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/iphone-check.json'), 'utf8'));
const url = process.env.PLANNER_TEST_URL || 'http://127.0.0.1:4173/';
(async () => {
  const results = [];
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel, headless: true }), page = await browser.newPage({ viewport: { width: 1366, height: 900 }, acceptDownloads: true }), checks = [], errors = [];
    page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message)); await page.clock.install({ time: new Date('2026-10-16T09:00:00Z') });
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('tripPlanner.state.v1')));
    const local = C.clone(fixture); local.tasks[0].localNote = 'Заметка компьютера';
    const reset = async state => { await page.evaluate(s => localStorage.setItem('tripPlanner.state.v1', JSON.stringify(s)), state); await page.reload(); await page.getByRole('button', { name: 'Обмен данными', exact: true }).click(); };
    const open = () => page.getByRole('button', { name: 'Объединить JSON', exact: true }).click();
    const load = async state => {
      await page.locator('#merge-file').setInputFiles({ name: 'copy', mimeType: 'application/octet-stream', buffer: Buffer.from(typeof state === 'string' ? state : JSON.stringify(state)) });
      await page.waitForFunction(() => document.querySelector('#merge-preview').textContent || document.querySelector('#merge-error').textContent);
    };
    const select = async side => { for (const row of await page.locator('.merge-conflict').all()) { await row.evaluate(el => { el.open = true; }); const key = JSON.parse(await row.getAttribute('data-merge-key')); await row.locator('input[value="' + (typeof side === 'function' ? side(key) : side) + '"]').check(); } };
    const review = () => page.getByRole('button', { name: 'Проверить объединение', exact: true }).click();
    const apply = async () => { await page.locator('#merge-confirm').check(); await page.locator('#merge-apply').click(); };
    const cancel = () => page.locator('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
    const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + channel + ' · ' + name); };
    try {
      await page.goto(url); await reset(local);
      await check('выбор файла без accept; неверный JSON, схема и область не меняют данные', async () => {
        await open(); assert.equal(await page.locator('#merge-file').getAttribute('accept'), null); const before = await read();
        for (const value of ['not JSON', { ...local, schemaVersion: 999 }, { ...local, workspaceId: 'another' }]) { await load(value); assert(await page.locator('#merge-error').textContent()); assert(await page.locator('#merge-apply').isDisabled()); assert.deepEqual(await read(), before); }
        await cancel();
      });
      await check('идентичная копия требует подтверждения и не записывается повторно', async () => {
        await open(); await load(local); const before = await read(); assert.equal(await page.locator('.merge-conflict').count(), 0); await page.locator('#merge-apply').click(); assert.match(await page.locator('#merge-error').textContent(), /подтвердите/); assert.deepEqual(await read(), before); await apply(); assert.deepEqual(await read(), before);
      });
      const other = C.clone(local), t = other.tasks[0];
      t.source.description = 'Поручение с телефона'; t.plannedDate = t.firstPlannedDate = '2026-10-19'; t.documentsReady = true; t.localNote = 'Заметка телефона'; t.localPriority = 'urgent'; t.result = { outcome: 'completed', date: '2026-10-16', comment: 'Исполнено на телефоне' };
      t.history.push({ id: 'phone-event', type: 'completed', at: '2026-10-16T08:00:00Z', changes: { after: t.result } });
      const added = C.clone(other.tasks[1]); added.id = 'NEW-PHONE'; other.tasks.push(added);
      await check('шесть групп, смешанный выбор, новые задачи и предварительная копия', async () => {
        await open(); const before = await read(), download = page.waitForEvent('download'); await page.locator('dialog').getByRole('button', { name: 'Скачать текущую копию', exact: true }).click(); const file = await download; assert.deepEqual(JSON.parse(fs.readFileSync(await file.path(), 'utf8')), before);
        await load(other); assert.equal(await page.locator('[data-merge-kind="task"]').count(), 6); assert(await page.locator('#merge-apply').isDisabled()); assert.deepEqual(await read(), before);
        await select(key => key[2] === 'note' ? 'local' : 'file'); assert(await page.locator('#merge-apply').isDisabled()); await review(); assert.equal(await page.locator('#merge-apply').isDisabled(), false);
        await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: path.join(__dirname, 'step5-mobile-' + channel + '.png'), fullPage: true });
        await apply(); const saved = await read(); assert.equal(saved.tasks[0].localNote, 'Заметка компьютера'); assert.equal(saved.tasks[0].source.description, 'Поручение с телефона'); assert.equal(saved.tasks[0].documentsReady, true); assert.equal(saved.tasks[0].localPriority, 'urgent'); assert.equal(saved.tasks[0].result.outcome, 'completed'); assert.equal(saved.tasks.length, local.tasks.length + 1); assert.equal(saved.tasks[0].history.filter(h => h.id === 'phone-event').length, 1);
        await page.reload(); assert.deepEqual(await read(), saved); await page.getByRole('button', { name: 'Обмен данными', exact: true }).click();
      });
      await check('обратный перенос объединённой копии на телефон сохраняет обе стороны', async () => {
        const combined = await read(); await reset(other); await open(); await load(combined); await select('file'); await review(); await apply(); const saved = await read();
        assert.equal(saved.tasks[0].localNote, 'Заметка компьютера'); assert.equal(saved.tasks[0].result.comment, 'Исполнено на телефоне'); assert.equal(saved.tasks.filter(t => t.id === 'NEW-PHONE').length, 1);
        assert.equal(saved.tasks[0].history.filter(h => h.id === 'phone-event').length, 1);
      });
      await check('повторный обмен не добавляет события или revision', async () => { const before = await read(); await open(); await load(other); await select('local'); await review(); await apply(); assert.deepEqual(await read(), before); });
      await check('новый файл сбрасывает решения; Отмена и Escape не меняют данные', async () => {
        await reset(local); const before = await read(); await open(); await load(other); await select('file'); await load({ ...other, workspaceId: 'different' }); assert(await page.locator('#merge-apply').isDisabled()); await cancel(); assert.deepEqual(await read(), before);
        await open(); await load(other); await select('file'); await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog').evaluate(el => el.open), false); assert.deepEqual(await read(), before);
      });
      await check('справочник и целый порядок дня выбираются отдельно', async () => {
        const a = C.clone(local), b = C.clone(local), [p, q] = a.destinations; a.dayOrders['2026-10-19'] = [p.id, q.id]; b.dayOrders['2026-10-19'] = [q.id, p.id]; b.destinations[0].address = 'Новый адрес';
        await reset(a); await open(); await load(b); assert.equal(await page.locator('[data-merge-kind="place"]').count(), 1); assert.equal(await page.locator('[data-merge-kind="order"]').count(), 1); await select(key => key[0] === 'order' ? 'file' : 'local'); await review(); await apply(); const saved = await read(); assert.deepEqual(saved.dayOrders['2026-10-19'], b.dayOrders['2026-10-19']); assert.equal(saved.destinations[0].address, a.destinations[0].address);
      });
      await check('JSON со вставкой HTML показывается безопасно', async () => {
        await reset(local); const b = C.clone(local); b.tasks[0].localNote = '<img src=x onerror="alert(1)">'; await open(); await load(b); assert.equal(await page.locator('dialog img').count(), 0); await select('file'); await review(); await apply(); assert.equal((await read()).tasks[0].localNote, b.tasks[0].localNote);
      });
      await check('изменение из другой вкладки блокирует применение', async () => {
        await reset(local); await open(); await load(other); await select('file'); await review(); const external = C.clone(local); external.revision += 1; external.tasks[0].localNote = 'Другой вкладки'; await page.evaluate(s => localStorage.setItem('tripPlanner.state.v1', JSON.stringify(s)), external); await apply(); assert.deepEqual(await read(), external); assert.match(await page.locator('#merge-error').textContent(), /другой вкладке/); await cancel();
      });
      await check('ошибка записи оставляет форму, исходное состояние и кандидата', async () => {
        await reset(local); const before = await read(); await open(); await load(other); await select('file'); await review(); await page.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; }); await apply(); assert.deepEqual(await read(), before); assert.equal(await page.locator('dialog').evaluate(el => el.open), true); assert.match(await page.locator('#merge-error').textContent(), /quota/); await cancel(); assert(await page.getByRole('button', { name: 'Скачать несохранённые изменения', exact: true }).isVisible()); await page.reload();
      });
      assert.deepEqual(errors, []); results.push({ channel, version: browser.version(), url, checks, errors, physicalIPhone: false });
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(__dirname, 'step5-browser-results.json'), JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
