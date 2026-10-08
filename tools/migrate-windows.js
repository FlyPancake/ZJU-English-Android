'use strict';
const fs = require('node:fs');
const path = require('node:path');
const M = require('../assets/windows-migration.js');
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function run(argv) {
    if (argv.length !== 3) throw Error('Usage: node tools/migrate-windows.js WINDOWS_FOLDER OUTPUT_JSON REPORT_JSON');
    const [root, output, report] = argv.map(file => path.resolve(file));
    const studyPath = path.join(root, 'study_state.json'), notebookPath = path.join(root, 'notebook_state.json');
    const listsPath = path.join(root, 'study_lists');
    const listPaths = fs.existsSync(listsPath) ? fs.readdirSync(listsPath).filter(name => name.endsWith('.json')).sort().map(name => path.join(listsPath, name)) : [];
    const sourcePaths = [studyPath, notebookPath, ...listPaths].map(file => file.toLowerCase());
    if (output === report || [output, report].some(file => sourcePaths.includes(file.toLowerCase()) || file.toLowerCase().startsWith(root.toLowerCase() + path.sep))) throw Error('Output must be outside the Windows source folder');
    const result = M.convert({study: read(studyPath), notebook: read(notebookPath), lists: listPaths.map(read)}, read(path.join(__dirname, '../assets/data.json')));
    fs.writeFileSync(output, JSON.stringify(result.state, null, 2), {encoding: 'utf8', flag: 'wx'});
    fs.writeFileSync(report, JSON.stringify({summary: result.summary, warnings: result.warnings}, null, 2), {encoding: 'utf8', flag: 'wx'});
    console.log(JSON.stringify({output, report, summary: result.summary}, null, 2));
}
if (require.main === module) { try { run(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = {run};
