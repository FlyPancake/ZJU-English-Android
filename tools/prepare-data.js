'use strict';
const fs = require('node:fs');
const path = require('node:path');
const E = require('../assets/engine.js');
const upstream = path.resolve(process.argv[2] || '../../../work/upstream');
const root = path.resolve(__dirname, '..');
const records = new Map(), books = [];
const phoneticsPath = path.join(root, 'assets/phonetics.json');
const phonetics = fs.existsSync(phoneticsPath) ? JSON.parse(fs.readFileSync(phoneticsPath, 'utf8')) : {};
const positions = new Map();
const positionText = fs.readFileSync(path.join(upstream, 'data/parts_of_speech.csv'), 'utf8');
const positionRows = E.csv(positionText.replace(/^\uFEFF/, '').replace(/^([^\r\n]+)/, '$1,chinese'));
for (const row of positionRows) positions.set(E.normalize(row.english), row.part_of_speech || '');
for (const book of ['book2', 'book3']) {
    const directory = path.join(upstream, 'data', book);
    const files = fs.readdirSync(directory).filter(file => file.endsWith('.csv')).sort((left, right) => left.localeCompare(right, 'en', {numeric: true}));
    books.push({id: book, name: book === 'book2' ? '大学英语 Book 2' : '大学英语 Book 3', units: files.map(file => file.slice(0, -4))});
    for (const file of files) for (const row of E.csv(fs.readFileSync(path.join(directory, file), 'utf8'))) {
        const id = E.normalize(E.clean(row.english));
        const word = records.get(id) || {id, english: row.english.trim(), chinese: '', examples: '', pos: row.part_of_speech || row.pos || positions.get(id) || '', sources: []};
        word.chinese = [...new Set([word.chinese, row.chinese.trim()].filter(Boolean))].join('\n');
        word.examples = [...new Set((word.examples + '；' + row.examples).split('；').map(value => value.trim()).filter(Boolean))].join('；');
        const source = {book, unit: file.slice(0, -4)};
        if (!word.sources.some(item => item.book === source.book && item.unit === source.unit)) word.sources.push(source);
        records.set(id, word);
    }
}
const data = {books, words: [...records.values()]};
for (const word of data.words) {
    const head = E.normalize(E.clean(word.english));
    word.phonetic = phonetics[head] || '';
    word.phoneticSource = word.phonetic ? 'dictionary' : '';
    const parts = head.match(/[a-z]+(?:'[a-z]+)?/g) || [];
    if (!word.phonetic && parts.length > 1 && parts.every(token => phonetics[token] && !['sb', 'sth'].includes(token))) {
        word.phonetic = parts.map(token => phonetics[token]).join(' ');
        word.phoneticSource = 'components';
    }
}
fs.writeFileSync(path.join(root, 'assets/data.json'), JSON.stringify(data));
let notices = fs.readFileSync(path.join(upstream, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const phoneticsLicense = path.join(root, 'assets/ECDICT-PHONETICS-LICENSE.txt');
if (fs.existsSync(phoneticsLicense)) notices += '\n\n# ECDICT 音标子集\n\n音标提取自 skywind3000/ECDICT 的 ecdict.csv。词典音标直接保留；词组拼接音标在界面注明「按组成词标注」。以下保留来源仓库的许可全文。\n\n' + fs.readFileSync(phoneticsLicense, 'utf8');
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), notices);
fs.writeFileSync(path.join(root, 'assets/third-party-notices.txt'), notices);
console.log(`${books.length} books, ${books.reduce((sum, book) => sum + book.units.length, 0)} units, ${records.size} unique words`);
