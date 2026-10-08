'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const E = require('../assets/engine.js');
const root = path.resolve(__dirname, '..');
const dictionary = process.argv[2];
if (!dictionary) throw Error('Usage: node tools/prepare-phonetics.js /path/to/ecdict.csv');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/data.json'), 'utf8'));
const tokens = value => value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
const wanted = new Set();
for (const word of catalog.words) {
    wanted.add(E.normalize(E.clean(word.english)));
    for (const token of tokens(E.clean(word.english))) wanted.add(token);
}
(async () => {
    const lines = readline.createInterface({input: fs.createReadStream(dictionary), crlfDelay: Infinity});
    const phonetics = {};
    let header;
    for await (const line of lines) {
        if (!header) { header = line.replace(/^\uFEFF/, '').replace(/^word,/, 'english,').replace(',translation,', ',chinese,'); continue; }
        const first = line.match(/^("(?:[^"]|"")*"|[^,]*)/);
        if (!first) continue;
        const key = E.normalize(first[1].replace(/^"|"$/g, '').replace(/""/g, '"'));
        if (!wanted.has(key)) continue;
        const row = E.csv(header + '\n' + line)[0];
        if (row?.phonetic?.trim()) phonetics[key] = row.phonetic.trim();
    }
    let direct = 0, components = 0;
    for (const word of catalog.words) {
        const head = E.normalize(E.clean(word.english));
        word.phonetic = phonetics[head] || '';
        word.phoneticSource = word.phonetic ? 'dictionary' : '';
        if (word.phonetic) direct++;
        else {
            const parts = tokens(head);
            if (parts.length > 1 && parts.every(token => phonetics[token] && !['sb', 'sth'].includes(token))) {
                word.phonetic = parts.map(token => phonetics[token]).join(' ');
                word.phoneticSource = 'components'; components++;
            }
        }
    }
    fs.writeFileSync(path.join(root, 'assets/data.json'), JSON.stringify(catalog));
    fs.writeFileSync(path.join(root, 'assets/phonetics.json'), JSON.stringify(phonetics));
    console.log(JSON.stringify({direct, components, unavailable: catalog.words.length - direct - components, entries: Object.keys(phonetics).length}));
})().catch(error => { console.error(error); process.exitCode = 1; });
