'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const hasRussian = /[А-Яа-яЁё]/;
const issues = [];

function walk(relativePath) {
  const full = path.join(root, relativePath);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(relativePath, entry.name);
    return entry.isDirectory() ? walk(child) : [child.replaceAll(path.sep, '/')];
  });
}

function check(name, text) {
  let fenced = false;
  let russianLines = 0;
  for (const [index, original] of text.split(/\r?\n/).entries()) {
    let line = original.trim();
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    if (fenced || !line || /^\|?\s*:?-{3,}/.test(line)) continue;
    if (/^# HTML DBMS$/.test(line)) continue;
    line = line.replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '').trim();
    if (hasRussian.test(line)) russianLines++;
    // This is intentionally a heuristic, not a linguistic proof: a long
    // English-only explanatory line is almost always a documentation defect.
    const latinWords = (line.match(/[A-Za-z]{4,}/g) || []);
    if (!hasRussian.test(line) && latinWords.length >= 4 && line.length > 45) {
      issues.push(name + ':' + (index + 1) + ': пояснительный текст без русского языка');
    }
  }
  assert.ok(russianLines >= 2, name + ': не найден содержательный русский текст');
}

const markdown = [...walk('docs').filter(x => /\.md$/i.test(x)), ...fs.readdirSync(root)
  .filter(x => /\.md$/i.test(x))];
for (const file of markdown) {
  check(file, fs.readFileSync(path.join(root, file), 'utf8'));
}
const requirements = walk('requirements/html-dbms').filter(x => /\.rg\.yaml$/.test(x));
assert.ok(requirements.length >= 5, 'ожидалось не менее пяти нормативных требований');
for (const file of requirements) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const section = source.match(/normative:\s*\|\s*\n([\s\S]*?)(?=\nrelations:|$)/);
  assert.ok(section, file + ': отсутствует нормативный блок');
  check(file, section[1]);
}
assert.deepEqual(issues, [], 'найдены вероятные англоязычные фрагменты документации');
console.log('Документация: русскоязычные фрагменты и нормативные требования проверены');
