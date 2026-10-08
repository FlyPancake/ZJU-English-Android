'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../assets/engine.js');
const P = require('../assets/study-plan.js');
const books = [{id: 'book1', units: ['unit1', 'unit2', 'unit3']}, {id: 'book2', units: ['unit1', 'unit2']}];
const word = (id, book, unit) => ({id, english: id, chinese: id, examples: 'Say [[' + id + ']].', sources: [{book, unit}]});
const alpha = word('alpha', 'book1', 'unit1');
const bravo = word('bravo', 'book1', 'unit2');
const charlie = word('charlie', 'book1', 'unit3');
const delta = word('delta', 'book2', 'unit1');
const echo = word('echo', 'book2', 'unit2');
const words = [alpha, bravo, charlie, delta, echo];
const day = date => new Date(2026, 9, date, 12);
test('legacy settings retain all units and do not inherit free-practice filters', () => {
    const state = E.initial();
    delete state.settings.newBookUnits;
    state.settings.book = 'book2'; state.settings.units = ['unit2'];
    P.validate(state, new Set(words.map(word => word.id)));
    assert.deepEqual(state.settings.newBookUnits, {});
    assert.deepEqual(P.availableCounts(state, words, books), {book1: 3, book2: 2});
    assert.deepEqual(P.selectNew(state, words, books, {book1: 3, book2: 2}).words.map(word => word.id), words.map(word => word.id));
});
test('independent book ranges restrict quotas and availability without out-of-range refill', () => {
    const state = E.initial(); state.settings.newBookUnits = {book1: ['unit2'], book2: ['unit2']};
    const selected = P.selectNew(state, words, books, {book1: 3, book2: 1});
    assert.deepEqual(selected.words.map(word => word.id), ['bravo', 'echo']);
    assert.deepEqual(P.availableCounts(state, words, books), {book1: 1, book2: 1});
    assert.deepEqual(selected.quotaShortfalls, {book1: {requested: 3, actual: 1}});
    assert.deepEqual(state.settings.units, []);
});
test('random extraction is still bounded by selected units', () => {
    const state = E.initial(); state.settings.randomExtraction = true;
    state.settings.newBookUnits = {book1: ['unit1', 'unit3'], book2: ['unit2']};
    const selected = P.selectNew(state, words, books, {book1: 9, book2: 9}, () => 0);
    assert.deepEqual(new Set(selected.words.map(word => word.id)), new Set(['alpha', 'charlie', 'echo']));
});
test('explicit empty and stale ranges fail closed rather than broadening to all units', () => {
    const state = E.initial(); state.settings.newBookUnits = {book1: [], book2: ['deleted-unit']};
    assert.deepEqual(P.availableCounts(state, words, books), {book1: 0, book2: 0});
    assert.throws(() => P.startNew(state, words, books, {book1: 2, book2: 2}, day(8)), /所选新学单元范围内没有/);
    assert.equal(state.active, null);
    assert.deepEqual(state.extracted, {});
});
test('range filtering is scoped to the same source book and duplicate logical words refill within range', () => {
    const shared = {...alpha, sources: [...alpha.sources, {book: 'book2', unit: 'unit2'}]};
    const state = E.initial(); state.settings.newBookUnits = {book1: ['unit2'], book2: ['unit2']};
    assert.deepEqual(P.selectNew(state, [shared, bravo, echo], books, {book1: 1, book2: 2}).words.map(word => word.id), ['bravo', 'alpha', 'echo']);
    state.settings.newBookUnits.book1 = ['unit1'];
    assert.deepEqual(P.selectNew(state, [shared, delta, echo], books, {book1: 1, book2: 2}).words.map(word => word.id), ['alpha', 'echo']);
});
test('sequential extraction orders by matching selected sources, not unselected earlier sources', () => {
    const multi = {...alpha, sources: [...alpha.sources, {book: 'book1', unit: 'unit3'}]};
    const state = E.initial(); state.settings.newBookUnits = {book1: ['unit2', 'unit3']};
    assert.deepEqual(P.selectNew(state, [multi, bravo], books, {book1: 2}).words.map(word => word.id), ['bravo', 'alpha']);
});
test('carry-over words obey ranges under both quota modes, preserving excluded priority entries', () => {
    for (const countsInQuota of [true, false]) {
        const state = E.initial(); state.settings.carryOverCountsInNewCount = countsInQuota;
        state.settings.newBookUnits = {book1: ['unit2'], book2: []};
        state.priorityWords = ['alpha', 'bravo', 'delta'];
        E.record(state, alpha).notebook = 'priority';
        const session = P.startNew(state, words, books, {book1: 1, book2: 1}, day(8));
        assert.deepEqual(session.words, ['bravo']);
        assert.deepEqual(session.carriedOverWords, ['bravo']);
        assert.deepEqual(state.priorityWords, ['alpha', 'delta']);
        assert.equal(state.records.alpha.notebook, 'priority');
        assert.deepEqual(session.quotaShortfalls, countsInQuota ? {book2: {requested: 1, actual: 0}} : {book1: {requested: 1, actual: 0}, book2: {requested: 1, actual: 0}});
    }
});
test('zero quotas can add eligible extra returnees but never range-excluded returnees', () => {
    const state = E.initial(); state.settings.carryOverCountsInNewCount = false;
    state.settings.newBookUnits = {book1: ['unit1'], book2: ['unit2']};
    state.priorityWords = ['delta', 'echo'];
    const selected = P.selectNew(state, words, books, {book1: 1, book2: 0});
    assert.deepEqual(selected.words.map(word => word.id), ['alpha', 'echo']);
    state.settings.newBookUnits.book2 = [];
    assert.deepEqual(P.selectNew(state, words, books, {book1: 1, book2: 0}).words.map(word => word.id), ['alpha']);
});
test('mastered and already extracted words remain excluded within unit ranges', () => {
    const state = E.initial(); state.settings.newBookUnits = {book1: ['unit2'], book2: ['unit2']};
    E.record(state, bravo).notebook = 'mastered'; state.extracted.echo = {date: '2026-10-08', book: 'book2'};
    assert.deepEqual(P.availableCounts(state, words, books), {book1: 0, book2: 0});
});
test('custom books honor empty or selected unit ranges', () => {
    const custom = {id: 'custom', units: ['导入词表']}, imported = word('imported', 'custom', '导入词表');
    const state = E.initial(); state.settings.newBookUnits.custom = [];
    assert.equal(P.selectNew(state, [imported], [custom], {custom: 1}).words.length, 0);
    state.settings.newBookUnits.custom = ['导入词表'];
    assert.equal(P.selectNew(state, [imported], [custom], {custom: 1}).words.length, 1);
});
test('range snapshots and backups preserve active lists across range changes and rollover', () => {
    const state = E.initial(); state.settings.newBookUnits = {book1: ['unit2']};
    const session = P.startNew(state, words, books, {book1: 1}, day(8));
    state.settings.newBookUnits.book1 = ['unit1'];
    assert.deepEqual(session.unitRanges, {book1: ['unit2']});
    assert.deepEqual(session.words, ['bravo']);
    const restored = E.clone(state); P.validate(restored, new Set(words.map(word => word.id)));
    assert.deepEqual(restored.settings.newBookUnits, {book1: ['unit1']});
    P.settleCrossDay(restored, day(9));
    assert.deepEqual(restored.priorityWords, ['bravo']);
    assert.deepEqual(P.startNew(restored, words, books, {book1: 1}, day(9)).words, ['alpha']);
    assert.deepEqual(restored.priorityWords, ['bravo']);
});
test('backup validation rejects malformed new-study ranges without losing explicit empty selections', () => {
    for (const malformed of [null, [], {book1: 'unit1'}, {book1: [5]}, {book1: ['']}, {book1: ['unit1', 'unit1']}]) {
        const state = E.initial(); state.settings.newBookUnits = malformed;
        assert.throws(() => P.validate(state, new Set(words.map(word => word.id))), /新学单元范围/);
    }
    const state = E.initial(); state.settings.newBookUnits = {book1: []};
    P.validate(state, new Set(words.map(word => word.id)));
    assert.deepEqual(state.settings.newBookUnits, {book1: []});
});

