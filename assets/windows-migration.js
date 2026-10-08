(function (scope) {
    'use strict';
    const E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : scope.Engine;
    const P = typeof module !== 'undefined' && module.exports ? require('./study-plan.js') : scope.StudyPlan;
    const kindMap = {new: 'new', list_review: 'review', problem_review: 'problem', free: 'free', review: 'review', problem: 'problem'};
    function classify(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        if (data.schema === 'z-windows-migration' && data.version === 1) return 'bundle';
        if (data.version === 1 && data.settings && Array.isArray(data.words) && Array.isArray(data.lists)) return 'study';
        if (data.version === 1 && Array.isArray(data.records) && Array.isArray(data.recent) && !data.schema) return 'notebook';
        return null;
    }
    function time(value) {
        if (value === undefined || value === null || value === '') return 0;
        const match = typeof value === 'string' && /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
        const result = match ? Number(match[1]) : typeof value === 'number' ? value : Date.parse(value);
        if (!Number.isFinite(result)) throw Error('Windows 记录含无效日期');
        return result > 0 ? result : 0;
    }
    function amount(value, fallback = 0) {
        if (value === undefined || value === null) return fallback;
        if (!Number.isSafeInteger(value) || value < 0) throw Error('Windows 记录含无效计数');
        return value;
    }
    function day(value, fallback) {
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const parsed = new Date(value + 'T00:00:00Z');
            if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return value;
        }
        if (fallback) return new Date(fallback).toISOString().slice(0, 10);
        throw Error('Windows 列表缺少有效学习日期');
    }
    function plusDays(value, count) {
        const date = new Date(value + 'T00:00:00Z');
        date.setUTCDate(date.getUTCDate() + count);
        return date.toISOString().slice(0, 10);
    }
    function convert(input, catalog, now = Date.now()) {
        if (!input || classify(input.study) !== 'study' || classify(input.notebook) !== 'notebook') throw Error('需要同时提供 study_state.json 和 notebook_state.json');
        if (!catalog || !Array.isArray(catalog.words) || !Array.isArray(catalog.books)) throw Error('安卓词书不可用');
        const study = E.clone(input.study), notebook = E.clone(input.notebook);
        const state = E.initial(), warnings = new Set();
        const dictionary = new Map(catalog.words.map(word => [word.id, E.clone(word)]));
        const custom = new Map(), listMap = new Map();
        function wordId(word, source) {
            if (!word || typeof word.english !== 'string' || !word.english.trim() || typeof word.chinese !== 'string') throw Error('Windows 词条格式无效');
            const id = E.normalize(E.clean(word.english));
            if (['__proto__', 'constructor', 'prototype'].includes(id)) throw Error('不支持的词条标识');
            if (!dictionary.has(id)) {
                const entry = {id, english: word.english, chinese: word.chinese, examples: word.examples || '', pos: word.partOfSpeech || '', phonetic: word.phonetic || '', sources: [{book: 'windows-import', unit: '导入词表'}]};
                dictionary.set(id, entry); custom.set(id, entry);
            }
            if (source?.book && source?.unit && catalog.books.some(book => book.id === source.book && book.units.includes(source.unit))) {
                const sources = dictionary.get(id).sources;
                if (!sources.some(item => item.book === source.book && item.unit === source.unit)) sources.push({book: source.book, unit: source.unit});
            }
            return id;
        }
        const settings = study.settings;
        for (const key of ['listCount', 'problemCount']) if (settings[key] !== undefined) state.settings[key] = Math.min(amount(settings[key]), 10000);
        for (const key of ['randomExtraction', 'allowOverlap', 'reviewDueOnly', 'carryOverCountsInNewCount', 'carryOverPreview']) {
            if (settings[key] !== undefined) {
                if (typeof settings[key] !== 'boolean') throw Error('Windows 每日计划开关无效');
                state.settings[key] = settings[key];
            }
        }
        if (settings.defaultBookCounts !== undefined) {
            if (!settings.defaultBookCounts || typeof settings.defaultBookCounts !== 'object' || Array.isArray(settings.defaultBookCounts)) throw Error('Windows 默认配额无效');
            state.settings.defaultBookCounts = Object.fromEntries(Object.entries(settings.defaultBookCounts).filter(([id]) => catalog.books.some(book => book.id === id)).map(([id, count]) => [id, Math.min(amount(count), 10000)]));
        }
        for (const [from, to] of [['newCount', 'newCount'], ['exampleCorrectTarget', 'exampleTarget'], ['dictationCorrectTarget', 'dictationTarget'], ['spellingCorrectTarget', 'spellingTarget']]) {
            if (settings[from] !== undefined) state.settings[to] = Math.min(amount(settings[from]), to.endsWith('Count') ? 10000 : 1000);
        }
        for (const [from, to] of [['fuzzyAnswers', 'fuzzy'], ['exampleFirstLetterHints', 'firstLetter'], ['freeRetryOnWrong', 'retry']]) {
            if (settings[from] !== undefined) {
                if (typeof settings[from] !== 'boolean') throw Error('Windows 设置格式无效');
                state.settings[to] = settings[from];
            }
        }
        if (settings.reviewDays !== undefined) {
            if (!Array.isArray(settings.reviewDays) || !settings.reviewDays.length || settings.reviewDays.some(value => !Number.isInteger(value) || value < 0 || value > 365)) throw Error('Windows 复习间隔无效');
            state.settings.reviewDays = settings.reviewDays.slice();
        }
        for (const [kind, prefix] of [['new', 'new'], ['review', 'list'], ['problem', 'problem'], ['free', 'free']]) {
            const config = state.settings.modules[kind];
            const hasModes = E.modes.some(mode => settings[prefix + mode[0].toUpperCase() + mode.slice(1)] !== undefined);
            if (hasModes) {
                config.modes = E.modes.filter(mode => {
                    const value = settings[prefix + mode[0].toUpperCase() + mode.slice(1)];
                    if (value !== undefined && typeof value !== 'boolean') throw Error('Windows 题型设置无效');
                    return value === true;
                });
                if (!config.modes.length) { config.modes = ['spelling']; warnings.add('未启用题型的模块改为拼写，避免无法练习。'); }
            }
            const order = settings[prefix + 'TaskOrder'];
            if (order !== undefined) {
                if (!Array.isArray(order) || order.some(mode => !E.modes.includes(mode))) throw Error('Windows 题型顺序无效');
                config.taskOrder = [...new Set([...order, ...E.modes])];
            }
            const rawOrder = settings[prefix + 'QuestionOrder'];
            const questionOrder = ({unit_random: 'unitRandom', book_random: 'bookRandom'})[rawOrder] || rawOrder;
            if (questionOrder && !['sequential', 'unitRandom', 'bookRandom'].includes(questionOrder)) warnings.add('部分 Windows 随机顺序设置不能对应，使用安卓顺序练习。');
            config.order = ['sequential', 'unitRandom', 'bookRandom'].includes(questionOrder) ? questionOrder : 'sequential';
        }
        if (catalog.books.some(book => book.id === settings.freeBook)) {
            state.settings.book = settings.freeBook;
            if (Array.isArray(settings.freeUnits)) state.settings.units = settings.freeUnits.filter(unit => catalog.books.find(book => book.id === settings.freeBook).units.includes(unit));
        }
        for (const entry of study.words) {
            const id = wordId(entry.word, entry), item = E.record(state, dictionary.get(id));
            const extracted = time(entry.firstExtractedAt);
            if (extracted) state.extracted[id] = {date: day(undefined, extracted), book: entry.book || ''};
            if (entry.acceptedAnswers !== undefined && (!Array.isArray(entry.acceptedAnswers) || entry.acceptedAnswers.some(answer => typeof answer !== 'string'))) throw Error('Windows 自定义答案格式无效');
            item.aliases = [...new Set([...item.aliases, ...(entry.acceptedAnswers || []).map(E.normalize).filter(Boolean)])];
        }
        const notebookIds = new Set();
        for (const entry of notebook.records) {
            const id = wordId(entry.word);
            if (notebookIds.has(id)) throw Error('Windows 词本有重复词条，请先在 Windows 版整理后导出');
            notebookIds.add(id);
            if (!['none', 'wrong', 'error_prone', 'mastered'].includes(entry.notebook)) throw Error('Windows 词本分类无效');
            const item = E.record(state, dictionary.get(id));
            item.notebook = entry.notebook === 'error_prone' ? 'prone' : entry.notebook;
            item.errors = amount(entry.errorCount);
            item.counts = {example: amount(entry.exampleCorrectCount), dictation: amount(entry.dictationCorrectCount), spelling: amount(entry.spellingCorrectCount)};
            item.edited = time(entry.lastEditedAt) || time(entry.lastAnsweredAt);
            item.lastAnswered = time(entry.lastAnsweredAt);
            if (entry.correctCount && E.modes.every(mode => entry[mode + 'CorrectCount'] === undefined)) warnings.add('只有总答对次数的旧记录未推断各题型次数，原值保留在迁移来源中。');
        }
        for (const entry of study.priorityWords || []) {
            const id = wordId(entry.word || entry), item = E.record(state, dictionary.get(id));
            state.priorityWords.push(id);
            if (item.notebook === 'none') item.notebook = 'priority';
        }
        function checkList(list) {
            if (!list || typeof list.id !== 'string' || !list.id || !kindMap[list.kind] || !['active', 'completed', 'ended', 'settled'].includes(list.status) || !Array.isArray(list.items) || !Array.isArray(list.history) || !Array.isArray(list.tasks)) throw Error('Windows 学习列表格式无效');
            list.items.forEach(item => wordId(item.word, {book: item.sourceBook, unit: item.sourceUnit}));
            for (const task of [...list.history, ...list.tasks, ...(list.retries || [])]) {
                wordId(task.word);
                if (!E.modes.includes(task.mode)) throw Error('Windows 列表含不支持的题型');
            }
        }
        for (const list of study.lists) {
            checkList(list);
            if (listMap.has(list.id)) throw Error('Windows 学习列表 ID 重复');
            listMap.set(list.id, list);
        }
        for (const list of input.lists || []) {
            checkList(list);
            if (listMap.has(list.id)) {
                if (JSON.stringify(listMap.get(list.id)) !== JSON.stringify(list)) warnings.add('study_lists 中同名列表与主记录不同，迁移采用 study_state.json 的版本，原文件另行保留。');
            } else listMap.set(list.id, E.clone(list));
        }
        const allLists = [...listMap.values()].sort((first, second) => time(first.createdAt) - time(second.createdAt));
        const learnedDates = new Map();
        for (const list of allLists) {
            const created = time(list.createdAt), date = day(list.studyDate, created), kind = kindMap[list.kind];
            const ids = [...new Set(list.items.map(item => wordId(item.word)))];
            const attempts = [], seen = new Set();
            for (const task of [...list.history, ...list.tasks]) {
                const answeredAt = time(task.answeredAt);
                if (!answeredAt || task.skipped || task.mastered) continue;
                if (typeof task.correct !== 'boolean') throw Error('Windows 答题结果无效');
                const id = wordId(task.word);
                const key = JSON.stringify([id, task.mode, answeredAt, task.replay, task.attempt, task.submittedAnswer]);
                if (seen.has(key)) continue;
                seen.add(key);
                const attempt = {date, time: answeredAt, session: 'windows-' + list.id, word: id, mode: task.mode, correct: task.correct, retry: !!task.replay};
                attempts.push(attempt); state.attempts.push(attempt);
            }
            for (const item of list.items) {
                const id = wordId(item.word);
                if (item.mastered && !notebookIds.has(id)) E.record(state, dictionary.get(id)).notebook = 'mastered';
                if (item.released) { learnedDates.delete(id); delete state.extracted[id]; continue; }
                if (kind === 'free' || (!item.mastered && !E.modes.every(mode => !state.settings.modules[kind].modes.includes(mode) || item[mode + 'Complete'] === true))) continue;
                const previous = learnedDates.get(id);
                const stage = Math.min(previous ? previous.stage + (kind === 'review' ? 1 : 0) : 0, state.settings.reviewDays.length - 1);
                learnedDates.set(id, {date: previous?.date || date, last: date, stage, due: plusDays(date, state.settings.reviewDays[stage])});
            }
            const summary = {id: 'windows-' + list.id, kind, date, words: ids, tasks: [], total: attempts.length, completed: [], counted: [], cursor: 0, phase: 'quiz', preview: 0, previewStage: 0, previewSpoken: [], paused: true, input: '', hint: 0, feedback: null, elapsed: amount(list.activeMilliseconds), correct: attempts.filter(item => item.correct).length, answered: attempts.length, retry: kind === 'free' ? state.settings.retry : true, config: E.clone(state.settings.modules[kind]), created, complete: list.status === 'completed', finished: Math.max(created, ...attempts.map(item => item.time))};
            summary.status = list.status;
            summary.releasedWords = list.items.filter(item => item.released).map(item => wordId(item.word));
            summary.retainedWords = ids.filter(id => !summary.releasedWords.includes(id));
            summary.sourceBooks = Object.fromEntries(list.items.map(item => [wordId(item.word), item.sourceBook || '']));
            if (list.status !== 'active') state.sessions.push(summary);
            else if (list.id === study.activeListId) {
                const pending = list.items.filter(item => !item.released && !item.mastered && state.records[wordId(item.word)]?.notebook !== 'mastered');
                if (pending.length) {
                    const config = {...E.clone(state.settings.modules[kind]), order: 'sequential'};
                    E.start(state, pending.map(item => dictionary.get(wordId(item.word))), kind, config);
                    const active = state.active;
                    Object.assign(active, {id: summary.id, date, created, elapsed: summary.elapsed, correct: summary.correct, answered: summary.answered, paused: true, input: typeof list.pausedInput === 'string' ? list.pausedInput : ''});
                    active.sourceBooks = summary.sourceBooks;
                    active.carriedOverWords = pending.filter(item => item.carriedOver).map(item => wordId(item.word));
                    active.carryOverPreview = state.settings.carryOverPreview;
                    if (list.phase === 'preview' && kind === 'new') {
                        const cursor = amount(list.previewCursor);
                        if (cursor >= list.items.length) throw Error('Windows 新词预览位置无效');
                        const current = wordId(list.items[cursor].word);
                        active.preview = Math.max(0, active.words.indexOf(current));
                        warnings.add('未完成新词列表保留当前词位置，展示层从第一层开始；朗读状态重新计算。');
                    } else {
                        active.phase = 'quiz';
                        const items = new Map(pending.map(item => [wordId(item.word), item]));
                        active.completed = active.tasks.filter(task => items.get(task.word)?.[task.mode + 'Complete']).map(task => task.key);
                        active.counted = [...new Set(attempts.filter(item => !item.retry).map(item => item.word + '|' + item.mode))];
                        active.tasks = active.tasks.filter(task => !active.completed.includes(task.key));
                        active.total = active.tasks.length + active.completed.length;
                        active.cursor = 0; active.input = '';
                        warnings.add('未完成答题列表按未完成题型重建队列，原输入、反馈和随机顺序不直接恢复。');
                        if (!active.tasks.length) { state.active = null; state.sessions.push({...summary, complete: false}); }
                    }
                } else state.sessions.push({...summary, complete: false});
            } else {
                state.sessions.push({...summary, complete: false});
                warnings.add('非当前的活动列表保留为未完成历史，可从历史列表重新复习。');
            }
        }
        if (study.activeListId && !allLists.some(list => list.id === study.activeListId && list.status === 'active')) throw Error('Windows 当前列表缺失或状态不一致');
        state.learned = Object.fromEntries(learnedDates);
        state.attempts.sort((first, second) => first.time - second.time);
        if (custom.size) state.customBooks.push({id: 'windows-import', name: 'Windows 迁移词条', words: [...custom.values()]});
        warnings.add('复习日期根据完成列表与安卓复习间隔重新计算，不保证与 Windows 到期算法完全一致。');
        warnings.add('Windows 快捷键、撤销栈、界面外观和未提供的自由练习记录不迁移为安卓功能；提供的原始数据保留在备份迁移来源中。');
        const summary = {notebookRecords: notebook.records.length, learnedWords: Object.keys(state.learned).length, wrong: Object.values(state.records).filter(item => item.notebook === 'wrong').length, prone: Object.values(state.records).filter(item => item.notebook === 'prone').length, mastered: Object.values(state.records).filter(item => item.notebook === 'mastered').length, historicalLists: state.sessions.length, activeWords: state.active?.words.length || 0, activePreview: state.active?.phase === 'preview' ? state.active.preview + 1 : null, attempts: state.attempts.length, correct: state.attempts.filter(item => item.correct).length, elapsed: state.sessions.reduce((sum, item) => sum + item.elapsed, 0) + (state.active?.elapsed || 0), customWords: custom.size};
        state.migration = {version: 1, from: 'windows', importedAt: now, summary, warnings: [...warnings], source: {study, notebook, lists: E.clone(input.lists || [])}};
        P.validate(state, new Set(dictionary.keys()));
        return {state, summary, warnings: [...warnings]};
    }
    const api = {classify, convert, time};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else scope.WindowsMigration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
