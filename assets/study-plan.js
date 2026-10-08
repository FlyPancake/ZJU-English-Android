(function (scope) {
    'use strict';
    const E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : scope.Engine;
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    function normalize(state) {
        const upgrading = state.planVersion !== 1;
        state.settings = {...E.initial().settings, ...state.settings};
        state.extracted = state.extracted || {};
        state.priorityWords = Array.isArray(state.priorityWords) ? [...new Set(state.priorityWords)] : [];
        if (upgrading) {
            const source = state.migration?.source?.study;
            if (source?.settings) {
                for (const key of ['listCount', 'problemCount', 'defaultBookCounts', 'randomExtraction', 'allowOverlap', 'reviewDueOnly', 'carryOverCountsInNewCount', 'carryOverPreview']) {
                    if (source.settings[key] !== undefined) state.settings[key] = E.clone(source.settings[key]);
                }
                for (const entry of source.priorityWords || []) {
                    const id = E.normalize(E.clean((entry.word || entry).english));
                    if (id && !state.priorityWords.includes(id)) state.priorityWords.push(id);
                }
                for (const entry of state.migration.source.notebook?.records || []) {
                    const id = E.normalize(E.clean(entry.word?.english)), match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(entry.lastAnsweredAt || '');
                    if (state.records[id] && match) state.records[id].lastAnswered = Math.max(0, Number(match[1]));
                }
            }
            for (const [id, item] of Object.entries(state.learned)) state.extracted[id] = {date: item.date, book: ''};
        }
        for (const [id, item] of Object.entries(state.records)) if (item.notebook === 'priority' && !state.priorityWords.includes(id)) state.priorityWords.push(id);
        for (const session of state.sessions) {
            if (upgrading && session.created && !session.id.startsWith('windows-')) session.date = E.studyDayKey(new Date(session.created));
            session.status = session.status || (session.complete ? 'completed' : 'ended');
            if (!Array.isArray(session.releasedWords)) session.releasedWords = [];
            if (!Array.isArray(session.retainedWords)) session.retainedWords = session.words.filter(id => !session.releasedWords.includes(id) && (session.kind === 'free' || !upgrading || state.learned[id] || state.records[id]?.notebook === 'mastered'));
        }
        if (state.active) {
            const session = state.active;
            if (upgrading && session.created && !session.id.startsWith('windows-')) session.date = E.studyDayKey(new Date(session.created));
            session.sourceBooks = session.sourceBooks || {};
            if (!Array.isArray(session.carriedOverWords)) session.carriedOverWords = [];
            if (session.carryOverPreview === undefined) session.carryOverPreview = state.settings.carryOverPreview;
            if (upgrading) {
                const original = state.migration?.source?.study?.lists?.find(list => 'windows-' + list.id === session.id);
                if (original) {
                    session.carriedOverWords = original.items.filter(item => item.carriedOver).map(item => E.normalize(E.clean(item.word.english))).filter(id => session.words.includes(id));
                    session.sourceBooks = Object.fromEntries(original.items.map(item => [E.normalize(E.clean(item.word.english)), item.sourceBook || '']));
                }
            }
            if (upgrading && session.kind === 'new') for (const id of session.words) state.extracted[id] = {date: session.date, book: session.sourceBooks[id] || ''};
        }
        if (upgrading) for (const attempt of state.attempts) if (attempt.time && !String(attempt.session).startsWith('windows-')) attempt.date = E.studyDayKey(new Date(attempt.time));
        state.priorityWords = state.priorityWords.filter(id => state.records[id]?.notebook !== 'mastered' && !own(state.extracted, id) && !own(state.learned, id));
        state.planVersion = 1;
        return state;
    }
    function validate(state, wordIds) {
        normalize(state);
        if (state.extracted === null || typeof state.extracted !== 'object' || Array.isArray(state.extracted)) throw Error('备份提取记录无效');
        for (const [id, item] of Object.entries(state.extracted)) if (!wordIds.has(id) || !item || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) throw Error('备份提取记录引用无效');
        if (state.priorityWords.some(id => typeof id !== 'string' || !wordIds.has(id))) throw Error('备份跨日优先词无效');
        for (const session of [...state.sessions, ...(state.active ? [state.active] : [])]) {
            for (const key of ['releasedWords', 'retainedWords', 'carriedOverWords']) if (session[key] !== undefined && (!Array.isArray(session[key]) || session[key].some(id => !session.words.includes(id)))) throw Error('备份列表结算记录无效');
        }
        return E.validate(state, wordIds);
    }
    function quotaDefaults(state, books) {
        normalize(state);
        const defaults = state.settings.defaultBookCounts;
        const hasDefaults = books.some(book => (defaults[book.id] || 0) > 0);
        return Object.fromEntries(books.map((book, index) => [book.id, hasDefaults ? defaults[book.id] || 0 : index === 0 ? state.settings.newCount : 0]));
    }
    function available(state, word) {
        return state.records[word.id]?.notebook !== 'mastered' && !own(state.extracted, word.id) && !own(state.learned, word.id);
    }
    function selectedUnits(state, book) {
        const ranges = state.settings.newBookUnits;
        return own(ranges, book.id) ? book.units.filter(unit => ranges[book.id].includes(unit)) : book.units.slice();
    }
    function inRange(state, word, book) {
        const units = selectedUnits(state, book);
        return word.sources.some(source => source.book === book.id && units.includes(source.unit));
    }
    function availableCounts(state, words, books) {
        normalize(state);
        return Object.fromEntries(books.map(book => [book.id, words.filter(word => available(state, word) && inRange(state, word, book)).length]));
    }
    function selectNew(state, words, books, quotas, random = Math.random) {
        normalize(state);
        if (!quotas || typeof quotas !== 'object' || Array.isArray(quotas) || Object.keys(quotas).some(id => !books.some(book => book.id === id)) || Object.values(quotas).some(value => !Number.isInteger(value) || value < 0 || value > 10000) || !Object.values(quotas).some(value => value > 0)) throw Error('请设置至少一本词书的配额（整数 0–10000）');
        const selected = [], chosen = new Set(), sourceBooks = {}, carriedOverWords = [], quotaShortfalls = {}, unitRanges = {};
        for (const book of books.filter(book => own(quotas, book.id))) {
            const quota = quotas[book.id] || 0;
            unitRanges[book.id] = selectedUnits(state, book);
            const pool = words.filter(word => available(state, word) && !chosen.has(word.id) && inRange(state, word, book));
            const unitIndex = word => Math.min(...word.sources.filter(source => source.book === book.id && unitRanges[book.id].includes(source.unit)).map(source => {
                const index = book.units.indexOf(source.unit); return index < 0 ? book.units.length : index;
            }));
            pool.sort((left, right) => unitIndex(left) - unitIndex(right));
            const byId = new Map(pool.map(word => [word.id, word]));
            const priority = state.priorityWords.map(id => byId.get(id)).filter(Boolean), priorityIds = new Set(priority.map(word => word.id));
            let ordinary = pool.filter(word => !priorityIds.has(word.id));
            if (state.settings.randomExtraction) ordinary = E.shuffle(ordinary, random);
            const batch = state.settings.carryOverCountsInNewCount ? [...priority, ...ordinary].slice(0, quota) : [...priority, ...ordinary.slice(0, quota)];
            const actual = state.settings.carryOverCountsInNewCount ? batch.length : Math.min(ordinary.length, quota);
            if (actual < quota) quotaShortfalls[book.id] = {requested: quota, actual};
            for (const word of batch) {
                selected.push(word); chosen.add(word.id); sourceBooks[word.id] = book.id;
                if (priorityIds.has(word.id)) carriedOverWords.push(word.id);
            }
        }
        return {words: selected, sourceBooks, carriedOverWords, quotas: E.clone(quotas), quotaShortfalls, unitRanges};
    }
    function startNew(state, words, books, quotas, when = new Date(), random = Math.random) {
        settleCrossDay(state, when);
        if (state.active) throw Error('请先继续或结束当前学习列表');
        const selected = selectNew(state, words, books, quotas, random);
        if (!selected.words.length) throw Error('所选新学单元范围内没有可抽取的词，请调整单元范围或配额');
        const session = E.start(state, selected.words, 'new', state.settings.modules.new, when);
        session.unitRanges = selected.unitRanges; session.quotaShortfalls = selected.quotaShortfalls;
        session.carryOverCountsInNewCount = state.settings.carryOverCountsInNewCount;
        session.sourceBooks = selected.sourceBooks; session.carriedOverWords = selected.carriedOverWords; session.quotas = selected.quotas;
        for (const id of session.words) {
            state.extracted[id] = {date: session.date, book: session.sourceBooks[id]};
            if (state.records[id]?.notebook === 'priority') state.records[id].notebook = 'none';
        }
        state.priorityWords = state.priorityWords.filter(id => !session.words.includes(id));
        return session;
    }
    function settleCrossDay(state, when = new Date()) {
        normalize(state);
        const session = state.active, today = E.studyDayKey(when);
        if (!session || session.kind === 'free' || session.date >= today) return null;
        const released = session.words.filter(id => {
            if (state.records[id]?.notebook === 'mastered') return false;
            const required = session.tasks.filter(task => task.word === id && !task.retry);
            return !required.length || required.some(task => !session.completed.includes(task.key));
        });
        E.finish(state, false, when);
        const settled = state.sessions[state.sessions.length - 1];
        settled.status = 'settled'; settled.releasedWords = released; settled.retainedWords = settled.words.filter(id => !released.includes(id));
        for (const id of released) { delete state.extracted[id]; delete state.learned[id]; }
        state.priorityWords = [...released, ...state.priorityWords.filter(id => !released.includes(id))];
        return {id: settled.id, released: released.slice(), retained: settled.retainedWords.slice(), date: settled.date, today};
    }
    function usedToday(state, kind, date) {
        return new Set([...state.sessions, ...(state.active ? [state.active] : [])].filter(session => session.kind === kind && session.date === date).flatMap(session => session.words));
    }
    function reviewPool(state, words, when = new Date()) {
        normalize(state);
        const today = E.studyDayKey(when), used = usedToday(state, 'review', today);
        if (!state.settings.allowOverlap) for (const id of usedToday(state, 'problem', today)) used.add(id);
        const byId = new Map(words.map(word => [word.id, word]));
        const lists = state.sessions.filter(session => session.kind === 'new' && session.date < today && session.retainedWords.some(id => byId.has(id) && state.records[id]?.notebook !== 'mastered' && !used.has(id))).sort((left, right) => right.created - left.created).slice(0, state.settings.listCount).reverse();
        const ids = [...new Set(lists.flatMap(session => session.retainedWords))].filter(id => byId.has(id) && !used.has(id) && state.records[id]?.notebook !== 'mastered');
        return {words: ids.map(id => byId.get(id)), sourceListIds: lists.map(session => session.id)};
    }
    function problemDue(state, item, when = new Date()) {
        const answered = item.lastAnswered || item.edited || 0;
        if (!answered) return true;
        const index = item.notebook === 'wrong' ? item.counts.spelling : state.settings.reviewDays.length - 1;
        const due = new Date(answered); due.setHours(0, 0, 0, 0); due.setDate(due.getDate() + state.settings.reviewDays[Math.min(Math.max(index, 0), state.settings.reviewDays.length - 1)]);
        return due.getTime() <= when.getTime();
    }
    function problemPool(state, words, when = new Date()) {
        normalize(state);
        const today = E.studyDayKey(when), used = usedToday(state, 'problem', today);
        if (!state.settings.allowOverlap) for (const id of usedToday(state, 'review', today)) used.add(id);
        return words.filter(word => ['wrong', 'prone'].includes(state.records[word.id]?.notebook) && !used.has(word.id) && (!state.settings.reviewDueOnly || problemDue(state, state.records[word.id], when))).sort((left, right) => {
            const first = state.records[left.id], second = state.records[right.id];
            return (first.lastAnswered || first.edited || 0) - (second.lastAnswered || second.edited || 0) || second.errors - first.errors;
        }).slice(0, state.settings.problemCount);
    }
    const api = {normalize, validate, quotaDefaults, selectedUnits, availableCounts, selectNew, startNew, settleCrossDay, reviewPool, problemPool, problemDue};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else scope.StudyPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
