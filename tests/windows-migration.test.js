'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../assets/engine.js');
const M = require('../assets/windows-migration.js');
const word = {english: 'hello', chinese: '你好', examples: 'Say [[hello]].', partOfSpeech: 'n.'};
const stamp = '/Date(1791433754595)/';
const catalog = {books: [{id: 'book2', units: ['unit1-1']}], words: [{id: 'hello', ...word, sources: [{book: 'book2', unit: 'unit1-1'}]}]};
function fixture() {
    const task = {word, mode: 'spelling', answeredAt: stamp, correct: true, replay: false, attempt: 1, submittedAnswer: 'hello'};
    const list = {id: 'sample', kind: 'new', createdAt: stamp, studyDate: '2026-10-08', status: 'completed', phase: 'done', items: [{word, sourceBook: 'book2', sourceUnit: 'unit1-1', exampleComplete: true, dictationComplete: true, spellingComplete: true}], history: [task], tasks: [task], activeMilliseconds: 1000};
    return {study: {version: 1, settings: {newCount: 30, newExample: false, newDictation: false, newSpelling: true, reviewDays: [1, 3, 7, 14]}, words: [{word, book: 'book2', unit: 'unit1-1', acceptedAnswers: ['hi']}], lists: [list], priorityWords: [], activeListId: null}, notebook: {version: 1, records: [{word, notebook: 'wrong', errorCount: 2, exampleCorrectCount: 1, dictationCorrectCount: 2, spellingCorrectCount: 3, lastEditedAt: stamp}], recent: [word]}, lists: [E.clone(list)]};
}
test('preserves categories, counters, aliases, learned words, dates and elapsed time without duplicate list/task counts', () => {
    const input = fixture(), before = JSON.stringify(input);
    const {state, summary} = M.convert(input, catalog, 123);
    assert.equal(JSON.stringify(input), before);
    assert.equal(summary.attempts, 1); assert.equal(summary.historicalLists, 1); assert.equal(summary.elapsed, 1000);
    assert.equal(state.records.hello.notebook, 'wrong'); assert.equal(state.records.hello.errors, 2);
    assert.deepEqual(state.records.hello.counts, {example: 1, dictation: 2, spelling: 3});
    assert.deepEqual(state.records.hello.aliases, ['hi']);
    assert.deepEqual(state.learned.hello, {date: '2026-10-08', last: '2026-10-08', stage: 0, due: '2026-10-09'});
    assert.equal(state.migration.importedAt, 123); assert.deepEqual(state.migration.source.study, input.study);
    assert.deepEqual(state.settings.modules.new.modes, ['spelling']);
    assert.equal(E.validate(state, new Set(['hello'])), state);
});
test('distinguishes extracted words from completed words and resumes a paused preview', () => {
    const input = fixture(), list = input.study.lists[0]; input.lists = [];
    Object.assign(list, {status: 'active', phase: 'preview', previewCursor: 0, previewStage: 2, history: [], tasks: []});
    Object.assign(list.items[0], {exampleComplete: false, dictationComplete: false, spellingComplete: false});
    input.study.activeListId = list.id;
    const {state, summary} = M.convert(input, catalog);
    assert.equal(summary.learnedWords, 0); assert.equal(summary.activeWords, 1); assert.equal(summary.activePreview, 1);
    assert.equal(state.active.phase, 'preview'); assert.equal(state.active.previewStage, 0); assert.equal(state.active.paused, true);
    assert.deepEqual(state.active.previewSpoken, []); assert.equal(state.active.tasks[0].word, 'hello');
});
test('creates an import book for missing words, retains priority and maps error_prone', () => {
    const input = fixture(); input.notebook.records[0].notebook = 'error_prone';
    input.study.priorityWords = [{english: 'newword', chinese: '新词'}];
    const result = M.convert(input, catalog);
    assert.equal(result.state.records.hello.notebook, 'prone');
    assert.equal(result.state.records.newword.notebook, 'priority');
    assert.equal(result.summary.customWords, 1); assert.equal(result.state.customBooks[0].words[0].id, 'newword');
    E.validate(result.state, new Set(['hello', 'newword']));
});
test('does not treat ended, released or incomplete items as learned; mastered words stay mastered', () => {
    const input = fixture(); input.study.lists[0].status = 'ended'; input.lists = [];
    input.study.lists[0].items[0].released = true;
    input.notebook.records[0].notebook = 'mastered';
    const result = M.convert(input, catalog);
    assert.equal(result.summary.learnedWords, 0); assert.equal(result.summary.mastered, 1);
    assert.equal(result.state.sessions[0].complete, false);
});
test('rebuilds an unfinished quiz from remaining modes without recounting first attempts', () => {
    const input = fixture(), list = input.study.lists[0]; input.lists = [];
    input.study.settings.newExample = true; input.study.settings.newDictation = true;
    Object.assign(list, {status: 'active', phase: 'quiz'});
    Object.assign(list.items[0], {exampleComplete: false, dictationComplete: false, spellingComplete: true});
    input.study.activeListId = list.id;
    const {state} = M.convert(input, catalog);
    assert.deepEqual(state.active.tasks.map(task => task.mode), ['example', 'dictation']);
    assert.deepEqual(state.active.counted, ['hello|spelling']); assert.equal(state.active.paused, true);
});
test('validates malformed, unrelated and missing-current-list input without mutating it', () => {
    assert.equal(M.classify(E.initial()), null); assert.equal(M.classify(fixture().notebook), 'notebook');
    assert.throws(() => M.convert({study: fixture().study}, catalog));
    const input = fixture(); input.notebook.records[0].errorCount = -1;
    const before = JSON.stringify(input); assert.throws(() => M.convert(input, catalog)); assert.equal(JSON.stringify(input), before);
    const missing = fixture(); missing.study.activeListId = 'missing'; assert.throws(() => M.convert(missing, catalog));
    const bad = fixture(); bad.study.lists[0].studyDate = '2026-99-99'; bad.study.lists[0].createdAt = 'bad'; assert.throws(() => M.convert(bad, catalog));
});
test('advances review stages, keeps Windows studyDate rather than machine timezone and preserves retry attempts', () => {
    const input = fixture(), review = E.clone(input.study.lists[0]); input.lists = [];
    review.id = 'review'; review.kind = 'list_review'; review.studyDate = '2026-10-09';
    review.createdAt = '/Date(1791520154595)/'; review.history[0].replay = true; review.tasks = [];
    input.study.lists.push(review);
    const {state} = M.convert(input, catalog);
    assert.equal(state.learned.hello.stage, 1); assert.equal(state.learned.hello.due, '2026-10-12');
    assert.equal(state.attempts[1].date, '2026-10-09'); assert.equal(state.attempts[1].retry, true);
});
test('recognizes a bundled export and rejects dangerous word identifiers', () => {
    assert.equal(M.classify({schema: 'z-windows-migration', version: 1}), 'bundle');
    const input = fixture(); input.study.words[0].word = {english: '__proto__', chinese: 'bad'};
    assert.throws(() => M.convert(input, catalog));
});
