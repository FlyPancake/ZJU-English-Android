'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.KRY_PLAYWRIGHT_MODULE || 'playwright');
const assets = path.resolve(__dirname, '../assets');
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.join(assets, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file.startsWith(assets) || !fs.existsSync(file)) { response.writeHead(404); return response.end(); }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(fs.readFileSync(file));
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({executablePath: process.env.KRY_CHROME, headless: true, args: ['--no-sandbox']});
    try {
        const context = await browser.newContext({viewport: {width: 393, height: 852}});
        await context.addInitScript(() => {
            window.playbackRequests = []; window.emitSpeechAutomatically = true;
            window.Android = {
                load: () => localStorage.getItem('kry-state') || '',
                save: data => { localStorage.setItem('kry-state', data); return true; },
                backgroundMime: () => '', stopSpeech: () => {},
                speak: (text, rate, volume, accent, id) => {
                    window.playbackRequests.push({text, rate, volume, accent, id});
                    if (window.emitSpeechAutomatically) {
                        window.nativeSpeech(JSON.stringify({id, state: 'started', message: '正在朗读…'}));
                        window.nativeSpeech(JSON.stringify({id, state: 'done'}));
                    }
                }
            };
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.getByText('今天，也前进一步。').waitFor();
        await page.evaluate(() => { state.settings.modules.new.modes = E.modes.slice(); begin('new', [words.entrepreneur, words.mistaken]); });
        assert.equal(await page.evaluate(() => playbackRequests.length), 1);
        assert.equal(await page.evaluate(() => playbackRequests[0].text), 'entrepreneur');
        await page.locator('[data-action=previewReveal]').click();
        await page.locator('[data-action=previewReveal]').click();
        assert.equal(await page.evaluate(() => playbackRequests.length), 1);
        await page.locator('[data-action=previewNext]').click();
        assert.equal(await page.evaluate(() => playbackRequests.length), 2);
        await page.locator('[data-action=previewPrev]').click();
        assert.equal(await page.evaluate(() => playbackRequests.length), 2);
        await page.locator('[data-action=pause]').click(); await page.reload();
        await page.locator('[data-action=resume]').click();
        assert.equal(await page.evaluate(() => playbackRequests.length), 0);
        assert.deepEqual(await page.evaluate(() => state.active.previewSpoken), ['entrepreneur', 'mistaken']);
        await page.evaluate(() => { state.active.phase = 'quiz'; state.active.cursor = 0; render(); autoSpeak(); });
        assert.equal(await page.evaluate(() => playbackRequests.length), 0);
        await page.locator('[data-action=speakTask]').click();
        await page.locator('[data-action=speakTask]').click();
        assert.equal(await page.evaluate(() => playbackRequests.length), 2);
        const beforeSpelling = await page.evaluate(() => playbackRequests.length);
        await page.evaluate(() => { state.active.cursor = state.active.tasks.findIndex(task => task.mode === 'spelling'); render(); autoSpeak(); });
        assert.equal(await page.evaluate(() => playbackRequests.length), beforeSpelling);
        await page.locator('[data-action=speakTask]').click();
        assert.equal(await page.evaluate(() => playbackRequests.length), beforeSpelling + 1);
        await page.evaluate(() => { state.active.cursor = state.active.tasks.findIndex(task => task.mode === 'dictation'); render(); autoSpeak(); });
        assert.equal(await page.evaluate(() => playbackRequests.length), beforeSpelling + 2);
        await page.evaluate(() => {
            stopSpeech(); state = E.initial(); playbackRequests = []; emitSpeechAutomatically = false;
            begin('new', [words.entrepreneur]); autoSpeak(); autoSpeak();
        });
        assert.equal(await page.evaluate(() => playbackRequests.length), 1);
        assert.deepEqual(await page.evaluate(() => state.active.previewSpoken), []);
        await page.evaluate(() => nativeSpeech(JSON.stringify({id: playbackRequests[0].id, state: 'waiting', message: '正在准备英语语音'})));
        assert.ok((await page.locator('#toast').innerText()).includes('正在准备'));
        await page.evaluate(() => nativeSpeech(JSON.stringify({id: playbackRequests[0].id, state: 'error', message: '请安装英语语音包'})));
        assert.ok((await page.locator('#toast').innerText()).includes('英语语音包'));
        assert.deepEqual(await page.evaluate(() => state.active.previewSpoken), []);
        await page.locator('[data-action=speak]').click();
        assert.equal(await page.evaluate(() => playbackRequests.length), 2);
        await page.evaluate(() => {
            const id = playbackRequests[1].id;
            nativeSpeech(JSON.stringify({id, state: 'started', message: '正在朗读…'}));
            nativeSpeech(JSON.stringify({id, state: 'done'}));
        });
        assert.deepEqual(await page.evaluate(() => state.active.previewSpoken), ['entrepreneur']);
        await page.locator('[data-action=speak]').click();
        assert.equal(await page.evaluate(() => playbackRequests.length), 3);
        assert.equal(await page.evaluate(() => new Set(playbackRequests.map(request => request.id)).size), 3);
        await page.locator('[data-action=pause]').click();
        await page.evaluate(() => nativeSpeech(JSON.stringify({id: playbackRequests[2].id, state: 'started', message: 'stale playback'})));
        assert.equal(await page.evaluate(() => speechRequests.size), 0);
        await page.locator('[data-action=resume]').click();
        assert.equal(await page.evaluate(() => playbackRequests.length), 3);
        await page.evaluate(() => { state.settings.volume = 0; });
        await page.locator('[data-action=speak]').click();
        assert.equal(await page.evaluate(() => playbackRequests.length), 3);
        assert.ok((await page.locator('#toast').innerText()).includes('音量为 0'));
        assert.deepEqual(errors, []);
        console.log('PASS: first-preview-only auto speech, no fill/spelling leakage, manual repeat, dictation, deferred/error feedback, real-start persistence, cancellation, unique IDs, volume feedback');
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
