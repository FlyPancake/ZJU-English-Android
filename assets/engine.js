(function (scope) {
    'use strict';
    const modes = ['example', 'dictation', 'spelling'];
    const clone = value => JSON.parse(JSON.stringify(value));
    const normalize = value => String(value || '').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
    const clean = value => String(value || '').split(',')[0].trim();
    function dateKey(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function csv(text) {
        const rows = [];
        let row = [], cell = '', quoted = false;
        text = text.replace(/^\uFEFF/, '');
        for (let index = 0; index < text.length; index++) {
            const character = text[index];
            if (character === '"') {
                if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
                else quoted = !quoted;
            } else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
            else if ((character === '\n' || character === '\r') && !quoted) {
                if (character === '\r' && text[index + 1] === '\n') index++;
                row.push(cell); if (row.some(value => value.trim())) rows.push(row);
                row = []; cell = '';
            } else cell += character;
        }
        if (quoted) throw Error('CSV 引号未闭合');
        row.push(cell); if (row.some(value => value.trim())) rows.push(row);
        if (!rows.length) throw Error('CSV 为空');
        const headers = rows.shift().map(value => value.trim().toLowerCase());
        if (!headers.includes('english') || !headers.includes('chinese')) throw Error('CSV 必须包含 english 和 chinese 列');
        return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || '']))).filter(word => word.english.trim());
    }
    function examples(word) {
        return [...new Set(String(word.examples || '').split('；').map(value => value.trim()).filter(Boolean))].flatMap(sentence => {
            const matches = [...sentence.matchAll(/\[\[(.*?)\]\]/g)];
            if (!matches.length) return [];
            const tokens = value => (value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []);
            const heads = tokens(clean(word.english));
            let selected = matches;
            if (matches.length > 1) {
                const related = matches.filter(match => tokens(match[1]).some(token => heads.some(head => sameFamily(head, token))));
                if (!related.length) return [];
                if (heads.length <= 1) selected = [related[0]];
                else selected = related.some(match => tokens(match[1]).length > 1) ? [related.find(match => tokens(match[1]).length > 1)] : related;
            }
            const first = selected[0], last = selected[selected.length - 1];
            const plain = value => value.replace(/\[\[(.*?)\]\]/g, '$1');
            const end = last.index + last[0].length;
            const answer = plain(sentence.slice(first.index, end)).trim();
            return [{prompt: plain(sentence.slice(0, first.index)) + '________' + plain(sentence.slice(end)), answer, answers: [answer]}];
        });
    }
    function sameFamily(head, token) {
        const irregular = {be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'], do: ['does', 'did', 'done', 'doing'], go: ['goes', 'went', 'gone', 'going'], come: ['comes', 'came', 'coming'], get: ['gets', 'got', 'gotten', 'getting'], have: ['has', 'had', 'having'], make: ['makes', 'made', 'making'], run: ['runs', 'ran', 'running'], speak: ['speaks', 'spoke', 'spoken', 'speaking'], take: ['takes', 'took', 'taken', 'taking'], teach: ['teaches', 'taught', 'teaching'], write: ['writes', 'wrote', 'written', 'writing']};
        const regular = [head, head + 's', head + 'es', head + 'ed', head + 'ing'];
        if (head.endsWith('e')) regular.push(head + 'd', head.slice(0, -1) + 'ing');
        if (head.endsWith('y')) regular.push(head.slice(0, -1) + 'ies', head.slice(0, -1) + 'ied');
        if (head.length >= 3 && !'aeiou'.includes(head.slice(-1)) && 'aeiou'.includes(head.slice(-2, -1))) regular.push(head + head.slice(-1) + 'ing', head + head.slice(-1) + 'ed');
        return regular.includes(token) || (irregular[head] || []).includes(token);
    }
    function initial() {
        const module = {modes: ['example', 'spelling'], order: 'sequential', taskOrder: modes.slice()};
        return {schema: 'kry-android', version: 1, settings: {book: 'book2', units: [], newCount: 20, reviewCount: 30,
            modules: {new: clone(module), review: clone(module), problem: clone(module), free: clone(module)},
            retry: true, firstLetter: true, fuzzy: false, autoSpeak: true, rate: 0.85, volume: 1, accent: 'US', theme: 'dark',
            exampleTarget: 0, dictationTarget: 0, spellingTarget: 3, reviewDays: [1, 3, 7, 14], background: false, opacity: 94},
            records: {}, learned: {}, sessions: [], attempts: [], active: null, customBooks: [], backups: []};
    }
    function record(state, word) {
        return state.records[word.id] || (state.records[word.id] = {notebook: 'none', errors: 0, counts: {example: 0, dictation: 0, spelling: 0}, edited: 0, aliases: []});
    }
    function shuffle(values, random = Math.random) {
        const result = values.slice();
        for (let index = result.length - 1; index > 0; index--) {
            const other = Math.floor(random() * (index + 1));
            [result[index], result[other]] = [result[other], result[index]];
        }
        return result;
    }
    function start(state, words, kind, config) {
        if (!config.modes.length) throw Error('至少启用一种题型');
        let selected = words.filter(word => state.records[word.id]?.notebook !== 'mastered');
        if (config.order === 'bookRandom') selected = shuffle(selected);
        if (config.order === 'unitRandom') {
            const groups = new Map();
            selected.forEach(word => { const unit = word.sources?.[0]?.unit || ''; if (!groups.has(unit)) groups.set(unit, []); groups.get(unit).push(word); });
            selected = [...groups.values()].flatMap(group => shuffle(group));
        }
        if (!selected.length) throw Error('没有可练习的单词');
        const tasks = [];
        const order = config.taskOrder.filter(mode => config.modes.includes(mode));
        for (const mode of order) for (const word of selected) {
            if (mode === 'example') examples(word).forEach(example => tasks.push({...example, word: word.id, mode, retry: false, key: `${word.id}|example|${example.prompt}`}));
            else tasks.push({word: word.id, mode, answer: clean(word.english), answers: [clean(word.english)], retry: false, key: `${word.id}|${mode}`});
        }
        if (!tasks.length) throw Error('所选单词没有有效例句，请启用拼写或听写');
        state.active = {id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, date: dateKey(),
            words: selected.map(word => word.id), tasks, total: tasks.length, completed: [], counted: [], cursor: 0,
            phase: kind === 'new' ? 'preview' : 'quiz', preview: 0, previewStage: 0, previewSpoken: [], paused: false, input: '', hint: 0, feedback: null,
            elapsed: 0, correct: 0, answered: 0, retry: kind === 'free' ? state.settings.retry : true,
            config: clone(config), created: Date.now()};
        return state.active;
    }
    function automaticSpeech(state) {
        const session = state.active;
        if (!session || session.paused || session.feedback) return null;
        if (session.phase === 'preview' && session.kind === 'new' && state.settings.autoSpeak) {
            const id = session.words[session.preview];
            if (id && !(session.previewSpoken || []).includes(id)) return {word: id, mode: 'preview', key: `${session.id}|preview|${id}`};
        }
        if (session.phase === 'quiz') {
            const task = session.tasks[session.cursor];
            if (task?.mode === 'dictation') return {word: task.word, mode: 'dictation', key: `${session.id}|dictation|${session.cursor}`};
        }
        return null;
    }
    function markPreviewSpoken(state, wordId) {
        const session = state.active;
        if (!session || session.kind !== 'new' || !session.words.includes(wordId)) return;
        if (!session.previewSpoken) session.previewSpoken = [];
        if (!session.previewSpoken.includes(wordId)) session.previewSpoken.push(wordId);
    }
    function accepted(state, word, task, input) {
        const answers = task.answers.slice();
        if (state.settings.fuzzy) {
            answers.push(...(state.records[word.id]?.aliases || []));
            if (task.mode !== 'example') {
                const variants = clean(word.english).split('/').map(value => value.trim());
                const lead = variants[0], leadWords = lead.split(' ');
                answers.push(...variants);
                for (const variant of variants.slice(1)) {
                    const variantWords = variant.split(' ');
                    if (leadWords.length > 1 && variantWords.length === 1) answers.push(leadWords.slice(0, -1).join(' ') + ' ' + variant);
                    if (leadWords.length === 1 && variantWords.length > 1) answers.push(lead + ' ' + variantWords.slice(1).join(' '));
                }
            }
        }
        return answers.some(answer => normalize(answer) === normalize(input));
    }
    function submit(state, word, input) {
        const session = state.active;
        const task = session.tasks[session.cursor];
        if (!task || session.feedback || session.paused) throw Error('当前无法作答');
        const correct = accepted(state, word, task, input);
        const item = record(state, word);
        const modeKey = `${word.id}|${task.mode}`;
        const first = !session.counted.includes(modeKey) && !task.retry;
        if (!task.retry && !session.counted.includes(modeKey)) session.counted.push(modeKey);
        if (!correct) {
            item.notebook = 'wrong'; item.errors++;
            item.counts = {example: 0, dictation: 0, spelling: 0};
            if (session.retry) session.tasks.push({...task, retry: true});
        } else {
            if (!session.completed.includes(task.key)) session.completed.push(task.key);
            if (first && item.notebook === 'wrong') {
                item.counts[task.mode]++;
                if (modes.every(mode => item.counts[mode] >= state.settings[`${mode}Target`])) item.notebook = 'prone';
            }
        }
        item.edited = Date.now();
        session.answered++; if (correct) session.correct++;
        state.attempts.push({date: dateKey(), time: Date.now(), session: session.id, word: word.id, mode: task.mode, correct, retry: task.retry});
        session.feedback = {correct, input, answer: task.answer, word: word.id, mode: task.mode};
        session.input = '';
        return session.feedback;
    }
    function advance(state) {
        const session = state.active;
        session.cursor++; session.hint = 0; session.feedback = null; session.input = '';
        while (session.cursor < session.tasks.length && state.records[session.tasks[session.cursor].word]?.notebook === 'mastered') session.cursor++;
        return session.cursor >= session.tasks.length;
    }
    function skipMastered(state) {
        const session = state.active;
        if (!session) return false;
        if (session.phase === 'preview') {
            while (session.preview < session.words.length && state.records[session.words[session.preview]]?.notebook === 'mastered') {
                session.preview++;
                session.previewStage = 0;
            }
            if (session.preview >= session.words.length) session.phase = 'quiz';
        }
        if (session.phase === 'quiz') {
            const previousCursor = session.cursor;
            while (session.cursor < session.tasks.length && state.records[session.tasks[session.cursor].word]?.notebook === 'mastered') session.cursor++;
            if (session.cursor !== previousCursor) { session.feedback = null; session.input = ''; session.hint = 0; }
            return session.cursor >= session.tasks.length;
        }
        return false;
    }
    function masterWord(state, word) {
        const item = record(state, word);
        item.notebook = 'mastered';
        item.edited = Date.now();
        if (state.active) {
            for (const task of state.active.tasks) {
                if (task.word === word.id && !state.active.completed.includes(task.key)) state.active.completed.push(task.key);
            }
        }
        return skipMastered(state);
    }
    function finish(state, complete) {
        const session = state.active;
        if (!session) return;
        if (session.kind !== 'free') {
            for (const id of session.words) {
                const required = session.tasks.filter(task => task.word === id && !task.retry);
                if (required.length && required.every(task => session.completed.includes(task.key))) {
                    const previous = state.learned[id];
                    const stage = Math.min(previous ? previous.stage + (session.kind === 'review' ? 1 : 0) : 0, state.settings.reviewDays.length - 1);
                    const due = new Date(); due.setDate(due.getDate() + state.settings.reviewDays[stage]);
                    state.learned[id] = {date: previous?.date || dateKey(), last: dateKey(), stage, due: dateKey(due)};
                }
            }
        }
        state.sessions.push({...session, tasks: [], feedback: null, complete, finished: Date.now()});
        state.active = null;
    }
    function revealPreview(state) {
        const session = state.active;
        if (!session || session.phase !== 'preview' || session.paused) throw Error('当前不在新词预览阶段');
        session.previewStage = Math.min(2, (session.previewStage || 0) + 1);
        return session.previewStage;
    }
    function movePreview(state, direction) {
        const session = state.active;
        if (!session || session.phase !== 'preview' || session.paused) throw Error('当前不在新词预览阶段');
        if (direction > 0 && (session.previewStage || 0) < 2) return false;
        let next = session.preview + direction;
        while (next >= 0 && next < session.words.length && state.records[session.words[next]]?.notebook === 'mastered') next += direction;
        if (next < 0) return false;
        if (next >= session.words.length) {
            session.phase = 'quiz';
            while (session.cursor < session.tasks.length && state.records[session.tasks[session.cursor].word]?.notebook === 'mastered') session.cursor++;
            return session.cursor >= session.tasks.length;
        }
        session.preview = next;
        session.previewStage = 0;
        return false;
    }
    function validate(data, wordIds) {
        if (!data || data.schema !== 'kry-android' || data.version !== 1 || !data.settings || !data.records || !data.learned ||
            !Array.isArray(data.sessions) || !Array.isArray(data.attempts) || !Array.isArray(data.customBooks)) throw Error('不是有效的安卓备份文件');
        const defaults = initial().settings;
        data.settings = {...defaults, ...data.settings};
        for (const kind of ['new', 'review', 'problem', 'free']) {
            const module = data.settings.modules[kind];
            if (!module || !Array.isArray(module.modes) || !module.modes.length || module.modes.some(mode => !modes.includes(mode)) ||
                !Array.isArray(module.taskOrder) || modes.some(mode => !module.taskOrder.includes(mode))) throw Error('备份题型设置无效');
        }
        for (const key of ['newCount', 'reviewCount', 'exampleTarget', 'dictationTarget', 'spellingTarget'])
            if (!Number.isInteger(data.settings[key]) || data.settings[key] < 0 || data.settings[key] > 1000) throw Error('备份数量设置无效');
        if (!Array.isArray(data.settings.reviewDays) || !data.settings.reviewDays.length || data.settings.reviewDays.some(day => !Number.isInteger(day) || day < 1 || day > 365)) throw Error('备份复习间隔无效');
        for (const [id, item] of Object.entries(data.records)) {
            if (!item || !['none', 'wrong', 'prone', 'mastered', 'priority'].includes(item.notebook) || !item.counts || !Array.isArray(item.aliases)) throw Error(`单词本记录无效：${id}`);
        }
        if (data.active) {
            const session = data.active;
            if (!Array.isArray(session.tasks) || !Array.isArray(session.words) || !Array.isArray(session.completed) || !Array.isArray(session.counted) ||
                !Number.isInteger(session.cursor) || session.cursor < 0 || session.cursor >= session.tasks.length || !['preview', 'quiz'].includes(session.phase)) throw Error('备份学习进度无效');
            for (const task of session.tasks) if (!wordIds.has(task.word) || !modes.includes(task.mode) || !Array.isArray(task.answers)) throw Error('备份引用了不存在的词条');
            for (const id of session.words) if (!wordIds.has(id)) throw Error('备份词条缺失');
            session.paused = true;
            if (session.previewStage === undefined) session.previewStage = 0;
            if (session.previewSpoken === undefined) session.previewSpoken = [];
            if (!Array.isArray(session.previewSpoken) || session.previewSpoken.some(id => !session.words.includes(id))) throw Error('备份朗读记录无效');
            if (!Number.isInteger(session.previewStage) || session.previewStage < 0 || session.previewStage > 2 ||
                (session.phase === 'preview' && (!Number.isInteger(session.preview) || session.preview < 0 || session.preview >= session.words.length))) throw Error('备份预览层级无效');
        }
        data.backups = Array.isArray(data.backups) ? data.backups.slice(-5) : [];
        return data;
    }
    const api = {modes, clone, normalize, clean, dateKey, csv, examples, initial, record, shuffle, start, automaticSpeech, markPreviewSpoken, accepted, submit, advance, finish, revealPreview, movePreview, skipMastered, masterWord, validate};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else scope.Engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
