'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), { performance } = require('node:perf_hooks'), { pathToFileURL } = require('node:url');
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const C = require('../script.js');
function fixture() {
  let s = C.emptyState();
  for (let i = 0; i < 200; i++) s.destinations.push({ id: 'P' + i, name: 'Суд ' + i, address: 'Москва, Тестовая ' + i, metro: 'Тестовая', location: '', aliases: [] });
  for (let i = 0; i < 1000; i++) s.tasks.push({ id: 'TASK-' + i, source: { createdBy: 'Сотрудник', createdDate: '2026-10-01', client: 'Клиент ' + i, documentNumber: String(i).padStart(4,'0'), description: 'Поручение '.repeat(18), destinationId: 'P' + (i % 200), priority: 'normal' }, plannedDate: null, firstPlannedDate: null, documentsReady: false, localNote: 'Заметка '.repeat(10), result: { outcome: 'none', date: null, comment: '' }, lastCsvResult: { outcome: 'none', date: null, comment: '' }, lastConfirmedExportResult: null, history: Array.from({ length: 5 }, (_, n) => ({ id: 'H-' + i + '-' + n, at: '2026-10-01T09:00:00Z', type: 'note', changes: { before: '', after: 'Окно 3' } })) });
  return C.markBackup(C.validateState(s));
}
const median = xs => [...xs].sort((a,b)=>a-b)[2];
module.exports = fixture;
if (require.main === module) (async () => {
  const s = fixture(), csv = [Object.values(C.HEADERS).join(';'), ...s.tasks.map(t => [t.id,t.source.createdBy,'01.10.2026',t.source.client,t.source.documentNumber,s.destinations.find(p=>p.id===t.source.destinationId).name,'Тестовая','Москва, Тестовая '+t.source.destinationId.slice(1),'',t.source.description,'Обычный','Новая','FALSE','',''].map(C.csvCell).join(';'))].join('\r\n');
  const results = [];
  for (const channel of ['chrome','msedge']) {
    const browser = await chromium.launch({ channel, headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.setDefaultTimeout(20000);
    await page.goto(pathToFileURL(path.join(__dirname,'../index.html')).href); await page.evaluate(s => localStorage.setItem('tripPlanner.state.v1',JSON.stringify(s)),s); await page.reload();
    const samples = { load: [], importPreview: [], search: [], broadFilter: [], change: [] };
    for (let i = 0; i < 6; i++) {
      const start = performance.now(); await page.reload(); const load = performance.now()-start;
      const imported = await page.evaluate(csv => { const t=performance.now(),r=PlannerCore.parseCSV(csv),a=PlannerCore.buildImport(JSON.parse(localStorage.getItem(PlannerCore.KEY)),PlannerCore.mappedRows(r,0,PlannerCore.mappingFor(r[0].cells,'tasks'))); if(!a.ready)throw Error(JSON.stringify(a.errors)); return performance.now()-t; },csv);
      await page.getByRole('button',{name:'Задачи',exact:true}).click();
      const search = await page.evaluate(() => {const t=performance.now(),input=document.querySelector('#search');input.value='Клиент 999';input.dispatchEvent(new Event('input',{bubbles:true}));return performance.now()-t;});
      const broad = await page.evaluate(() => {const t=performance.now(),input=document.querySelector('#search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));return performance.now()-t;});
      await page.locator('#search').fill('Клиент 999');
      const change = await page.evaluate(() => {const t=performance.now();document.querySelector('.task-work input[type=checkbox]').click();return performance.now()-t;});
      if(i){samples.load.push(load);samples.importPreview.push(imported);samples.search.push(search);samples.broadFilter.push(broad);samples.change.push(change);}
    }
    const medians = Object.fromEntries(Object.entries(samples).map(([key,values])=>[key,median(values)])); results.push({channel,version:browser.version(),samples,medians}); console.log(channel,medians); await browser.close();
  }
  const report={hardware:{cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,RAMGiB:os.totalmem()/1024**3,os:os.platform()+' '+os.release(),throttling:false},dataset:{tasks:1000,destinations:200,events:5000,UTF16Bytes:JSON.stringify(s).length*2},results};
  fs.writeFileSync(path.join(__dirname,'performance-results.json'),JSON.stringify(report,null,2));
  for(const r of results){assert(r.medians.load<2000,'load '+r.channel);assert(r.medians.importPreview<2000,'import '+r.channel);assert(r.medians.search<200,'search '+r.channel);assert(r.medians.broadFilter<200,'broadFilter '+r.channel);assert(r.medians.change<300,'change '+r.channel);}
})().catch(e=>{console.error(e);process.exitCode=1});
