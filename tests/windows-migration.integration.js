'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.KRY_PLAYWRIGHT_MODULE || 'playwright');
const E = require('../assets/engine.js');
const assets = path.resolve(__dirname, '../assets');
const catalog = JSON.parse(fs.readFileSync(path.join(assets, 'data.json'), 'utf8'));
const byId = Object.fromEntries(catalog.words.map(word => [word.id, word]));
function word(id) { const entry = byId[id]; return {english: entry.english, chinese: entry.chinese, examples: entry.examples, partOfSpeech: entry.pos}; }
const stamp = '/Date(1791433754595)/';
const task = {word: word('entrepreneur'), mode: 'spelling', answeredAt: stamp, correct: true, replay: false, attempt: 1, submittedAnswer: 'entrepreneur'};
const complete = {id: 'complete', kind: 'new', createdAt: stamp, studyDate: '2026-10-08', status: 'completed', phase: 'done', items: [{word: word('entrepreneur'), exampleComplete: true, dictationComplete: true, spellingComplete: true}], history: [task], tasks: [task], activeMilliseconds: 1000};
const active = {id: 'active', kind: 'new', createdAt: stamp, studyDate: '2026-10-08', status: 'active', phase: 'preview', items: ['mistaken', 'mistakenly'].map(id => ({word: word(id)})), history: [], tasks: [], previewCursor: 1, activeMilliseconds: 500};
const study = {version: 1, settings: {newExample: false, newDictation: false, newSpelling: true}, words: ['entrepreneur', 'mistaken', 'mistakenly'].map(id => ({word: word(id), acceptedAnswers: []})), lists: [complete, active], activeListId: 'active', priorityWords: []};
const notebook = {version: 1, records: [{word: word('entrepreneur'), notebook: 'wrong', errorCount: 2, spellingCorrectCount: 3}], recent: []};
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.join(assets, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file.startsWith(assets + path.sep) || !fs.existsSync(file)) { response.writeHead(404); return response.end(); }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(fs.readFileSync(file));
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({executablePath: process.env.KRY_CHROME, headless: true, args: ['--no-sandbox']});
    try {
        const page = await browser.newPage({viewport: {width: 393, height: 852}});
        const errors = []; let accept = true;
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.getByText('今天，也前进一步。').waitFor();
        await page.evaluate(() => { state.settings.rate = 1.1; persist(); });
        const baseline = await page.evaluate(() => JSON.stringify(state));
        await page.locator('header button').click();
        await page.getByRole('button', {name: '迁移 Windows 记录'}).waitFor();
        await page.evaluate(() => {
            window.importRequests = [];
            window.Android = {importFile: type => window.importRequests.push(type), save: data => { localStorage.setItem('kry-state', data); return true; }, stopSpeech: () => {}, backgroundMime: () => ''};
        });
        await page.getByRole('button', {name: '迁移 Windows 记录'}).click();
        await page.evaluate(data => window.nativeImport('\uFEFF' + JSON.stringify(data)), notebook);
        assert.equal(await page.evaluate(() => JSON.stringify(state)), baseline);
        assert.deepEqual(await page.evaluate(() => window.importRequests), ['json', 'json']);
        await page.evaluate(() => window.nativeImport('{broken'));
        assert.equal(await page.evaluate(() => JSON.stringify(state)), baseline);
        await page.evaluate(data => window.nativeImport(JSON.stringify(data)), study);
        assert.equal(await page.evaluate(() => state.records.entrepreneur.notebook), 'wrong');
        assert.equal(await page.evaluate(() => state.records.entrepreneur.counts.spelling), 3);
        assert.equal(await page.evaluate(() => state.active.preview), 1);
        assert.equal(await page.evaluate(() => state.active.paused), true);
        assert.equal(await page.evaluate(() => JSON.parse(state.backups.at(-1).data).settings.rate), 1.1);
        await page.reload();
        await page.getByRole('button', {name: '恢复上次进度'}).waitFor();
        assert.equal(await page.evaluate(() => state.attempts.length), 1);
        const migrated = await page.evaluate(() => JSON.stringify(state));
        accept = false;
        await page.evaluate(data => window.nativeImport(JSON.stringify(data)), {schema: 'z-windows-migration', version: 1, study, notebook});
        assert.equal(await page.evaluate(() => JSON.stringify(state)), migrated);
        accept = true;
        await page.evaluate(() => { state.settings.autoSpeak = false; persist(); });
        await page.getByRole('button', {name: '恢复上次进度'}).click();
        assert.equal(await page.evaluate(() => state.active.words[state.active.preview]), 'mistakenly');
        if (process.env.WINDOWS_MIGRATION_BACKUP) {
            const backup = JSON.parse(fs.readFileSync(process.env.WINDOWS_MIGRATION_BACKUP, 'utf8'));
            const summary = backup.migration.summary;
            await page.evaluate(data => window.nativeImport(JSON.stringify(data)), backup);
            assert.deepEqual(await page.evaluate(() => state.migration.summary), summary);
            assert.equal(await page.evaluate(() => Object.keys(state.learned).length), summary.learnedWords);
            assert.equal(await page.evaluate(() => state.attempts.length), summary.attempts);
            assert.equal(await page.evaluate(() => state.active?.preview + 1), summary.activePreview);
            await page.reload();
            await page.getByText('今天，也前进一步。').waitFor();
            assert.equal(await page.evaluate(() => state.active.paused), true);
            await page.evaluate(() => { state.settings.autoSpeak = false; persist(); });
            await page.getByRole('button', {name: '恢复上次进度'}).click();
            await page.locator('#previewPhonetic').waitFor();
            if (process.env.KRY_MIGRATION_SCREENSHOT) await page.screenshot({path: process.env.KRY_MIGRATION_SCREENSHOT});
            console.log('PASS: supplied personal backup imports, survives restart and resumes its current preview word');
        }
        assert.deepEqual(errors, []);
        console.log('PASS: staged Windows import, BOM, cancel, corrupt-file safety, pre-import snapshot, preview position and restart');
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
