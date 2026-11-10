const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file, requireMock) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const moduleRef = { exports: {} };
  vm.runInNewContext(code, { exports: moduleRef.exports, module: moduleRef, require: requireMock, URLSearchParams, setTimeout });
  return moduleRef.exports;
}

const logic = compile('../src/utils/repassLogic.ts', () => ({}));

test('genre and category OR filters use separate unstrict_search_fields parameters', async () => {
  let catalogUrl = '';
  const CapacitorHttp = { get: async ({ url }) => {
    if (url.includes('/v2/titles/genres/')) return { status: 200, data: [{ id: 1, name: 'Комедия' }, { id: 2, name: 'Повседневность' }] };
    if (url.includes('/v2/titles/categories/')) return { status: 200, data: [{ id: 3, name: 'Учитель' }, { id: 4, name: 'Ученик' }] };
    catalogUrl = url;
    return { status: 200, data: { results: [], next: null } };
  } };
  const api = compile('../src/api/repass.ts', (name) => {
    if (name === '@capacitor/core') return { CapacitorHttp };
    if (name === './remanga') return { makeHeaders: () => ({}) };
    return logic;
  });
  const groups = [
    { kind: 'genres', names: ['Комедия', 'Повседневность'], description: '' },
    { kind: 'categories', names: ['Учитель', 'Ученик'], description: '' },
  ];
  for await (const _title of api.findRepassTitles('test-token', groups)) { /* no results */ }
  const params = new URL(catalogUrl).searchParams;
  assert.equal(params.getAll('unstrict_search_fields').join(','), 'genres,categories');
  assert.equal(params.get('unstrict_search_fields'), 'genres');
  assert.equal(params.getAll('genres').join(','), '1,2');
  assert.equal(params.getAll('categories').join(','), '3,4');
});
