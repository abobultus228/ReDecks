const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/utils/repassLogic.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleRef = { exports: {} };
vm.runInNewContext(compiled, { exports: moduleRef.exports, module: moduleRef });
const { extractRepassGroups, buildRepassVariants, matchesRepassGroups } = moduleRef.exports;

test('extracts active task tags and ignores completed tasks', () => {
  const payload = { tasks: [
    { description: '<p>Жанр: Фэнтези, Драма.</p>', progress: 0, goal: 1 },
    { description: 'Категория: Манга', is_completed: true },
    { description: 'Категория: Вебтун; Манхва', progress: 0, goal: 1 },
  ] };
  const groups = extractRepassGroups(payload);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].kind, 'genres');
  assert.equal(groups[0].names.join(','), 'Фэнтези,Драма');
  assert.equal(groups[1].kind, 'categories');
});

test('one task uses OR, multiple tasks use AND in query variants', () => {
  const groups = [
    { kind: 'genres', names: ['Фэнтези', 'Драма'] },
    { kind: 'genres', names: ['Романтика', 'Комедия'] },
    { kind: 'categories', names: ['Манга', 'Манхва'] },
  ];
  const lookups = {
    genres: new Map([['фэнтези', 1], ['драма', 2], ['романтика', 3], ['комедия', 4]]),
    categories: new Map([['манга', 5], ['манхва', 6]]),
  };
  const variants = buildRepassVariants(groups, lookups);
  assert.equal(variants.length, 4);
  assert.equal(variants[0].genres.join(','), '1,3');
  assert.equal(variants[0].categories.join(','), '5,6');
  assert.equal(variants[0].unstrict, 'categories');
});

test('title must satisfy every active group', () => {
  const groups = [
    { kind: 'genres', names: ['Фэнтези', 'Драма'] },
    { kind: 'categories', names: ['Манхва'] },
  ];
  const matching = { genres: [{ name: 'Фэнтези' }], categories: [{ name: 'Манхва' }] };
  assert.equal(matchesRepassGroups(matching, groups).join(','), 'Фэнтези,Манхва');
  assert.equal(matchesRepassGroups({ ...matching, categories: [] }, groups), null);
});
