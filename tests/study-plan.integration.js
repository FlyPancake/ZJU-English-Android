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
    if (!file.startsWith(assets + path.sep) || !fs.existsSync(file)) { response.writeHead(404); return response.end(); }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(fs.readFileSync(file));
});
async function advancePreview(page) {
    for (let index = 0; index < 10; index++) {
        if (await page.evaluate(() => state.active.phase !== 'preview')) return;
        if (await page.locator('[data-action=previewReveal]').count()) await page.locator('[data-action=previewReveal]').click();
        else await page.locator('[data-action=previewNext]').click();
    }
    throw Error('Preview did not reach quiz');
}
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({executablePath: process.env.KRY_CHROME, headless: true, args: ['--no-sandbox']});
    try {
        const page = await browser.newPage({viewport: {width: 393, height: 852}, timezoneId: 'America/Chicago'});
        const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
        await page.clock.setFixedTime('2026-10-08T23:59:00-05:00');
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.getByText('今天，也前进一步。').waitFor();
        await page.locator('header button').click();
        await page.locator('#defaultQuota-0').fill('1'); await page.locator('#defaultQuota-1').fill('1');
        await page.locator('#listCount').fill('2'); await page.locator('#problemCount').fill('5');
        await page.locator('#reviewDays').fill('0,1,3');
        await page.locator('#allowOverlap').uncheck(); await page.locator('#reviewDueOnly').check();
        await page.locator('summary').filter({hasText: '每日新学'}).click();
        await page.locator('#new-example').uncheck(); await page.locator('#autoSpeak').uncheck();
        await page.locator('[data-action=saveSettings]').click();
        await page.locator('#nav [data-value=home]').click();
        assert.equal(await page.locator('#quota-0').inputValue(), '1'); assert.equal(await page.locator('#quota-1').inputValue(), '1');
        await page.locator('#toast').evaluate(element => { element.style.display = 'none'; });
        if (process.env.KRY_QUOTA_SCREENSHOT) await page.screenshot({path: process.env.KRY_QUOTA_SCREENSHOT, fullPage: true});
        await page.locator('[data-action=start][data-value=new]').click();
        assert.equal(await page.evaluate(() => state.active.words.length), 2);
        assert.deepEqual(await page.evaluate(() => Object.values(state.active.sourceBooks)), ['book2', 'book3']);
        await advancePreview(page);
        const retained = await page.evaluate(() => state.active.tasks[0].word);
        const returned = await page.evaluate(() => state.active.tasks[1].word);
        await page.locator('#answer').fill(await page.evaluate(() => state.active.tasks[0].answer));
        await page.locator('[data-action=submit]').click(); await page.locator('[data-action=next]').click();
        await page.locator('#answer').fill('wrong'); await page.locator('[data-action=submit]').click();
        await page.clock.setFixedTime('2026-10-09T00:01:00-05:00'); await page.evaluate(() => tick());
        assert.equal(await page.evaluate(() => state.active.date), '2026-10-08');
        await page.clock.setFixedTime('2026-10-09T04:00:59-05:00'); await page.evaluate(() => tick());
        assert.equal(await page.evaluate(() => state.active !== null), true);
        await page.clock.setFixedTime('2026-10-09T04:01:00-05:00'); await page.evaluate(() => tick());
        assert.equal(await page.evaluate(() => state.active), null);
        assert.deepEqual(await page.evaluate(() => state.priorityWords), [returned]);
        assert.deepEqual(await page.evaluate(() => state.sessions[0].retainedWords), [retained]);
        assert.equal(await page.evaluate(id => state.records[id].errors, returned), 1);
        assert.equal(await page.evaluate(id => state.records[id].notebook, returned), 'wrong');
        assert.equal(await page.evaluate(id => state.learned[id].date, retained), '2026-10-08');
        assert.equal(await page.evaluate(() => JSON.parse(state.backups.at(-1).data).active.date), '2026-10-08');
        assert.equal(await page.evaluate(() => undo.length), 0);
        await page.locator('#nav [data-value=stats]').click(); await page.getByText(/跨日已结算/).waitFor();
        await page.locator('header button').click();
        await page.locator('#carryOverCountsInNewCount').uncheck(); await page.locator('#carryOverPreview').uncheck();
        await page.locator('[data-action=saveSettings]').click(); await page.locator('#nav [data-value=home]').click();
        await page.locator('[data-action=start][data-value=new]').click();
        assert.equal(await page.evaluate(() => state.active.words.length), 3);
        assert.deepEqual(await page.evaluate(() => state.active.carriedOverWords), [returned]);
        await page.locator('[data-action=previewReveal]').click(); await page.locator('[data-action=previewReveal]').click(); await page.locator('[data-action=previewNext]').click();
        assert.equal(await page.evaluate(() => state.active.words[state.active.preview]), returned);
        await page.getByText(/返池词简略预览/).waitFor();
        assert.equal(await page.locator('[data-action=previewReveal]').count(), 0);
        await page.locator('#toast').evaluate(element => { element.style.display = 'none'; });
        if (process.env.KRY_CARRY_SCREENSHOT) await page.screenshot({path: process.env.KRY_CARRY_SCREENSHOT});
        await page.locator('[data-action=previewNext]').click(); assert.equal(await page.locator('[data-action=previewReveal]').count(), 1);
        await page.evaluate(() => window.lifecyclePause());
        await page.clock.setFixedTime('2026-10-10T05:00:00-05:00'); await page.reload();
        await page.getByText('今天，也前进一步。').waitFor();
        assert.equal(await page.evaluate(() => state.active), null);
        assert.equal(await page.evaluate(() => state.sessions.filter(item => item.status === 'settled').length), 2);
        assert.equal(await page.evaluate(() => state.priorityWords.length), 3);
        assert.equal(await page.evaluate(() => state.attempts.length), 2);
        const snapshotCount = await page.evaluate(() => state.backups.length);
        await page.reload(); await page.getByText('今天，也前进一步。').waitFor();
        assert.equal(await page.evaluate(() => state.backups.length), snapshotCount);
        assert.deepEqual(await page.evaluate(() => state.settings.defaultBookCounts), {book2: 1, book3: 1});
        assert.equal(await page.evaluate(() => state.settings.carryOverPreview), false);
        assert.equal(await page.evaluate(() => state.settings.allowOverlap), false);
        assert.equal(await page.evaluate(() => state.settings.reviewDueOnly), true);
        assert.deepEqual(errors, []);
        console.log('PASS: two-book quotas, midnight/04:01 boundaries, retained/error records, snapshot, extra carry-over, compact preview, restart settlement and idempotence');
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
