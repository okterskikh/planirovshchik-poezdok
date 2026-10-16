'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
    let state = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/iphone-check.json'), 'utf8'));
    const task = state.tasks.find(t => t.result.outcome === 'none');
    task.source.createdBy = 'Постановщик для проверки'; task.source.createdDate = '2026-10-01';
    state = C.planTasks(state, [task.id], C.today(), { allowNonWorking: true });
    await page.evaluate(s => localStorage.setItem('tripPlanner.state.v1', JSON.stringify(s)), state); await page.reload();
    await page.getByRole('button', { name: 'День', exact: true }).click();
    const card = page.locator('[data-trip-task="' + task.id + '"]'), text = await card.textContent();
    const day = { creatorVisible: text.includes(task.source.createdBy), createdDateVisible: text.includes('01.10.2026'), explicitStatusVisible: text.includes(C.STATUSES[C.status(state.tasks.find(t => t.id === task.id))]) };
    const payload = { type: 'tasks', ids: [task.id] };
    await page.locator('.calendar-backlog').evaluate((element, payload) => {
      const dt = new DataTransfer(); dt.setData('application/x-planner', JSON.stringify(payload));
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, payload);
    const stillScheduled = await page.evaluate(id => JSON.parse(localStorage.getItem('tripPlanner.state.v1')).tasks.find(t => t.id === id).plannedDate, task.id);
    await page.getByRole('button', { name: 'Обмен данными', exact: true }).click();
    const exchangeText = await page.locator('#main').textContent();
    const assets = {};
    for (const file of ['index.html', 'style.css', 'script.js']) {
      const response = await page.request.get('https://court-trip-planner-7c4a.okterskikh.chatgpt.site/' + file);
      assert.equal(response.status(), 200);
      const hosted = await response.text(), local = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      const normalize = text => text.replace(/\r\n/g, '\n');
      assets[file] = { hostedMatchesLocal: hosted === local, matchesIgnoringLineEndings: normalize(hosted) === normalize(local), publicationMatchesLocal: fs.readFileSync(path.join(__dirname, '../site-publication/dist', file)).equals(fs.readFileSync(path.join(__dirname, '..', file))) };
      if (normalize(hosted) !== normalize(local)) { let i = 0; while (i < Math.min(hosted.length, local.length) && hosted[i] === local[i]) i++; console.log(file + ' difference: ' + JSON.stringify({ position: i, hosted: hosted.slice(Math.max(0, i - 40), i + 180), local: local.slice(Math.max(0, i - 40), i + 180) })); }
    }
    assert.deepEqual(errors, []);
    const report = { date: '2026-10-16', browser: browser.version(), day, dropOnBacklogClearsDate: stillScheduled === null, mergeExplicitlyUnavailable: exchangeText.includes('объединение копий пока не поддерживается'), assets, errors };
    fs.writeFileSync(path.join(__dirname, 'tz-audit-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
