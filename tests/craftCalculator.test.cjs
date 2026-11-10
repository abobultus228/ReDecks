const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/utils/craftCalculator.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleRef = { exports: {} };
vm.runInNewContext(compiled, { exports: moduleRef.exports, module: moduleRef });
const { calculateCrafts } = moduleRef.exports;

function sample(specs) {
  const cards = [];
  const stacks = new Map();
  for (let i = 0; i < specs.length; i++) {
    const [rank, count] = specs[i];
    cards.push({ id: i + 1, rank: `rank_${rank.toLowerCase()}` });
    if (count) stacks.set(i + 1, count);
  }
  return calculateCrafts(cards, stacks);
}

function rank(result, name) {
  return result.ranks.find((item) => item.rank === name);
}

test('last F copies are never consumed', () => {
  const result = sample([['F', 1], ['F', 1], ['E', 0]]);
  assert.equal(result.projectedOwned, 2);
  assert.equal(result.blockedAt, 'E');
  assert.equal(result.extraFNeeded, 2);
});

test('two spare F copies create one missing E', () => {
  const result = sample([['F', 2], ['F', 2], ['E', 0]]);
  assert.equal(result.projectedOwned, 3);
  assert.equal(result.physicalOwned, 4);
  assert.equal(result.projectedCopies, 3);
  assert.equal(rank(result, 'E').crafts, 1);
  assert.equal(result.extraFNeeded, 0);
});

test('unique E cards cannot be sacrificed without enough F to restore both', () => {
  const result = sample([['F', 2], ['F', 2], ['E', 1], ['E', 1], ['D', 0]]);
  assert.equal(result.projectedOwned, 4);
  assert.equal(result.blockedAt, 'D');
  assert.equal(result.extraFNeeded, 2);
});

test('D craft restores its two unique E inputs from four spare F', () => {
  const result = sample([['F', 3], ['F', 3], ['E', 1], ['E', 1], ['D', 0]]);
  assert.equal(result.projectedOwned, 5);
  assert.equal(rank(result, 'E').projected, 2);
  assert.equal(rank(result, 'E').crafts, 2);
  assert.equal(rank(result, 'D').crafts, 1);
});

test('two E duplicates craft D without F resources', () => {
  const result = sample([['F', 1], ['E', 2], ['E', 2], ['D', 0]]);
  assert.equal(result.projectedOwned, 4);
  assert.equal(rank(result, 'E').crafts, 0);
  assert.equal(rank(result, 'D').crafts, 1);
});

test('an incomplete C rank blocks B crafting', () => {
  const result = sample([['F', 1], ['E', 1], ['D', 1], ['D', 1], ['C', 0], ['B', 0]]);
  assert.equal(result.blockedAt, 'C');
  assert.equal(rank(result, 'B').crafts, 0);
});

test('A and S are counted but never crafted', () => {
  const result = sample([['F', 2], ['F', 2], ['E', 0], ['A', 1], ['S', 1]]);
  assert.equal(result.currentOwned, 4);
  assert.equal(result.projectedOwned, 5);
  assert.equal(rank(result, 'A').crafts, 0);
  assert.equal(rank(result, 'S').crafts, 0);
});

test('missing F is separate from expendable F deficit', () => {
  const result = sample([['F', 1], ['F', 0], ['E', 0]]);
  assert.equal(result.missingF, 1);
  assert.equal(result.extraFNeeded, 2);
});

test('a single E card cannot be doubled when E rank is complete', () => {
  const result = sample([['F', 10], ['E', 1], ['D', 0]]);
  assert.equal(result.projectedOwned, 2);
  assert.equal(result.extraFNeeded, null);
});

test('surplus is reported only after F–B are complete', () => {
  const result = sample([['F', 3], ['E', 2], ['D', 2], ['C', 2], ['B', 2]]);
  assert.equal(result.completeThroughB, true);
  assert.equal(result.surplusFEquivalent, 32);
});
