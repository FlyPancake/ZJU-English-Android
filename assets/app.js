'use strict';
const E = window.Engine;
const P = window.StudyPlan;
const names = {example: '例句填空', dictation: '听写', spelling: '中文拼写'};
const kinds = {new: '每日新学', review: '历史列表复习', problem: '错题与易错词', free: '自由练习'};
const notebooks = {wrong: '错题本', prone: '易错本', mastered: '已掌握', priority: '优先学习', recent: '最近作答'};
let state, catalog, words = {}, page = 'home', filter = 'wrong', search = '', pageLimit = 40;
let undo = [], lastTick = performance.now(), lastSave = Date.now(), toastTimer, locked = false;
let pendingWindowsImport = {};
let licenseText = '';
let speechSequence = 0;
const speechRequests = new Map(), pendingAutomaticSpeech = new Set();
const element = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const button = (action, label, value = '', cls = '') => `<button class="${cls}" data-action="${action}" data-value="${esc(value)}">${label}</button>`;
const options = (values, selected) => values.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
const checkbox = (key, label, checked, cls = '') => `<label class="check ${cls}"><input type="checkbox" id="${key}" ${checked ? 'checked' : ''}>${label}</label>`;
const number = (key, label, value, min = 0, max = 1000) => `<label for="${key}">${label}</label><input type="number" id="${key}" value="${value}" min="${min}" max="${max}">`;
const clock = milliseconds => `${Math.floor(milliseconds / 60000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`;

