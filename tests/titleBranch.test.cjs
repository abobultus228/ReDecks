const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/utils/titleBranch.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleRef = { exports: {} };
vm.runInNewContext(compiled, { exports: moduleRef.exports, module: moduleRef });
const { resolveTitleBranchId } = moduleRef.exports;

test('keeps the explicit active branch when available', () => {
  assert.equal(resolveTitleBranchId({ active_branch: 12, branches: [{ id: 13, count_chapters: 5 }] }), 12);
});

test('uses a branch from the current title response when active_branch is absent', () => {
  assert.equal(resolveTitleBranchId({ branches: [{ id: 157474, count_chapters: 14 }] }), 157474);
});

test('skips empty branches and rejects titles without a valid branch', () => {
  assert.equal(resolveTitleBranchId({ branches: [{ id: 1, count_chapters: 0 }, { id: 2, count_chapters: 3 }] }), 2);
  assert.equal(resolveTitleBranchId({ branches: [] }), null);
});
