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
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({executablePath: process.env.KRY_CHROME, headless: true, args: ['--no-sandbox']});
    try {
        const page = await browser.newPage({viewport: {width: 393, height: 852}, timezoneId: 'America/Chicago'});
        const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
        await page.clock.install({time: new Date('2026-10-08T12:00:00-05:00')});
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.getByText('今天，也前进一步。').waitFor();
        assert.deepEqual(await page.evaluate(() => state.settings.newBookUnits), {});
        const units = await page.evaluate(() => Object.fromEntries(allBooks().map(book => [book.id, book.units])));
        await page.locator('#nav [data-value=practice]').click();
        await page.locator('#book').selectOption('book3');
        await page.locator('input[name=unit]').first().check();
        const practiceUnits = await page.evaluate(() => state.settings.units);
        await page.locator('#nav [data-value=home]').click();
        await page.locator('[data-quota=book2]').fill('4'); await page.locator('[data-quota=book3]').fill('2');
        await page.locator('#rememberQuotas').uncheck();
        for (const bookId of ['book2', 'book3']) {
            await page.locator('[data-range-book=' + bookId + '] summary').click();
            await page.locator('[data-new-units-all=' + bookId + ']').uncheck();
            assert.equal(await page.locator('[data-new-unit-book=' + bookId + ']:checked').count(), 0);
            await page.locator('[data-new-unit-book=' + bookId + ']').nth(1).check();
        }
        assert.equal(await page.locator('[data-quota=book2]').inputValue(), '4');
        assert.equal(await page.locator('[data-quota=book3]').inputValue(), '2');
        assert.equal(await page.locator('#rememberQuotas').isChecked(), false);
        const ranges = {book2: [units.book2[1]], book3: [units.book3[1]]};
        assert.deepEqual(await page.evaluate(() => state.settings.newBookUnits), ranges);
        assert.deepEqual(await page.evaluate(() => state.settings.units), practiceUnits);
        const counts = await page.evaluate(() => P.availableCounts(state, Object.values(words), allBooks()));
        for (const bookId of ['book2', 'book3']) assert.match(await page.locator('[data-remaining-book=' + bookId + ']').textContent(), new RegExp('范围内可抽 ' + counts[bookId] + ' 词'));
        await page.reload(); await page.getByText('今天，也前进一步。').waitFor();
        assert.deepEqual(await page.evaluate(() => state.settings.newBookUnits), ranges);
        assert.deepEqual(await page.evaluate(() => state.settings.units), practiceUnits);
        const saved = await page.evaluate(() => JSON.stringify(state));
        if (process.env.Z_UNIT_SCREENSHOT) {
            await page.locator('[data-quota=book2]').fill('4'); await page.locator('[data-quota=book3]').fill('2');
            await page.locator('[data-range-book=book2] summary').click();
            await page.locator('#toast').evaluate(element => { element.style.display = 'none'; });
            await page.locator('#nav').evaluate(element => { element.style.visibility = 'hidden'; });
            await page.locator('#quotaPanel').screenshot({path: process.env.Z_UNIT_SCREENSHOT});
            await page.locator('#nav').evaluate(element => { element.style.visibility = ''; });
        }
        const priority = await page.evaluate(() => {
            const book = allBooks().find(book => book.id === 'book2'), selected = state.settings.newBookUnits.book2;
            const inside = Object.values(words).find(word => word.sources.some(source => source.book === book.id && selected.includes(source.unit)));
            const outside = Object.values(words).find(word => word.sources.every(source => source.book === book.id && !selected.includes(source.unit)));
            state.priorityWords = [outside.id, inside.id];
            E.record(state, outside).notebook = 'priority'; state.records[outside.id].errors = 3;
            state.settings.autoSpeak = false; state.settings.carryOverCountsInNewCount = false; persist();
            return {inside: inside.id, outside: outside.id, outsideUnit: outside.sources[0].unit};
        });
        await page.locator('[data-quota=book2]').fill(String(counts.book2 + 5));
        await page.locator('[data-quota=book3]').fill(String(counts.book3 + 5));
        await page.locator('[data-action=start][data-value=new]').click();
        await page.locator('.quota-shortfall').waitFor();
        const active = await page.evaluate(() => state.active);
        assert.deepEqual(active.unitRanges, ranges);
        assert.ok(active.words.includes(priority.inside)); assert.ok(!active.words.includes(priority.outside));
        assert.deepEqual(await page.evaluate(() => state.priorityWords), [priority.outside]);
        assert.equal(await page.evaluate(id => state.records[id].errors, priority.outside), 3);
        assert.equal(await page.evaluate(() => state.active.words.every(id => words[id].sources.some(source => source.book === state.active.sourceBooks[id] && state.settings.newBookUnits[source.book].includes(source.unit)))), true);
        assert.equal(active.quotaShortfalls.book2.requested, counts.book2 + 5);
        assert.equal(active.quotaShortfalls.book2.actual, counts.book2 - 1);
        assert.match(await page.locator('.quota-shortfall').textContent(), /未从范围外补足/);
        await page.locator('#nav [data-value=home]').click();
        await page.locator('[data-range-book=book2] summary').click();
        await page.locator('[data-new-units-all=book2]').check();
        assert.equal(await page.locator('[data-new-unit-book=book2]:checked').count(), units.book2.length);
        assert.equal(await page.evaluate(() => Object.hasOwn(state.settings.newBookUnits, 'book2')), false);
        assert.deepEqual(await page.evaluate(() => state.active.words), active.words);
        assert.deepEqual(await page.evaluate(() => state.active.unitRanges), ranges);
        await page.reload(); await page.getByText('今天，也前进一步。').waitFor();
        assert.deepEqual(await page.evaluate(() => state.active.words), active.words);
        assert.deepEqual(await page.evaluate(() => state.active.unitRanges), ranges);
        await page.evaluate(text => restore(text), saved);
        assert.deepEqual(await page.evaluate(() => state.settings.newBookUnits), ranges);
        assert.deepEqual(await page.evaluate(() => state.settings.units), practiceUnits);
        const invalid = JSON.parse(saved); invalid.settings.newBookUnits.book2 = 'invalid';
        const invalidMessage = await page.evaluate(text => { try { restore(text); return ''; } catch (error) { return error.message; } }, JSON.stringify(invalid));
        assert.match(invalidMessage, /新学单元范围/);
        assert.deepEqual(await page.evaluate(() => state.settings.newBookUnits), ranges);
        for (const bookId of ['book2', 'book3']) {
            await page.locator('[data-range-book=' + bookId + '] summary').click();
            await page.locator('[data-new-units-all=' + bookId + ']').check();
            await page.locator('[data-new-units-all=' + bookId + ']').uncheck();
            await page.locator('[data-quota=' + bookId + ']').fill('1');
        }
        await page.locator('[data-action=start][data-value=new]').click();
        await page.getByText('所选新学单元范围内没有可抽取的词，请调整单元范围或配额', {exact: true}).waitFor();
        assert.equal(await page.evaluate(() => state.active), null);
        assert.deepEqual(await page.evaluate(() => state.extracted), {});
        await page.evaluate(({id}) => { state.priorityWords = [id]; E.record(state, words[id]).notebook = 'priority'; state.records[id].errors = 3; persist(); }, {id: priority.outside});
        await page.locator('[data-new-unit-book=book2]').evaluateAll((inputs, unit) => { const input = inputs.find(input => input.value === unit); input.checked = true; input.dispatchEvent(new Event('change', {bubbles: true})); }, priority.outsideUnit);
        await page.locator('[data-quota=book3]').fill('0');
        await page.locator('[data-action=start][data-value=new]').click();
        assert.deepEqual(await page.evaluate(() => state.active.words), [priority.outside]);
        assert.equal(await page.evaluate(id => state.records[id].errors, priority.outside), 3);
        assert.deepEqual(errors, []);
        console.log('PASS: independent ranges, live counts, unchanged quotas, reload/backup, range-bounded carry-over, shortage notice, active snapshot, clear/all and excluded returnee reuse');
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
