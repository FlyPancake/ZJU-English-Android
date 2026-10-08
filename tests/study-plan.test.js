'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../assets/engine.js');
const P = require('../assets/study-plan.js');
const day = (date = 8, hour = 12, minute = 0, second = 0) => new Date(2026, 9, date, hour, minute, second);
const books = [{id: 'book1', units: ['unit1', 'unit2']}, {id: 'book2', units: ['unit1']}];
const word = (id, book = 'book1', unit = 'unit1') => ({id, english: id, chinese: id + ' 释义', examples: `Say [[${id}]].`, sources: [{book, unit}]});
const alpha = word('alpha'), bravo = word('bravo'), charlie = word('charlie', 'book2');
const config = {modes: ['spelling'], taskOrder: E.modes, order: 'sequential'};
function initial() { const state = E.initial(); state.settings.modules.new = E.clone(config); return state; }
function history(id, date, ids, created) { return {id, kind: 'new', date, words: ids, retainedWords: ids.slice(), releasedWords: [], complete: true, created, elapsed: 0}; }
test('learning day changes at exactly 04:01, not midnight or 04:00:59', () => {
    assert.equal(E.studyDayKey(day(8, 0)), '2026-10-07');
    assert.equal(E.studyDayKey(day(8, 4, 0, 59)), '2026-10-07');
    assert.equal(E.studyDayKey(day(8, 4, 1)), '2026-10-08');
    assert.equal(E.studyDayKey(new Date(2027, 0, 1, 3)), '2026-12-31');
});
test('multiple book quotas skip duplicate logical words and refill within the same book', () => {
    const shared = {...alpha, sources: [...alpha.sources, {book: 'book2', unit: 'unit1'}]};
    const second = word('delta', 'book2');
    const result = P.selectNew(initial(), [shared, bravo, charlie, second], books, {book1: 1, book2: 2});
    assert.deepEqual(result.words.map(item => item.id), ['alpha', 'charlie', 'delta']);
    assert.deepEqual(result.sourceBooks, {alpha: 'book1', charlie: 'book2', delta: 'book2'});
});
test('short books do not borrow the quota of another book and custom books participate', () => {
    const custom = {id: 'custom', units: ['导入词表']}, customWord = word('customword', 'custom', '导入词表');
    const state = initial();
    const result = P.selectNew(state, [alpha, charlie, customWord], [...books, custom], {book1: 8, book2: 1, custom: 1});
    assert.deepEqual(result.words.map(item => item.id), ['alpha', 'charlie', 'customword']);
    assert.deepEqual(P.availableCounts(state, [alpha, charlie, customWord], [...books, custom]), {book1: 1, book2: 1, custom: 1});
});
test('priority words count toward quotas when enabled and are extra when disabled', () => {
    const state = initial(); state.priorityWords = ['bravo', 'charlie'];
    let result = P.selectNew(state, [alpha, bravo, charlie], books, {book1: 1, book2: 0});
    assert.deepEqual(result.words.map(item => item.id), ['bravo']);
    state.settings.carryOverCountsInNewCount = false;
    result = P.selectNew(state, [alpha, bravo, charlie], books, {book1: 1, book2: 0});
    assert.deepEqual(result.words.map(item => item.id), ['bravo', 'alpha', 'charlie']);
    assert.deepEqual(result.carriedOverWords, ['bravo', 'charlie']);
    assert.deepEqual(P.selectNew(state, [alpha, bravo, charlie], books, {book1: 1}).words.map(item => item.id), ['bravo', 'alpha']);
});
test('random extraction shuffles only ordinary words, leaving priority order first', () => {
    const state = initial(); state.priorityWords = ['bravo']; state.settings.randomExtraction = true;
    const result = P.selectNew(state, [alpha, bravo, word('delta'), word('echo')], books, {book1: 2}, () => 0);
    assert.equal(result.words[0].id, 'bravo'); assert.notEqual(result.words[1].id, 'alpha');
});
test('sequential extraction respects book unit ordering, skips mastered and already extracted words', () => {
    const state = initial(), late = word('later', 'book1', 'unit2');
    state.records.bravo = {notebook: 'mastered'}; state.extracted.alpha = {date: '2026-10-08', book: 'book1'};
    const result = P.selectNew(state, [late, alpha, bravo, word('first')], books, {book1: 2});
    assert.deepEqual(result.words.map(item => item.id), ['first', 'later']);
});
test('rejects empty, fractional, negative, oversized and unknown-book quotas', () => {
    for (const quotas of [{book1: 0}, {book1: -1}, {book1: 1.5}, {book1: 10001}, {missing: 1}]) assert.throws(() => P.selectNew(initial(), [alpha], books, quotas));
});
test('defaults fallback to the first book and remembered quotas are independent from the daily goal', () => {
    const state = initial(); state.settings.newCount = 2;
    assert.deepEqual(P.quotaDefaults(state, books), {book1: 2, book2: 0});
    state.settings.defaultBookCounts = {book1: 1, book2: 3}; state.settings.newCount = 100;
    assert.deepEqual(P.quotaDefaults(state, books), {book1: 1, book2: 3});
});
test('extracts further batches on the same day without enforcing the daily goal as a hard limit', () => {
    const state = initial(); state.settings.newCount = 1;
    P.startNew(state, [alpha, bravo], books, {book1: 1}, day());
    E.submit(state, alpha, 'alpha', day()); E.finish(state, true, day());
    P.startNew(state, [alpha, bravo], books, {book1: 1}, day());
    assert.deepEqual(state.active.words, ['bravo']); assert.equal(state.extracted.bravo.book, 'book1');
});
test('cross-day settlement retains successful and mastered words, returns incomplete words, and preserves errors', () => {
    const state = initial(); P.startNew(state, [alpha, bravo, word('delta')], books, {book1: 3}, day());
    state.active.phase = 'quiz';
    E.submit(state, alpha, 'alpha', day()); E.advance(state);
    E.submit(state, bravo, 'wrong', day()); E.advance(state);
    E.masterWord(state, word('delta'));
    assert.equal(P.settleCrossDay(state, day(9, 0)), null);
    assert.equal(P.settleCrossDay(state, day(9, 4, 0, 59)), null);
    const result = P.settleCrossDay(state, day(9, 4, 1));
    assert.deepEqual(result.released, ['bravo']); assert.deepEqual(result.retained, ['alpha', 'delta']);
    assert.equal(state.active, null); assert.equal(state.sessions[0].status, 'settled');
    assert.deepEqual(state.priorityWords, ['bravo']); assert.equal(state.records.bravo.notebook, 'wrong'); assert.equal(state.records.bravo.errors, 1);
    assert.equal(state.extracted.bravo, undefined); assert.equal(state.learned.bravo, undefined);
    assert.equal(state.learned.alpha.date, '2026-10-08'); assert.equal(state.learned.alpha.due, '2026-10-09');
    assert.equal(P.settleCrossDay(state, day(10)), null); assert.equal(state.sessions.length, 1);
    P.startNew(state, [alpha, bravo, word('delta')], books, {book1: 1}, day(9));
    assert.deepEqual(state.active.words, ['bravo']); assert.deepEqual(state.active.carriedOverWords, ['bravo']); assert.deepEqual(state.priorityWords, []);
});
test('a correct answer awaiting feedback dismissal still counts as completed at rollover', () => {
    const state = initial(); P.startNew(state, [alpha, bravo], books, {book1: 2}, day());
    E.submit(state, alpha, 'alpha', day());
    const result = P.settleCrossDay(state, day(9));
    assert.deepEqual(result.retained, ['alpha']); assert.deepEqual(result.released, ['bravo']);
});
test('every required example must be completed before a word is retained', () => {
    const state = initial(), multi = {...alpha, examples: 'Say [[alpha]].；Repeat [[alpha]].'};
    state.settings.modules.new = {modes: ['example'], taskOrder: E.modes, order: 'sequential'};
    P.startNew(state, [multi], books, {book1: 1}, day()); E.submit(state, multi, 'alpha', day());
    assert.deepEqual(P.settleCrossDay(state, day(9)).released, ['alpha']);
});
test('unfinished review words return to the new-word pool without losing notebook history', () => {
    const state = initial(); state.learned.alpha = {date: '2026-10-01', last: '2026-10-01', stage: 0, due: '2026-10-02'};
    state.extracted.alpha = {date: '2026-10-01', book: 'book1'};
    E.start(state, [alpha], 'review', config, day()); E.submit(state, alpha, 'wrong', day());
    assert.deepEqual(P.settleCrossDay(state, day(9)).released, ['alpha']);
    assert.equal(state.learned.alpha, undefined); assert.equal(state.records.alpha.errors, 1);
    assert.equal(P.availableCounts(state, [alpha], books).book1, 1);
});
test('free practice survives the day boundary and keeps its history review words', () => {
    const state = initial(); E.start(state, [alpha], 'free', config, day());
    assert.equal(P.settleCrossDay(state, day(9)), null); assert.ok(state.active);
    E.finish(state, false, day(9)); assert.deepEqual(state.sessions[0].retainedWords, ['alpha']);
});
test('disabling carried-over preview allows direct navigation while ordinary words require all three layers', () => {
    const state = initial(); state.priorityWords = ['bravo']; state.settings.carryOverPreview = false;
    P.startNew(state, [alpha, bravo], books, {book1: 2}, day());
    assert.equal(E.previewNeedsLayers(state), false); E.movePreview(state, 1);
    assert.equal(state.active.words[state.active.preview], 'alpha'); assert.equal(E.previewNeedsLayers(state), true);
    E.movePreview(state, 1); assert.equal(state.active.phase, 'preview');
    E.revealPreview(state); E.revealPreview(state); E.movePreview(state, 1); assert.equal(state.active.phase, 'quiz');
});
test('history review takes lists rather than word quotas and excludes returned, mastered and same-day words', () => {
    const state = initial(); state.settings.listCount = 2;
    state.sessions = [history('old', '2026-10-05', ['alpha'], 1), history('middle', '2026-10-06', ['bravo'], 2), history('newer', '2026-10-07', ['charlie', 'delta'], 3), history('today', '2026-10-08', ['echo'], 4)];
    state.sessions[1].retainedWords = []; state.sessions[1].releasedWords = ['bravo']; state.records.delta = {notebook: 'mastered'};
    const pool = P.reviewPool(state, [alpha, bravo, charlie, word('delta'), word('echo')], day());
    assert.deepEqual(pool.sourceListIds, ['old', 'newer']); assert.deepEqual(pool.words.map(item => item.id), ['alpha', 'charlie']);
    state.sessions.push({...history('review', '2026-10-08', ['alpha'], 5), kind: 'review'});
    assert.deepEqual(P.reviewPool(state, [alpha, charlie], day()).words.map(item => item.id), ['charlie']);
});
test('overlap setting excludes same-day history/problem words in both directions', () => {
    const state = initial(); const item = E.record(state, alpha); item.notebook = 'wrong';
    state.sessions = [history('new', '2026-10-07', ['alpha'], 1), {...history('review', '2026-10-08', ['alpha'], 2), kind: 'review'}];
    assert.equal(P.problemPool(state, [alpha], day()).length, 1); state.settings.allowOverlap = false;
    assert.equal(P.problemPool(state, [alpha], day()).length, 0);
    state.sessions[1].kind = 'problem'; assert.equal(P.reviewPool(state, [alpha], day()).words.length, 0);
});
test('problem counts and due-only filtering use last answer time, correct stage and zero-day intervals', () => {
    const state = initial(); state.settings.problemCount = 1;
    const first = E.record(state, alpha), second = E.record(state, bravo);
    first.notebook = 'wrong'; first.lastAnswered = day(8).getTime(); first.edited = day(9).getTime();
    second.notebook = 'prone'; second.lastAnswered = day(1).getTime();
    state.settings.reviewDueOnly = true;
    assert.equal(P.problemPool(state, [alpha, bravo], day(8)).length, 0);
    assert.deepEqual(P.problemPool(state, [alpha, bravo], day(9)).map(item => item.id), ['alpha']);
    state.settings.reviewDays = [0]; assert.deepEqual(P.problemPool(state, [alpha, bravo], day(8)).map(item => item.id), ['bravo']);
    state.settings.problemCount = 0; assert.deepEqual(P.problemPool(state, [alpha, bravo], day(8)), []);
});
test('old Android backups upgrade without losing progress and align pre-04:01 sessions to the preceding day', () => {
    const state = initial(); E.start(state, [alpha], 'new', config, day(8, 3));
    delete state.planVersion; delete state.extracted; delete state.priorityWords;
    state.active.date = '2026-10-08'; state.active.input = 'retained'; state.active.previewStage = 1;
    P.validate(state, new Set(['alpha']));
    assert.equal(state.active.date, '2026-10-07'); assert.equal(state.active.input, 'retained'); assert.equal(state.active.previewStage, 1);
    assert.ok(state.extracted.alpha); assert.equal(state.active.paused, true);
    assert.ok(P.settleCrossDay(state, day(8, 4, 1)));
});
test('old converted Windows backups recover quotas, cross-day flags and carried-over markers exactly once', () => {
    const state = initial(); E.start(state, [alpha], 'new', config, day()); delete state.planVersion;
    state.active.id = 'windows-source'; delete state.active.carriedOverWords; delete state.active.carryOverPreview;
    state.migration = {source: {study: {settings: {defaultBookCounts: {book1: 2, book2: 3}, carryOverPreview: false, listCount: 5, allowOverlap: false}, lists: [{id: 'source', items: [{word: alpha, sourceBook: 'book1', carriedOver: true}]}]}, notebook: {records: []}}};
    P.normalize(state);
    assert.deepEqual(state.settings.defaultBookCounts, {book1: 2, book2: 3}); assert.equal(state.settings.listCount, 5);
    assert.equal(state.settings.carryOverPreview, false); assert.deepEqual(state.active.carriedOverWords, ['alpha']);
    assert.equal(state.active.carryOverPreview, false);
    state.settings.allowOverlap = true; P.normalize(state); assert.equal(state.settings.allowOverlap, true);
});
test('backup validation accepts zero-day schedules and rejects broken priority/extraction references', () => {
    const state = initial(); state.settings.reviewDays = [0, 1]; P.validate(state, new Set(['alpha']));
    const missing = E.clone(state); missing.priorityWords = ['missing']; assert.throws(() => P.validate(missing, new Set(['alpha'])));
    const broken = E.clone(state); broken.extracted.alpha = {date: 'bad'}; assert.throws(() => P.validate(broken, new Set(['alpha'])));
});
