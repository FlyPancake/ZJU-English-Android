'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../assets/engine.js');
const word = {id: 'sprawl', english: 'sprawl', chinese: '蔓延', examples: 'He was [[sprawling]] on the sofa.；The town [[sprawls]] along the lake.', sources: [{book: 'book2', unit: 'unit1-1'}]};
const config = {modes: ['example', 'dictation', 'spelling'], order: 'sequential', taskOrder: E.modes};
test('CSV supports quoted commas, escaped quotes, BOM and multiline cells', () => {
    const rows = E.csv('\uFEFFenglish,chinese,examples\r\nhello,"你,好","He said ""hello"".\nAgain."');
    assert.equal(rows[0].chinese, '你,好'); assert.equal(rows[0].examples, 'He said "hello".\nAgain.');
    assert.throws(() => E.csv('english,chinese\nhello,"broken'));
});
test('examples use inflected forms and keep all distinct sentences', () => {
    const questions = E.examples(word); assert.equal(questions.length, 2);
    assert.equal(questions[0].answer, 'sprawling'); assert.equal(questions[1].answer, 'sprawls');
    assert.equal(E.examples({...word, english: 'take', examples: 'He [[took]] [[pictures]].'})[0].answer, 'took');
    assert.equal(E.examples({...word, english: 'take off', examples: 'He [[took]] his coat [[off]].'})[0].answer, 'took his coat off');
    assert.equal(E.examples({...word, english: 'run', examples: 'He [[went]] there.'})[0].answer, 'went');
});
test('wrong answers do not advance completion; retry is appended', () => {
    const state = E.initial(); E.start(state, [word], 'free', config);
    assert.equal(state.active.total, 4);
    E.submit(state, word, 'sprawl'); assert.equal(state.records.sprawl.notebook, 'wrong');
    assert.equal(state.active.completed.length, 0); assert.equal(state.active.tasks.length, 5);
    E.advance(state);
    while (state.active.cursor < 4) { E.submit(state, word, state.active.tasks[state.active.cursor].answer); E.advance(state); }
    E.submit(state, word, 'SPRAWLING'); assert.equal(state.active.completed.length, 4);
    assert.equal(state.records.sprawl.counts.example, 0);
    assert.equal(E.advance(state), true); E.finish(state, true);
    assert.equal(state.active, null); assert.equal(state.sessions[0].answered, 5);
});
test('three thresholds jointly gate wrong-to-prone; no auto mastering', () => {
    const state = E.initial(); Object.assign(state.settings, {exampleTarget: 1, dictationTarget: 1, spellingTarget: 1});
    E.record(state, word).notebook = 'wrong'; E.start(state, [word], 'problem', config);
    for (let index = 0; index < 3; index++) { E.submit(state, word, state.active.tasks[state.active.cursor].answer); E.advance(state); assert.equal(state.records.sprawl.notebook, 'wrong'); }
    E.submit(state, word, 'sprawl'); assert.equal(state.records.sprawl.notebook, 'prone'); assert.equal(state.records.sprawl.counts.example, 1);
});
test('partial early finish learns only fully completed words', () => {
    const other = {...word, id: 'hello', english: 'hello', examples: ''};
    const state = E.initial(); E.start(state, [word, other], 'new', {modes: ['spelling'], order: 'sequential', taskOrder: E.modes});
    E.submit(state, word, 'sprawl'); E.finish(state, false);
    assert.ok(state.learned.sprawl); assert.equal(state.learned.hello, undefined); assert.equal(state.sessions[0].complete, false);
});
test('mastered words are excluded; restore preserves input and hint and pauses', () => {
    const state = E.initial(); E.record(state, word).notebook = 'mastered'; assert.throws(() => E.start(state, [word], 'free', config));
    state.records.sprawl.notebook = 'wrong'; E.start(state, [word], 'free', config); state.active.input = 'spra'; state.active.hint = 2;
    const restored = E.validate(E.clone(state), new Set([word.id]));
    assert.equal(restored.active.input, 'spra'); assert.equal(restored.active.hint, 2); assert.equal(restored.active.paused, true);
    const broken = E.clone(state); broken.active.tasks[0].word = 'missing'; assert.throws(() => E.validate(broken, new Set([word.id])));
});
test('free retry can be disabled; strict and custom answers differ', () => {
    const state = E.initial(); state.settings.retry = false; E.start(state, [word], 'free', {modes: ['spelling'], order: 'sequential', taskOrder: E.modes});
    E.record(state, word).aliases = ['spread']; assert.equal(E.accepted(state, word, state.active.tasks[0], 'spread'), false);
    state.settings.fuzzy = true; assert.equal(E.accepted(state, word, state.active.tasks[0], 'spread'), true);
    E.submit(state, word, 'wrong'); assert.equal(state.active.tasks.length, 1); assert.equal(E.advance(state), true);
});
test('bundled words retain POS and all 32 units', () => {
    const data = require('../assets/data.json'); assert.equal(data.books.length, 2); assert.equal(data.books.flatMap(book => book.units).length, 32);
    assert.equal(data.words.length, 1544); assert.ok(data.words.filter(item => item.pos).length > 1000);
    const grouped = data.words.find(item => item.id === 'sprawl'); assert.ok(grouped.chinese.includes('\n')); assert.ok(E.examples(grouped).length >= 2);
});
test('new words reveal one layer at a time; navigation resets the layer', () => {
    const state = E.initial(); const other = {...word, id: 'hello', english: 'hello'};
    E.start(state, [word, other], 'new', config);
    assert.equal(state.active.previewStage, 0);
    E.movePreview(state, 1); assert.equal(state.active.preview, 0);
    assert.equal(E.revealPreview(state), 1); E.movePreview(state, 1); assert.equal(state.active.preview, 0);
    assert.equal(E.revealPreview(state), 2);
    E.movePreview(state, 1); assert.equal(state.active.preview, 1); assert.equal(state.active.previewStage, 0);
    E.revealPreview(state); E.movePreview(state, -1); assert.equal(state.active.preview, 0); assert.equal(state.active.previewStage, 0);
});
test('preview layer survives restore; old backups default to first layer', () => {
    const state = E.initial(); E.start(state, [word], 'new', config); E.revealPreview(state);
    const restored = E.validate(E.clone(state), new Set([word.id]));
    assert.equal(restored.active.previewStage, 1); assert.equal(restored.active.paused, true);
    const legacy = E.clone(state); delete legacy.active.previewStage;
    assert.equal(E.validate(legacy, new Set([word.id])).active.previewStage, 0);
    const invalid = E.clone(state); invalid.active.previewStage = 3;
    assert.throws(() => E.validate(invalid, new Set([word.id])));
});
test('bundled phonetics are offline and missing entries are not fabricated', () => {
    const data = require('../assets/data.json');
    const entrepreneur = data.words.find(item => item.id === 'entrepreneur');
    assert.ok(entrepreneur.phonetic); assert.equal(entrepreneur.phoneticSource, 'dictionary');
    assert.ok(data.words.filter(item => item.phonetic).length > 1400);
    assert.ok(data.words.some(item => item.phoneticSource === 'components'));
});
test('mastering during preview immediately advances and excludes every task for the word', () => {
    const state = E.initial(), other = {...word, id: 'hello', english: 'hello'};
    E.start(state, [word, other], 'new', config);
    assert.equal(E.masterWord(state, word), false);
    assert.equal(state.active.preview, 1); assert.equal(state.active.previewStage, 0);
    assert.equal(state.records[word.id].notebook, 'mastered');
    assert.ok(state.active.tasks.filter(task => task.word === word.id).every(task => state.active.completed.includes(task.key)));
    assert.equal(state.attempts.length, 0);
    E.movePreview(state, -1); assert.equal(state.active.preview, 1);
    assert.equal(E.masterWord(state, other), true);
    E.finish(state, true); assert.equal(state.active, null);
});
test('mastering last preview enters quiz for earlier unmastered words', () => {
    const state = E.initial(), other = {...word, id: 'hello', english: 'hello'};
    E.start(state, [word, other], 'new', config);
    E.revealPreview(state); E.revealPreview(state); E.movePreview(state, 1);
    assert.equal(E.masterWord(state, other), false);
    assert.equal(state.active.phase, 'quiz');
    assert.equal(state.active.tasks[state.active.cursor].word, word.id);
});
test('mastering in quiz removes all modes and retries without adding attempts or errors', () => {
    const state = E.initial(), other = {...word, id: 'hello', english: 'hello'};
    E.start(state, [word, other], 'free', config);
    E.submit(state, word, 'incorrect'); E.advance(state);
    const attempts = state.attempts.length, errors = state.records[word.id].errors;
    E.masterWord(state, word);
    while (state.active.cursor < state.active.tasks.length) {
        const task = state.active.tasks[state.active.cursor]; assert.notEqual(task.word, word.id);
        E.submit(state, other, task.answer); if (E.advance(state)) break;
    }
    assert.equal(state.attempts.filter(attempt => attempt.word === word.id).length, attempts);
    assert.equal(state.records[word.id].errors, errors);
});
test('old sessions stuck on a mastered preview recover to the next word', () => {
    const state = E.initial(), other = {...word, id: 'hello', english: 'hello'};
    E.start(state, [word, other], 'new', config);
    E.record(state, word).notebook = 'mastered'; state.active.previewStage = 1;
    assert.equal(E.skipMastered(state), false); assert.equal(state.active.preview, 1); assert.equal(state.active.previewStage, 0);
});
test('new words auto speak once, and example/spelling tasks never auto speak', () => {
    const state = E.initial(), other = {...word, id: 'hello', english: 'hello'};
    E.start(state, [word, other], 'new', config);
    assert.equal(E.automaticSpeech(state).word, word.id);
    E.markPreviewSpoken(state, word.id); assert.equal(E.automaticSpeech(state), null);
    E.revealPreview(state); E.revealPreview(state); E.movePreview(state, 1);
    assert.equal(E.automaticSpeech(state).word, other.id);
    E.markPreviewSpoken(state, other.id); E.movePreview(state, -1); assert.equal(E.automaticSpeech(state), null);
    state.active.phase = 'quiz';
    for (let index = 0; index < state.active.tasks.length; index++) {
        state.active.cursor = index;
        assert.equal(E.automaticSpeech(state)?.mode || null, state.active.tasks[index].mode === 'dictation' ? 'dictation' : null);
    }
});
test('preview spoken status survives restore and settings do not disable dictation', () => {
    const state = E.initial(); E.start(state, [word], 'new', config); E.markPreviewSpoken(state, word.id);
    const restored = E.validate(E.clone(state), new Set([word.id])); restored.active.paused = false;
    assert.equal(E.automaticSpeech(restored), null);
    state.settings.autoSpeak = false; state.active.phase = 'quiz';
    state.active.cursor = state.active.tasks.findIndex(task => task.mode === 'dictation');
    assert.equal(E.automaticSpeech(state).mode, 'dictation');
    state.active.paused = true; assert.equal(E.automaticSpeech(state), null);
    const legacy = E.clone(restored); delete legacy.active.previewSpoken;
    assert.deepEqual(E.validate(legacy, new Set([word.id])).active.previewSpoken, []);
});
