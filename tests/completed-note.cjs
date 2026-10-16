'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/iphone-check.json'), 'utf8'));
const url = 'https://court-trip-planner-7c4a.okterskikh.chatgpt.site/';
(async () => {
  const report = [];
  for (const channel of ['chrome', 'msedge']) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-note-'));
    let context;
    const errors = [], note = 'Проверка выполненной задачи\nКабинет 25 · заметка после обновления';
    const completed = fixture.tasks.find(t => t.result.outcome === 'completed');
    const launch = () => chromium.launchPersistentContext(profile, { channel, headless: true, viewport: { width: 390, height: 844 } });
    const show = async page => {
      await page.getByRole('button', { name: 'Задачи', exact: true }).click();
      await page.getByRole('button', { name: 'Выполненные', exact: true }).click();
      return page.locator('#task-list [data-task-id="' + completed.id + '"]');
    };
    try {
      context = await launch(); let page = context.pages()[0]; page.on('pageerror', e => errors.push(e.message));
      assert.deepEqual(await context.cookies(), []);
      await page.goto(url); await page.getByRole('button', { name: 'Обмен данными', exact: true }).click();
      assert.equal(new URL(page.url()).origin, new URL(url).origin);
      await page.getByRole('button', { name: 'Восстановить JSON', exact: true }).click();
      await page.locator('#json-file').setInputFiles({ name: 'check.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
      await page.locator('#restore-confirm').check(); await page.locator('#restore-apply').click();
      let card = await show(page);
      await card.getByRole('button', { name: /Добавить заметку|Изменить заметку/ }).click();
      await page.locator('#note-text').fill(note); await page.getByRole('button', { name: 'Сохранить заметку', exact: true }).click();
      assert((await card.locator('.local-note').textContent()).includes(note));
      await page.reload(); card = await show(page);
      assert((await card.locator('.local-note').textContent()).includes(note));
      await context.close(); context = await launch(); page = context.pages()[0];
      page.on('pageerror', e => errors.push(e.message)); await page.goto(url); card = await show(page);
      assert((await card.locator('.local-note').textContent()).includes(note));
      await card.getByRole('button', { name: 'Изменить заметку', exact: true }).click();
      assert.equal(await page.locator('#note-text').inputValue(), note);
      assert.deepEqual(errors, []);
      report.push({ channel, version: context.browser().version(), anonymousAccess: true, completedNoteSave: true, reload: true, browserRestart: true, reopenEditor: true, physicalIPhone: false, errors });
      console.log('PASS ' + channel);
    } finally { if (context) await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
  }
  fs.writeFileSync(path.join(__dirname, 'completed-note-results.json'), JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