function toast(message) {
    element('toast').textContent = message; element('toast').style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => element('toast').style.display = 'none', 3500);
}
function persist() {
    if (locked || !state) return;
    try {
        const data = JSON.stringify(state);
        if (window.Android) { if (!Android.save(data)) throw Error('保存失败'); }
        else localStorage.setItem('kry-state', data);
    } catch (error) { toast('保存失败，请立即导出备份：' + error.message); }
    lastSave = Date.now();
}
function rebuild() {
    words = Object.fromEntries(catalog.words.map(word => [word.id, E.clone(word)]));
    for (const book of state.customBooks) for (const word of book.words) {
        if (!word.id || !word.english || typeof word.chinese !== 'string' || !Array.isArray(word.sources)) throw Error('自定义词书格式无效');
        if (!words[word.id]) words[word.id] = E.clone(word);
        else {
            const target = words[word.id];
            target.chinese = [...new Set([target.chinese, word.chinese])].join('\n');
            target.examples = [...new Set((target.examples + '；' + (word.examples || '')).split('；').filter(Boolean))].join('；');
            target.sources.push(...word.sources);
            if (word.phonetic) { target.phonetic = word.phonetic; target.phoneticSource = 'import'; }
        }
    }
}
function allBooks() { return [...catalog.books, ...state.customBooks.map(book => ({id: book.id, name: book.name, units: ['导入词表']}))]; }
function selectedWords() {
    return Object.values(words).filter(word => word.sources.some(source => source.book === state.settings.book && (!state.settings.units.length || state.settings.units.includes(source.unit))));
}
function counts(notebook) { return Object.values(state.records).filter(record => record.notebook === notebook).length; }
function appearance() {
    document.body.classList.toggle('light', state.settings.theme === 'light');
    document.documentElement.style.setProperty('--panel', state.settings.opacity / 100);
    const wall = element('wallpaper'), mime = window.Android ? Android.backgroundMime() : '';
    const enabled = state.settings.background && mime;
    document.body.classList.toggle('has-bg', !!enabled); wall.innerHTML = ''; wall.style.backgroundImage = '';
    if (enabled && mime.startsWith('video/')) wall.innerHTML = `<video muted autoplay loop playsinline src="/background?v=${Date.now()}"></video>`;
    else if (enabled) wall.style.backgroundImage = `url('/background?v=${Date.now()}')`;
}
function tick() {
    const now = performance.now();
    if (state?.active && !state.active.paused && page === 'session' && !document.hidden) state.active.elapsed += Math.min(now - lastTick, 2000);
    lastTick = now;
    if (settleDaily()) return;
    if (element('timer') && state.active) element('timer').textContent = clock(state.active.elapsed);
    if (state?.active && Date.now() - lastSave > 10000) persist();
}
function settleDaily(when = new Date()) {
    if (!state?.active || state.active.kind === 'free' || state.active.date >= E.studyDayKey(when)) return false;
    const previous = JSON.stringify({...state, backups: []});
    const result = P.settleCrossDay(state, when);
    if (!result) return false;
    state.backups.push({time: when.getTime(), data: previous}); state.backups = state.backups.slice(-5);
    stopSpeech(); undo = []; if (page === 'session') page = 'home';
    persist(); render(); toast(`已跨日结算：${result.released.length} 词返池优先抽取，完成词和错题记录保留`);
    return true;
}
function navigate(next) {
    if (page === 'session' && state.active) { tick(); state.active.paused = true; stopSpeech(); persist(); }
    page = next; pageLimit = 40; render(); window.scrollTo(0, 0);
}
function render() {
    if (!state) return;
    document.querySelectorAll('#nav button').forEach(item => item.classList.toggle('active', item.dataset.value === page));
    const views = {home, practice, notebook, stats, settings, session, licenses};
    element('app').innerHTML = (views[page] || home)();
    if (page === 'settings') element('app').lastElementChild.insertAdjacentHTML('beforeend', `<p>${button('licenses', '查看第三方数据许可')}</p>`);
    if (page === 'settings') element('app').lastElementChild.insertAdjacentHTML('beforeend', `<h3>Windows 学习记录迁移</h3><p class="muted">先导出手机备份。依次选择 notebook_state.json 和 study_state.json，确认后替换当前安卓记录，并保留恢复前的本地快照。不是两端进度合并。</p><p>${button('windowsImport', '迁移 Windows 记录')}</p>`);
    if (page === 'settings') element('app').insertAdjacentHTML('afterbegin', planSettings());
}
function planSettings() {
    const prefs = state.settings;
    return `<section class="card"><h2>配额与跨日规则</h2>${number('problemCount', '每轮错题 / 易错词数量', prefs.problemCount, 0, 10000)}${allBooks().map((book, index) => number('defaultQuota-' + index, book.name + ' 默认新学配额', prefs.defaultBookCounts[book.id] || 0, 0, 10000)).join('')}<p class="muted">默认配额全为 0 时，用每日新学目标作为第一本词书的配额；抽取前可逐书调整。配额不足不跨书补足，重复词只抽一次。</p>${checkbox('randomExtraction', '随机跨单元抽取（关闭时按词书及单元顺序）', prefs.randomExtraction)}${checkbox('carryOverCountsInNewCount', '跨日优先词计入各书新学配额', prefs.carryOverCountsInNewCount)}${checkbox('carryOverPreview', '跨日优先词重新展示单词、例句和释义', prefs.carryOverPreview)}${checkbox('allowOverlap', '同一词允许当天同时进入列表复习与错题复习', prefs.allowOverlap)}${checkbox('reviewDueOnly', '仅抽取已到复习间隔的错题 / 易错词', prefs.reviewDueOnly)}<p class="muted">学习日固定在本地时间凌晨 04:01 切换。未完成的每日列表自动结算，未完成词返池优先；完成词、已掌握和错题记录保留。不计配额时，返池词额外加入，0 配额只关闭该书普通新词。关闭重新展示时，返池词只显示单词和音标，可直接下一词。自由练习不返池。</p></section>`;
}
function metrics(items) { return `<div class="grid">${items.map(([value, label]) => `<div class="metric"><strong>${value}</strong><small>${label}</small></div>`).join('')}</div>`; }
function home() {
    const today = E.studyDayKey(), todayAttempts = state.attempts.filter(attempt => attempt.date === today);
    const todayNew = Object.values(state.learned).filter(item => item.date === today).length;
    const due = P.reviewPool(state, Object.values(words)).words.length;
    return `<section class="card"><span class="pill">${today} · 学习计划</span><h2 style="margin-top:16px">今天，也前进一步。</h2>${metrics([[todayNew, '今日新学 / ' + state.settings.newCount], [todayAttempts.length, '今日作答'], [due, '历史复习待抽'], [counts('wrong'), '错题待巩固']])}</section>
        ${state.active ? `<section class="card"><h3>继续${kinds[state.active.kind]}</h3><p class="muted">${state.active.completed.length} / ${state.active.total} 题 · ${clock(state.active.elapsed)}</p>${button('resume', '恢复上次进度', '', 'primary')}</section>` : ''}
        ${quotaPanel()}
        <section class="card"><h3>复习与自由练习</h3><p class="muted">历史列表复习抽取之前学习日的 ${state.settings.listCount} 个新学列表；错题 / 易错词每轮最多 ${state.settings.problemCount} 词。答错在队列末尾复现。</p><div class="row">${button('start', '历史列表复习', 'review')}${button('start', '错题 / 易错词', 'problem')}</div><p>${button('nav', '自由练习', 'practice')}</p></section>
        <section class="card"><h3>学习范围</h3><p class="muted">新学按上方多词书配额抽取，只使用各书在首页选定的单元；普通新词和跨日返池词均遵守范围，余量不足不从范围外补足。修改范围只影响下一批，不改变当前列表。自由练习的范围在「练习」中独立设置。已掌握词不抽取。每批结束后可继续抽下一批，每日目标不是强制上限。</p>${button('nav', '选择自由练习范围', 'practice')}</section>
        ${!state.attempts.length ? `<section class="card"><h3>第一次使用？</h3><p>1. 首页分配各书配额，并展开「新学单元范围」选择单元。<br>2. 点击每日新学，预览后开始答题。<br>3. 空答案按提交会依次显示提示。<br>4. 点击「斩」手动标记已掌握。<br>5. 在设置中定期导出备份。</p><p class="muted">听写使用手机的英语语音包；没有语音包时请先安装。</p></section>` : ''}`;
}
function quotaPanel() {
    const books = allBooks(), defaults = P.quotaDefaults(state, books), remaining = P.availableCounts(state, Object.values(words), books);
    return `<section class="card" id="quotaPanel"><h3>多词书配额新学</h3><p class="muted">逐书分配数量并选择新学单元；普通新词和返池词只从所选范围抽取，余量不足不跨单元或跨书补足，同名词只抽一次。单元范围自动保存，修改后用于下一批，与自由练习独立。</p>${books.map((book, index) => `<div class="quota-book"><label for="quota-${index}" data-remaining-book="${esc(book.id)}">${esc(book.name)} · 范围内可抽 ${remaining[book.id]} 词</label><input id="quota-${index}" data-quota="${esc(book.id)}" type="number" min="0" max="10000" value="${defaults[book.id]}">${newUnitPicker(book)}</div>`).join('')}${checkbox('rememberQuotas', '记住本次配额作为默认', true)}<p>${button('start', '开始新学', 'new', 'primary')}</p><p class="muted">学习日凌晨 04:01 切换；当前返池优先词 ${state.priorityWords.filter(id => words[id] && state.records[id]?.notebook !== 'mastered').length} 个（仅范围内的词参与本次抽取，范围外的词仍保留在返池中）。</p></section>`;
}
function unitRangeLabel(book) {
    const units = P.selectedUnits(state, book);
    return !units.length ? '未选单元（本书不抽取）' : units.length === book.units.length ? '全部单元' : units.join('、');
}
function newUnitPicker(book) {
    const selected = P.selectedUnits(state, book);
    return `<details class="new-unit-picker" data-range-book="${esc(book.id)}"><summary>新学单元范围：<span data-range-summary="${esc(book.id)}">${esc(unitRangeLabel(book))}</span></summary><label class="check"><input type="checkbox" data-new-units-all="${esc(book.id)}" ${selected.length === book.units.length ? 'checked' : ''}>全部单元（取消即清空）</label><div class="units">${book.units.map(unit => `<label class="check"><input type="checkbox" data-new-unit-book="${esc(book.id)}" value="${esc(unit)}" ${selected.includes(unit) ? 'checked' : ''}>${esc(unit)}</label>`).join('')}</div><p class="muted">至少勾选一个单元才能从本书抽词；全部取消表示本书暂不抽取，不会视为全部。</p></details>`;
}
function refreshNewRanges() {
    const books = allBooks(), remaining = P.availableCounts(state, Object.values(words), books);
    for (const book of books) {
        const selected = P.selectedUnits(state, book);
        for (const label of document.querySelectorAll('[data-remaining-book]')) if (label.dataset.remainingBook === book.id) label.textContent = book.name + ' · 范围内可抽 ' + remaining[book.id] + ' 词';
        for (const summary of document.querySelectorAll('[data-range-summary]')) if (summary.dataset.rangeSummary === book.id) summary.textContent = unitRangeLabel(book);
        for (const input of document.querySelectorAll('[data-new-unit-book]')) if (input.dataset.newUnitBook === book.id) input.checked = selected.includes(input.value);
        for (const input of document.querySelectorAll('[data-new-units-all]')) if (input.dataset.newUnitsAll === book.id) { input.checked = selected.length === book.units.length; input.indeterminate = selected.length > 0 && selected.length < book.units.length; }
    }
}
function quotaShortfallText(session) {
    return Object.entries(session.quotaShortfalls || {}).map(([id, item]) => {
        const book = allBooks().find(book => book.id === id);
        return (book?.name || id) + ' 配额 ' + item.requested + '，实际抽取' + (session.carryOverCountsInNewCount === false ? '普通新词' : '') + ' ' + item.actual + ' 词';
    }).join('；');
}
function practice() {
    const book = allBooks().find(item => item.id === state.settings.book) || allBooks()[0];
    return `<section class="card"><h2>自由练习</h2><label>选择词书</label><select id="book">${options(allBooks().map(item => [item.id, item.name]), book.id)}</select><label>选择单元（不勾选表示全部）</label><div class="units">${book.units.map(unit => `<label class="check"><input name="unit" type="checkbox" value="${esc(unit)}" ${state.settings.units.includes(unit) ? 'checked' : ''}>${esc(unit)}</label>`).join('')}</div><p class="muted">当前范围 ${selectedWords().length} 个逻辑单词，同词的不同释义已经合并。</p><label>练习内容</label><select id="content">${options([['all', '全部单词'], ['wrong', '只练错题'], ['prone', '只练易错词'], ['unlearned', '尚未学习']], 'all')}</select>${number('practiceCount', '本次单词数（0 = 全部）', 30)}<p>${button('start', '开始自由练习', 'free', 'primary')}</p><p class="muted">自由练习的题型、题目顺序与错题复现在设置中单独调整。</p></section><section class="card"><h3>导入自定义词书</h3><p class="muted">支持 UTF-8 CSV，列名 english / chinese / examples / part_of_speech。例句中的答案用 [[双括号]] 标记。</p>${button('csv', '从文件导入 CSV')}</section>`;
}
function notebook() {
    const ids = filter === 'recent' ? [...new Set(state.attempts.slice().reverse().map(item => item.word))] : Object.keys(state.records).filter(id => state.records[id].notebook === filter).sort((left, right) => state.records[right].edited - state.records[left].edited);
    const matched = ids.map(id => words[id]).filter(Boolean).filter(word => E.normalize(word.english + ' ' + word.chinese).includes(E.normalize(search)));
    return `<section class="card"><h2>单词本</h2><select id="notebookFilter">${options(Object.entries(notebooks), filter)}</select><label>搜索英文或释义</label><input id="search" placeholder="搜索单词…" value="${esc(search)}"><p class="muted">${matched.length} 个词 · 最近编辑优先</p><div class="row">${button('notebookPractice', '练习当前词本', filter, 'primary')}${button('export', '导出完整备份')}</div></section><section class="card">${matched.slice(0, pageLimit).map(word => {
        const record = state.records[word.id];
        return `<div class="listword"><div class="row"><strong>${esc(word.english)}</strong>${button('speak', '朗读', word.id)}</div><p class="meaning muted">${esc(word.pos ? word.pos + '  ' : '')}${esc(word.chinese)}</p><small>错误 ${record?.errors || 0} 次 · ${record ? new Date(record.edited).toLocaleString('zh-CN') : ''}</small><div class="row">${button('move', '斩 · 已掌握', word.id + '|mastered')}${button('move', '优先学习', word.id + '|priority')}${button('move', '移回错题', word.id + '|wrong')}${button('alias', '自定义答案', word.id)}</div></div>`;
    }).join('') || '<p class="empty muted">这里还没有单词。</p>'}${matched.length > pageLimit ? button('more', '显示更多') : ''}</section>`;
}
function stats() {
    const correct = state.attempts.filter(item => item.correct).length;
    const totalTime = state.sessions.reduce((sum, item) => sum + item.elapsed, 0) + (state.active?.elapsed || 0);
    const dates = new Set(state.attempts.map(item => item.date));
    const now = new Date(), first = new Date(now.getFullYear(), now.getMonth(), 1), days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    let calendar = Array.from({length: first.getDay()}, () => '<div></div>').join('');
    for (let day = 1; day <= days; day++) {
        const key = E.dateKey(new Date(now.getFullYear(), now.getMonth(), day));
        calendar += `<div class="day ${dates.has(key) ? 'studied' : ''} ${day === now.getDate() ? 'today' : ''}">${day}</div>`;
    }
    return `<section class="card"><h2>学习统计</h2>${metrics([[Object.keys(state.learned).length, '累计学习单词'], [state.attempts.length ? Math.round(correct * 100 / state.attempts.length) + '%' : '—', '全部作答正确率（含复现）'], [clock(totalTime), '有效学习时长'], [dates.size, '学习天数']])}<p class="muted">暂停、离开学习页或切到后台不计时。</p></section><section class="card"><h3>${now.getFullYear()} 年 ${now.getMonth() + 1} 月</h3><div class="calendar">${['日', '一', '二', '三', '四', '五', '六'].map(day => `<small style="text-align:center">${day}</small>`).join('')}${calendar}</div></section><section class="card"><h3>历史学习列表</h3>${state.sessions.slice().reverse().slice(0, pageLimit).map(item => `<div class="history"><strong>${kinds[item.kind]} · ${item.date}</strong><p class="muted">${item.words.length} 词 · ${item.answered ? Math.round(item.correct * 100 / item.answered) + '%' : '未作答'} · ${clock(item.elapsed)} · ${item.status === 'settled' ? '跨日已结算' : item.complete ? '已完成' : '提前结束'}</p>${button('historyReview', '复习本列表', item.id)}</div>`).join('') || '<p class="empty muted">完成一轮学习后会显示在这里。</p>'}${state.sessions.length > pageLimit ? button('more', '更多历史') : ''}</section>`;
}
function settings() {
    const prefs = state.settings;
    return `<section class="card"><h2>学习设置</h2><div class="row"><div>${number('newCount', '每日新学目标', prefs.newCount, 0, 10000)}</div><div>${number('listCount', '历史列表复习数量', prefs.listCount, 0, 10000)}</div></div>${checkbox('fuzzy', '接受自定义答案和斜线变体', prefs.fuzzy)}${checkbox('firstLetter', '例句首字母提示', prefs.firstLetter)}${checkbox('retry', '自由练习答错后再次出现', prefs.retry)}<label>复习间隔（天，用逗号分隔）</label><input id="reviewDays" value="${prefs.reviewDays.join(',')}"><details><summary>错题 → 易错本门槛</summary><p class="muted">三项必须同时满足；每词每列表每题型只计算首次作答，复现答对不计入。已掌握只能手动「斩」。</p>${E.modes.map(mode => number(mode + 'Target', names[mode] + '首次答对次数', prefs[mode + 'Target'], 0, 99)).join('')}</details></section>
        <section class="card"><h3>四模块独立题型设置</h3>${Object.entries(kinds).map(([kind, name]) => `<details ${kind === 'free' ? 'open' : ''}><summary>${name}</summary>${E.modes.map(mode => checkbox(`${kind}-${mode}`, names[mode], prefs.modules[kind].modes.includes(mode))).join('')}<label>题目顺序</label><select id="${kind}-order">${options([['sequential', '顺序'], ['unitRandom', '单元内随机'], ['bookRandom', '词书内随机']], prefs.modules[kind].order)}</select><label>题型先后顺序</label><select id="${kind}-taskOrder">${options([['example,dictation,spelling', '例句 → 听写 → 拼写'], ['spelling,example,dictation', '拼写 → 例句 → 听写'], ['dictation,example,spelling', '听写 → 例句 → 拼写'], ['example,spelling,dictation', '例句 → 拼写 → 听写'], ['spelling,dictation,example', '拼写 → 听写 → 例句'], ['dictation,spelling,example', '听写 → 拼写 → 例句']], prefs.modules[kind].taskOrder.join(','))}</select></details>`).join('')}</section>
        <section class="card"><h3>英语朗读</h3>${checkbox('autoSpeak', '新学首次自动朗读（填空 / 中译英仅手动）', prefs.autoSpeak)}<label>英语口音</label><select id="accent">${options([['US', '美式英语'], ['UK', '英式英语']], prefs.accent)}</select><label>语速 ${prefs.rate.toFixed(2)}</label><input id="rate" type="range" min="0.3" max="1.5" step="0.05" value="${prefs.rate}"><label>音量 ${Math.round(prefs.volume * 100)}%</label><input id="volume" type="range" min="0" max="1" step="0.05" value="${prefs.volume}"><p>${button('tts', '系统英语语音设置')}</p><p class="muted">新学预览每词自动朗读一次，回看和恢复不重复。例句填空、中译英及复现仅点击朗读时播放；听写仍自动播放。语音质量和离线能力由手机引擎决定，请安装英语语音包。手机音量键控制媒体音量。</p></section>
        <section class="card"><h3>外观</h3><label>主题</label><select id="theme">${options([['dark', '深色'], ['light', '浅色']], prefs.theme)}</select>${checkbox('background', '显示导入的壁纸 / 循环视频', prefs.background)}<label>面板不透明度</label><input id="opacity" type="range" min="50" max="100" value="${prefs.opacity}"><p>${button('background', '选择图片或视频')}${button('resetAppearance', '恢复默认外观')}</p></section>
        <section class="card">${button('saveSettings', '保存全部设置', '', 'primary')}</section><section class="card"><h3>备份与恢复</h3><p class="muted">完整安卓备份包含进度、词本、设置和自定义词书，不包含壁纸文件。卸载应用会删除本地记录，请先导出。</p><div class="row">${button('export', '导出完整备份')}${button('import', '导入 / 恢复备份')}</div><p class="muted">每 10 分钟和提前结束时保存本地快照，最多保留 5 份。恢复前自动保留当前快照。</p>${state.backups.map((backup, index) => `<p>${button('restoreLocal', '恢复 ' + new Date(backup.time).toLocaleString('zh-CN'), String(index))}</p>`).join('')}</section><section class="card"><h3>关于这个安卓移植版</h3><p class="muted">当前版本：v1.2.1</p><p>基于原项目增强版的学习规则重新实现，内置原仓库 book2 / book3。支持 Android 8.0 及以上。</p><p class="muted">这是非官方安卓移植，不是 Windows 程序的直接封装。Windows 快捷键、多窗口及 GitHub 自动更新未移植；支持转换 Windows study_state.json 和 notebook_state.json 后替换恢复；旧版 wrong_words.json 仅导入错题词条。</p><p class="muted">原仓库代码和词书没有明确的完整授权，请仅按来源说明用于个人学习，不作商业发布。词性数据来源 ECDICT，MIT 许可详见源码中的第三方说明。</p></section>`;
}
function diff(input, answer) {
    const entered = Array.from(input), expected = Array.from(answer);
    return `<div class="diff">${expected.map((letter, index) => E.normalize(entered[index]) === E.normalize(letter) ? esc(letter) : `<mark>${esc(letter)}</mark>`).join('')}${entered.length > expected.length ? `<mark> + ${esc(entered.slice(expected.length).join(''))}</mark>` : ''}</div>`;
}
function licenses() {
    return `<section class="card"><h2>第三方数据许可</h2><p style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px">${esc(licenseText)}</p>${button('nav', '返回设置', 'settings')}</section>`;
}
function session() {
    const current = state.active;
    if (!current) return '<section class="card"><p>没有正在进行的学习。</p></section>';
    const shortfall = quotaShortfallText(current);
    const heading = `${shortfall ? `<p class="muted quota-shortfall">${esc(shortfall)}；未从范围外补足。</p>` : ''}<div class="row"><span class="pill">${kinds[current.kind]}</span><span class="tight muted" id="timer">${clock(current.elapsed)}</span></div><div class="progress"><div style="width:${current.completed.length * 100 / current.total}%"></div></div><small>完成 ${current.completed.length} / ${current.total} 题 · ${current.words.length} 词</small>`;
    if (current.paused) return `<section class="card">${heading}<h2 style="margin-top:24px">学习已暂停</h2><p class="muted">进度、输入和提示已保存。暂停期间不计时。</p>${button('resume', '继续学习', '', 'primary')} ${button('end', '提前结束', '', 'danger')}</section>`;
    if (current.phase === 'preview') {
        const word = words[current.words[current.preview]];
        const stage = current.previewStage || 0;
        const needsLayers = E.previewNeedsLayers(state);
        const phonetic = word.phonetic ? `<p class="phonetic" id="previewPhonetic">/${esc(word.phonetic)}/${word.phoneticSource === 'components' ? '<small>（按组成词标注）</small>' : ''}</p>` : '<p class="phonetic muted" id="previewPhonetic">暂无音标，可点击朗读</p>';
        const examples = word.examples ? word.examples.replace(/\[\[(.*?)\]\]/g, '$1').replace(/；/g, '\n\n') : '这个词暂时没有例句。';
        return `<section class="card">${heading}<p class="muted">预览 ${current.preview + 1} / ${current.words.length} · ${needsLayers ? '第 ' + (stage + 1) + ' / 3 层' : '返池词简略预览'}</p><div class="word">${esc(word.english)}</div>${phonetic}${stage >= 1 ? `<section id="previewExamples"><h3>例句</h3><p class="sentence" style="white-space:pre-line">${esc(examples)}</p></section>` : ''}${stage >= 2 ? `<section id="previewMeaning"><h3>完整中英释义</h3><p class="meaning">${esc(word.pos ? word.pos + '  ' : '')}${esc(word.chinese)}</p></section>` : ''}<div class="row">${button('speak', '朗读', word.id)}${button('master', '斩 · 已掌握', word.id)}</div><div class="row" style="margin-top:12px">${button('previewPrev', '上一词')}${needsLayers && stage < 2 ? button('previewReveal', stage === 0 ? '显示例句' : '显示完整中英释义', '', 'primary') : button('previewNext', current.preview + 1 === current.words.length ? '开始答题' : '下一词', '', 'primary')}</div><p>${button('pause', '暂停')}</p></section>`;
    }
    const task = current.tasks[current.cursor], word = words[task.word];
    const meaning = `<p class="meaning">${esc(word.pos ? word.pos + '  ' : '')}${esc(word.chinese)}</p>`;
    return `<section class="card">${heading}<p><span class="pill">${names[task.mode]}${task.retry ? ' · 错题复现' : ''}</span></p>${task.mode === 'example' ? `<p class="sentence">${esc(task.prompt)}</p>` : task.mode === 'dictation' ? '<div class="word">听一听，写下来</div>' : meaning}${current.hint >= 1 && task.mode === 'example' && state.settings.firstLetter ? `<p class="muted">首字母：${esc(task.answer[0])}</p>` : ''}${(task.mode !== 'spelling' && current.hint >= (state.settings.firstLetter && task.mode === 'example' ? 2 : 1)) ? meaning : ''}
        ${current.feedback ? `<div class="feedback"><h3 class="${current.feedback.correct ? 'good' : 'bad'}">${current.feedback.correct ? '回答正确' : '再巩固一下'}</h3><p class="muted">你的答案：${esc(current.feedback.input || '（未填写）')}</p><p>正确答案：${esc(current.feedback.answer)}</p>${!current.feedback.correct ? diff(current.feedback.input, current.feedback.answer) : ''}<p class="meaning muted">${esc(word.english)} · ${esc(word.chinese)}</p></div>${button('next', '下一题', '', 'primary')}` : `<input id="answer" class="answer" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="text" placeholder="输入英文答案" value="${esc(current.input)}"><div class="row">${button('submit', '提交答案', '', 'primary')}${button('hint', '提示')}${button('speakTask', '朗读')}</div><p class="muted">有内容时直接提交；空内容时依次显示提示。</p><div class="row">${button('skip', '跳过（不计错）')}${button('master', '斩 · 已掌握', word.id)}</div>`}<div class="row" style="margin-top:16px">${button('undo', '撤销上一步')}${button('pause', '暂停')}${button('end', '结束列表', '', 'danger')}</div><details><summary>本列表回看（只读）</summary>${current.words.map(id => `<p>${esc(words[id].english)} — ${esc(words[id].chinese)}</p>`).join('')}</details></section>`;
}
function speechEvent(event) {
    const request = speechRequests.get(event.id);
    if (!request) return;
    if ((event.state === 'started' || event.state === 'done') && !request.started) {
        request.started = true;
        if (request.previewWord && state.active?.id === request.sessionId) { E.markPreviewSpoken(state, request.previewWord); persist(); }
    }
    if (event.state === 'waiting' || event.state === 'error' || (event.state === 'started' && !request.automatic)) toast(event.message || '朗读失败，请检查系统英语语音设置');
    if (['done', 'error', 'stopped'].includes(event.state)) {
        speechRequests.delete(event.id);
        if (request.automaticKey) pendingAutomaticSpeech.delete(request.automaticKey);
    }
}
function stopSpeech() {
    if (window.Android) Android.stopSpeech();
    else if (window.speechSynthesis) speechSynthesis.cancel();
    for (const id of [...speechRequests.keys()]) speechEvent({id, state: 'stopped'});
}
function speak(text, automaticKey = '') {
    text = String(text || '').trim();
    if (!text) return toast('没有可朗读的英文内容');
    if (state.settings.volume <= 0) { if (automaticKey) pendingAutomaticSpeech.delete(automaticKey); return toast('朗读音量为 0，请在设置中调高音量'); }
    stopSpeech();
    const id = `speech-${Date.now()}-${++speechSequence}`;
    const previewWord = page === 'session' && state.active?.phase === 'preview' ? state.active.words[state.active.preview] : null;
    const request = {automatic: !!automaticKey, automaticKey, sessionId: state.active?.id, previewWord, started: false};
    speechRequests.set(id, request);
    if (automaticKey) pendingAutomaticSpeech.add(automaticKey);
    try {
        if (window.Android) Android.speak(text, state.settings.rate, state.settings.volume, state.settings.accent, id);
        else if (window.speechSynthesis) {
            const utterance = new SpeechSynthesisUtterance(text); request.utterance = utterance;
            utterance.lang = 'en-' + state.settings.accent; utterance.rate = state.settings.rate; utterance.volume = state.settings.volume;
            utterance.onstart = () => speechEvent({id, state: 'started', message: '正在朗读…'});
            utterance.onend = () => speechEvent({id, state: 'done'});
            utterance.onerror = event => speechEvent({id, state: 'error', message: '朗读失败：' + event.error});
            speechSynthesis.speak(utterance);
        } else speechEvent({id, state: 'error', message: '当前环境不支持英语朗读'});
    } catch (error) { speechEvent({id, state: 'error', message: '无法播放朗读：' + error.message}); }
}
function autoSpeak() {
    const request = E.automaticSpeech(state);
    if (!request) { stopSpeech(); return; }
    if (pendingAutomaticSpeech.has(request.key)) return;
    const text = request.mode === 'preview' ? E.clean(words[request.word].english) : state.active.tasks[state.active.cursor].answer;
    speak(text, request.key);
}
function snapshotUndo() {
    undo.push({active: E.clone(state.active), records: E.clone(state.records), attemptsLength: state.attempts.length});
    if (undo.length > 5) undo.shift();
}
function confirmMaster(word) {
    if (element('masterDialog')) return Promise.resolve(false);
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.id = 'masterDialog'; overlay.className = 'modal-overlay';
        overlay.innerHTML = `<section class="card modal-card" role="dialog" aria-modal="true" aria-labelledby="masterTitle"><h2 id="masterTitle">标记为已掌握？</h2><p class="word">${esc(word.english)}</p><p>确认后移入已掌握词本，跳过本列表中这个词的剩余题目，今后不再抽取。不增加错误次数。</p><div class="row"><button id="masterCancel">取消</button><button id="masterConfirm" class="primary">确认已掌握</button></div></section>`;
        const previousFocus = document.activeElement;
        const settle = confirmed => { overlay.remove(); if (previousFocus?.isConnected) previousFocus.focus(); resolve(confirmed); };
        document.body.appendChild(overlay);
        element('masterCancel').addEventListener('click', () => settle(false));
        element('masterConfirm').addEventListener('click', () => settle(true));
        overlay.addEventListener('click', event => { if (event.target === overlay) settle(false); });
        overlay.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); settle(false); }
            if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === element('masterCancel') ? element('masterConfirm') : element('masterCancel')).focus(); }
        });
        element('masterCancel').focus();
    });
}
function markMastered(word) {
    if (settleDaily()) return;
    if (state.active) snapshotUndo();
    const finished = E.masterWord(state, word);
    if (finished) complete();
    else { persist(); render(); if (page === 'session') autoSpeak(); }
    toast(`${word.english} 已移入已掌握${finished ? '，本轮已完成' : ''}`);
}
function backup() {
    state.backups.push({time: Date.now(), data: JSON.stringify({...state, backups: []})}); state.backups = state.backups.slice(-5); persist();
}
function complete(early = false) {
    const current = state.active;
    if (!current) return;
    if (early) backup();
    const summary = `本轮 ${current.answered} 次作答，${current.answered ? Math.round(current.correct * 100 / current.answered) + '% 正确' : '尚未作答'}，用时 ${clock(current.elapsed)}`;
    E.finish(state, !early); undo = []; persist(); navigate('stats'); toast(summary);
}
function nextTask() {
    if (E.advance(state)) complete(); else { persist(); render(); autoSpeak(); }
}
function begin(kind, supplied) {
    settleDaily();
    if (state.active) { toast('请先继续或结束当前学习列表'); page = 'session'; render(); return; }
    let pool = supplied || selectedWords();
    pool = pool.filter(word => state.records[word.id]?.notebook !== 'mastered');
    if (!supplied && kind === 'new') {
        const inputs = [...document.querySelectorAll('input[data-quota]')];
        const quotas = inputs.length ? Object.fromEntries(inputs.map(input => [input.dataset.quota, Number(input.value)])) : P.quotaDefaults(state, allBooks());
        const session = P.startNew(state, Object.values(words), allBooks(), quotas);
        const shortfall = quotaShortfallText(session);
        if (element('rememberQuotas')?.checked) state.settings.defaultBookCounts = E.clone(quotas);
        undo = []; page = 'session'; persist(); render(); autoSpeak();
        if (shortfall) toast(shortfall + '；未从范围外补足');
        return;
    } else if (!supplied && kind === 'review') pool = P.reviewPool(state, Object.values(words)).words;
    else if (!supplied && kind === 'problem') pool = P.problemPool(state, Object.values(words));
    else if (kind === 'free' && !supplied) {
        const content = element('content')?.value || 'all';
        if (content === 'unlearned') pool = pool.filter(word => !state.learned[word.id]);
        else if (content !== 'all') pool = pool.filter(word => state.records[word.id]?.notebook === content);
        const limit = Number(element('practiceCount').value);
        if (!Number.isInteger(limit) || limit < 0 || limit > 1000) throw Error('本次单词数请输入 0–1000');
        if (state.settings.modules.free.order === 'bookRandom') pool = E.shuffle(pool);
        if (limit) pool = pool.slice(0, limit);
    }
    E.start(state, pool, kind, state.settings.modules[kind]); undo = []; page = 'session'; persist(); render(); autoSpeak();
}
function saveSettings() {
    const prefs = E.clone(state.settings);
    for (const key of ['newCount', 'listCount', 'problemCount', 'exampleTarget', 'dictationTarget', 'spellingTarget']) {
        const value = Number(element(key).value), min = 0;
        if (!Number.isInteger(value) || value < min || value > (key.endsWith('Count') ? 10000 : 1000)) throw Error('数量设置必须是范围内的整数');
        prefs[key] = value;
    }
    for (const key of ['fuzzy', 'firstLetter', 'retry', 'autoSpeak', 'background', 'randomExtraction', 'allowOverlap', 'reviewDueOnly', 'carryOverCountsInNewCount', 'carryOverPreview']) prefs[key] = element(key).checked;
    prefs.defaultBookCounts = Object.fromEntries(allBooks().map((book, index) => {
        const value = Number(element('defaultQuota-' + index).value);
        if (!Number.isInteger(value) || value < 0 || value > 10000) throw Error('词书配额必须是 0–10000 的整数');
        return [book.id, value];
    }));
    for (const key of ['theme', 'accent']) prefs[key] = element(key).value;
    for (const key of ['rate', 'volume', 'opacity']) prefs[key] = Number(element(key).value);
    prefs.reviewDays = element('reviewDays').value.split(/[,，\s]+/).filter(Boolean).map(Number);
    if (!prefs.reviewDays.length || prefs.reviewDays.some(day => !Number.isInteger(day) || day < 0 || day > 365)) throw Error('复习间隔请输入 0–365 天');
    for (const kind of Object.keys(kinds)) {
        const enabled = E.modes.filter(mode => element(`${kind}-${mode}`).checked);
        if (!enabled.length) throw Error(kinds[kind] + '至少启用一种题型');
        prefs.modules[kind] = {modes: enabled, order: element(kind + '-order').value, taskOrder: element(kind + '-taskOrder').value.split(',')};
    }
    state.settings = prefs; persist(); appearance(); render(); toast('设置已保存');
}
async function action(name, value) {
    if (locked) return;
    if (settleDaily() && ['resume', 'pause', 'previewPrev', 'previewReveal', 'previewNext', 'submit', 'hint', 'next', 'skip', 'master', 'undo', 'end', 'speakTask'].includes(name)) return;
    switch (name) {
        case 'nav': navigate(value); break;
        case 'start': begin(value); break;
        case 'resume': if (state.active) { state.active.paused = false; page = 'session'; lastTick = performance.now(); if (E.skipMastered(state)) complete(); else { persist(); render(); autoSpeak(); } } break;
        case 'pause': tick(); state.active.paused = true; stopSpeech(); persist(); render(); break;
        case 'previewPrev': E.movePreview(state, -1); persist(); render(); autoSpeak(); break;
        case 'previewReveal': E.revealPreview(state); persist(); render(); break;
        case 'previewNext': {
            if (E.movePreview(state, 1)) { complete(); break; }
            persist(); render(); autoSpeak(); break;
        }
        case 'submit': {
            const current = state.active, task = current.tasks[current.cursor];
            const input = element('answer').value;
            const hintLimit = task.mode === 'example' && state.settings.firstLetter ? 2 : task.mode !== 'spelling' ? 1 : 0;
            if (!input.trim() && current.hint < hintLimit) { await action('hint'); return; }
            snapshotUndo(); E.submit(state, words[task.word], input); persist(); render(); break;
        }
        case 'hint': state.active.input = element('answer')?.value || ''; state.active.hint++; persist(); render(); break;
        case 'next': nextTask(); break;
        case 'skip': snapshotUndo(); nextTask(); break;
        case 'master': {
            if (await confirmMaster(words[value])) markMastered(words[value]);
            break;
        }
        case 'undo': { const previous = undo.pop(); if (!previous) return toast('没有可撤销的操作'); state.active = previous.active; state.records = previous.records; state.attempts.length = previous.attemptsLength; persist(); render(); break; }
        case 'end': if (confirm('提前结束当前列表？完整完成的单词保留学习状态，未完成的单词下次继续抽取。结束前会保存本地快照。')) complete(true); break;
        case 'speak': speak(E.clean(words[value].english)); break;
        case 'speakTask': speak(state.active.tasks[state.active.cursor].answer); break;
        case 'more': pageLimit += 40; render(); break;
        case 'move': { const [id, target] = value.split('|'); if (target === 'mastered') { if (await confirmMaster(words[id])) markMastered(words[id]); break; } const record = E.record(state, words[id]); record.notebook = target; record.edited = Date.now(); if (target === 'wrong') record.counts = {example: 0, dictation: 0, spelling: 0}; persist(); render(); break; }
        case 'alias': { const record = E.record(state, words[value]); const input = prompt('可接受的自定义答案，用分号分隔。需要在设置中开启自定义答案。', record.aliases.join(';')); if (input !== null) { record.aliases = input.split(/[;；]/).map(E.normalize).filter(Boolean); record.edited = Date.now(); persist(); toast('已保存'); } break; }
        case 'notebookPractice': { const pool = Object.values(words).filter(word => value === 'recent' ? state.attempts.some(attempt => attempt.word === word.id) : state.records[word.id]?.notebook === value); begin('problem', pool); break; }
        case 'historyReview': { const previous = state.sessions.find(item => item.id === value); begin('review', (previous.retainedWords || previous.words).map(id => words[id]).filter(Boolean)); break; }
        case 'saveSettings': saveSettings(); break;
        case 'tts': if (window.Android) Android.ttsSettings(); else toast('浏览器预览使用浏览器语音'); break;
        case 'licenses': licenseText = await (await fetch('third-party-notices.txt')).text(); navigate('licenses'); break;
        case 'export': persist(); if (window.Android) Android.exportBackup(JSON.stringify({...state, backups: []}, null, 2)); else { const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([JSON.stringify({...state, backups: []})], {type: 'application/json'})); anchor.download = 'Z-Android.json'; anchor.click(); URL.revokeObjectURL(anchor.href); } break;
        case 'import': if (window.Android) Android.importFile('json'); else toast('文件导入请在安卓应用中使用'); break;
        case 'csv': if (window.Android) Android.importFile('text'); else toast('文件导入请在安卓应用中使用'); break;
        case 'background': if (window.Android) Android.importFile('background'); else toast('壁纸导入请在安卓应用中使用'); break;
        case 'resetAppearance': state.settings.theme = 'dark'; state.settings.background = false; state.settings.opacity = 94; persist(); appearance(); render(); break;
        case 'restoreLocal': if (confirm('恢复这份快照？当前数据会自动备份。')) restore(state.backups[Number(value)].data); break;
        case 'windowsImport': pendingWindowsImport = {}; if (window.Android) Android.importFile('json'); else toast('请选择 Windows JSON 文件；浏览器预览不提供系统文件选择器'); break;
    }
}
function restore(text) {
    const restored = JSON.parse(text), existingState = state;
    try { state = restored; P.normalize(state); rebuild(); P.validate(restored, new Set(Object.keys(words))); }
    catch (error) { state = existingState; rebuild(); throw error; }
    const previousBackups = existingState.backups || [];
    previousBackups.push({time: Date.now(), data: JSON.stringify({...existingState, backups: []})});
    restored.backups = previousBackups.slice(-5); state = restored; undo = []; persist(); appearance(); navigate('home'); toast('恢复完成；当前数据已保留快照');
}
window.nativeMessage = toast;
window.nativeSpeech = value => { try { speechEvent(typeof value === 'string' ? JSON.parse(value) : value); } catch (error) { toast('未能读取朗读反馈，请重试'); } };
window.nativeBackground = () => { state.settings.background = true; persist(); appearance(); render(); toast('壁纸已导入；其他未保存设置请重新调整'); };
window.nativeCSV = text => {
    try {
        const rows = E.csv(text), name = prompt('为新词书命名', '我的词书'); if (!name?.trim()) return;
        const id = 'custom-' + Date.now(), grouped = new Map();
        for (const row of rows) {
            const wordId = E.normalize(E.clean(row.english));
            const word = grouped.get(wordId) || {id: wordId, english: row.english.trim(), chinese: '', examples: '', pos: row.part_of_speech || row.pos || '', phonetic: row.phonetic || row.ipa || '', phoneticSource: 'import', sources: [{book: id, unit: '导入词表'}]};
            word.chinese = [...new Set([word.chinese, row.chinese].filter(Boolean))].join('\n');
            word.examples = [...new Set((word.examples + '；' + (row.examples || '')).split('；').filter(Boolean))].join('；'); grouped.set(wordId, word);
        }
        if (!grouped.size) throw Error('没有有效词条');
        state.customBooks.push({id, name: name.trim(), words: [...grouped.values()]}); state.settings.book = id; state.settings.units = []; rebuild(); persist(); navigate('practice'); toast(`已导入 ${grouped.size} 个单词`);
    } catch (error) { toast(error.message); }
};
window.nativeImport = text => {
    try {
        const data = JSON.parse(text.replace(/^\uFEFF/, ''));
        const windowsType = window.WindowsMigration.classify(data);
        if (windowsType) { importWindows(data, windowsType); return; }
        if (Array.isArray(data)) {
            if (!data.every(word => word && typeof word.english === 'string' && typeof word.chinese === 'string')) throw Error('旧版错题文件格式不正确');
            if (!confirm(`导入 ${data.length} 条旧版错题？不会覆盖现有学习进度。`)) return;
            backup();
            const missing = data.filter(word => !words[E.normalize(E.clean(word.english))]);
            if (missing.length) {
                const id = 'custom-' + Date.now();
                state.customBooks.push({id, name: '迁移的错题', words: missing.map(word => ({id: E.normalize(E.clean(word.english)), english: word.english, chinese: word.chinese, examples: word.examples || '', pos: word.partOfSpeech || '', sources: [{book: id, unit: '导入词表'}]}))}); rebuild();
            }
            data.forEach(word => { const record = E.record(state, words[E.normalize(E.clean(word.english))]); record.notebook = 'wrong'; record.edited = Date.now(); }); persist(); navigate('notebook'); toast('旧版错题已导入');
        } else if (confirm('恢复这个安卓备份？当前进度将先保存为本地快照。')) restore(text);
    } catch (error) { toast('导入失败，原数据未覆盖：' + error.message); }
};
function importWindows(data, type) {
    if (type === 'bundle') pendingWindowsImport = {study: data.study, notebook: data.notebook, lists: data.lists || []};
    else pendingWindowsImport[type] = data;
    if (!pendingWindowsImport.study || !pendingWindowsImport.notebook) {
        const next = pendingWindowsImport.study ? 'notebook_state.json' : 'study_state.json';
        if (!confirm(`已读取 ${type === 'study' ? 'study_state.json' : 'notebook_state.json'}，尚未修改安卓记录。请继续选择 ${next}。取消将放弃这次迁移。`)) { pendingWindowsImport = {}; return; }
        if (window.Android) Android.importFile('json');
        else toast(`请继续导入 ${next}，尚未修改当前记录`);
        return;
    }
    const result = window.WindowsMigration.convert(pendingWindowsImport, catalog);
    const summary = result.summary;
    const message = `Windows 迁移预览：\n已完成学习 ${summary.learnedWords} 词；错题 ${summary.wrong}；易错 ${summary.prone}；已掌握 ${summary.mastered}。\n历史列表 ${summary.historicalLists} 个；未完成列表 ${summary.activeWords} 词；作答 ${summary.attempts} 次。\n\n这会替换当前安卓进度，不是合并。恢复前会保存本地快照，但请先自行导出备份。复习日期按安卓规则重算，未完成题目按安卓题型重建。\n确认迁移？`;
    if (!confirm(message)) { pendingWindowsImport = {}; return; }
    stopSpeech();
    restore(JSON.stringify(result.state));
    pendingWindowsImport = {};
    toast('Windows 记录迁移完成；可在首页继续未完成列表');
}
window.lifecyclePause = () => {
    stopSpeech();
    tick(); if (state?.active) { state.active.paused = true; persist(); if (page === 'session') render(); }
    element('wallpaper').querySelector('video')?.pause();
};
window.lifecycleResume = () => { settleDaily(); element('wallpaper').querySelector('video')?.play().catch(() => {}); };
window.back = () => { if (element('masterDialog')) { element('masterCancel').click(); return; } if (page !== 'home') navigate('home'); else { persist(); if (window.Android) Android.exit(); } };
document.addEventListener('visibilitychange', () => { if (document.hidden) window.lifecyclePause(); else window.lifecycleResume(); });
document.addEventListener('click', event => { const target = event.target.closest('[data-action]'); if (target) action(target.dataset.action, target.dataset.value).catch(error => toast(error.message)); });
document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && page === 'session' && state.active?.phase === 'preview' && !state.active.paused && !event.target.closest('button,input,select,textarea')) {
        event.preventDefault(); action(E.previewNeedsLayers(state) && (state.active.previewStage || 0) < 2 ? 'previewReveal' : 'previewNext').catch(error => toast(error.message));
    }
    if (event.key === 'Enter' && event.target.id === 'answer') { event.preventDefault(); action('submit').catch(error => toast(error.message)); }
    if (event.key === 'Escape' && page === 'session' && state.active) action(state.active.paused ? 'resume' : 'pause').catch(error => toast(error.message));
});
document.addEventListener('input', event => {
    if (event.target.id === 'answer' && state.active) { state.active.input = event.target.value; persist(); }
    if (event.target.id === 'search') { search = event.target.value; const position = event.target.selectionStart; render(); element('search').focus(); element('search').setSelectionRange(position, position); }
});
document.addEventListener('change', event => {
    const target = event.target;
    const rangeBook = target.dataset.newUnitBook || target.dataset.newUnitsAll;
    if (rangeBook) {
        const book = allBooks().find(book => book.id === rangeBook);
        if (!book) return;
        let selected;
        if (target.dataset.newUnitsAll) selected = target.checked ? book.units.slice() : [];
        else selected = [...document.querySelectorAll('[data-new-unit-book]')].filter(input => input.dataset.newUnitBook === rangeBook && input.checked).map(input => input.value);
        if (selected.length === book.units.length) delete state.settings.newBookUnits[rangeBook];
        else state.settings.newBookUnits[rangeBook] = selected;
        persist(); refreshNewRanges();
    }
    if (event.target.id === 'book') { state.settings.book = event.target.value; state.settings.units = []; persist(); render(); }
    if (event.target.name === 'unit') { state.settings.units = [...document.querySelectorAll('input[name=unit]:checked')].map(input => input.value); persist(); }
    if (event.target.id === 'notebookFilter') { filter = event.target.value; pageLimit = 40; render(); }
});
async function init() {
    catalog = await (await fetch('data.json')).json();
    const raw = window.Android ? Android.load() : localStorage.getItem('kry-state');
    state = raw ? JSON.parse(raw) : E.initial(); P.normalize(state); rebuild(); P.validate(state, new Set(Object.keys(words)));
    if (state.active) state.active.paused = true;
    appearance(); render(); if (!settleDaily()) persist(); setInterval(tick, 1000); setInterval(() => { if (state.active && !state.active.paused) backup(); }, 600000);
}
init().catch(error => { locked = true; element('app').innerHTML = `<section class="card"><h2>未能读取数据</h2><p>${esc(error.message)}</p><p>为保护已有记录，没有覆盖本地文件。请保留应用数据并联系维护者。</p></section>`; });
