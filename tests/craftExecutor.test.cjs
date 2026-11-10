const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, `../src/utils/${name}.ts`), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const moduleRef = { exports: {} };
  vm.runInNewContext(code, { exports: moduleRef.exports, module: moduleRef, require: (path) => dependencies[path] });
  return moduleRef.exports;
}

const calculator = load('craftCalculator');
const { planNextCraft, ranksCompleteThrough } = load('craftExecutor', { './craftCalculator': calculator });

function state(specs) {
  const catalog = specs.map(([rank], index) => ({ id: index + 1, rank: `rank_${rank.toLowerCase()}` }));
  const counts = new Map();
  const inventory = [];
  for (let index = 0; index < specs.length; index++) {
    const [rank, total, eligible = total] = specs[index];
    counts.set(index + 1, total);
    inventory.push({ cardId: index + 1, rank: `rank_${rank.toLowerCase()}`, instanceIds: Array.from({ length: eligible }, (_, i) => (index + 1) * 100 + i) });
  }
  return { catalog, counts, inventory };
}

test('sends two physical instance IDs, not common card IDs', () => {
  const s = state([['F', 3], ['E', 0]]);
  const step = planNextCraft(s.catalog, s.counts, s.inventory, 'E');
  assert.equal(step.instanceIds.join(','), '100,101');
  assert.equal(step.to, 'E');
});

test('never consumes the only F copy', () => {
  const s = state([['F', 1], ['F', 1], ['E', 0]]);
  assert.equal(planNextCraft(s.catalog, s.counts, s.inventory, 'B'), null);
});

test('protects favorites or awakened copies absent from eligible inventory', () => {
  const s = state([['F', 2, 1], ['E', 0]]);
  assert.equal(planNextCraft(s.catalog, s.counts, s.inventory, 'E'), null);
});

test('E uniques may be spent only when spare F can restore them', () => {
  const noSpare = state([['F', 2], ['E', 1], ['E', 1], ['D', 0]]);
  assert.equal(planNextCraft(noSpare.catalog, noSpare.counts, noSpare.inventory, 'D'), null);
  const enough = state([['F', 5], ['E', 1], ['E', 1], ['D', 0]]);
  const step = planNextCraft(enough.catalog, enough.counts, enough.inventory, 'D');
  assert.equal(step.to, 'D');
  assert.equal(step.restoreCount, 2);
  assert.equal(step.totalSteps, 3);
});

test('rank cap prevents C and B crafting', () => {
  const s = state([['F', 4], ['E', 1], ['D', 3], ['C', 0], ['B', 0]]);
  assert.equal(planNextCraft(s.catalog, s.counts, s.inventory, 'D'), null);
  assert.equal(planNextCraft(s.catalog, s.counts, s.inventory, 'C')?.to, 'C');
});

test('B is not crafted before C is complete', () => {
  const s = state([['F', 1], ['E', 1], ['D', 1], ['D', 1], ['C', 0], ['B', 0]]);
  assert.equal(planNextCraft(s.catalog, s.counts, s.inventory, 'B'), null);
});

test('C craft requires enough F to rebuild D and E after unique sacrifices', () => {
  const short = state([['F', 8], ['E', 1], ['E', 1], ['D', 1], ['D', 1], ['C', 0]]);
  assert.equal(planNextCraft(short.catalog, short.counts, short.inventory, 'C'), null);
  const enough = state([['F', 9], ['E', 1], ['E', 1], ['D', 1], ['D', 1], ['C', 0]]);
  const step = planNextCraft(enough.catalog, enough.counts, enough.inventory, 'C');
  assert.equal(step?.to, 'C');
  assert.equal(step?.totalSteps, 7);
});

test('recovery completion checks every intermediate rank', () => {
  const s = state([['F', 1], ['E', 1], ['D', 0]]);
  assert.equal(ranksCompleteThrough(s.catalog, s.counts, 'E'), true);
  assert.equal(ranksCompleteThrough(s.catalog, s.counts, 'D'), false);
});
