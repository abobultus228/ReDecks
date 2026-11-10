const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/api/extra.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const calls = [];
const CapacitorHttp = {
  get: async (request) => {
    calls.push({ method: 'GET', ...request });
    return { status: 200, data: { next: null, results: [{
      id: 25573126, card: { id: 13008, rank: 'rank_f', title: { id: 8154 } },
      is_favorite: false, stack_count: 3,
      cards: [{ id: 25573126, is_awakened: false }, { id: 27501966, is_awakened: false }, { id: 52835547, is_awakened: true }],
    }] } };
  },
  post: async (request) => {
    calls.push({ method: 'POST', ...request });
    return { status: 200, data: { id: 190731, rank: 'rank_e', title: { id: 8154 } } };
  },
};
const moduleRef = { exports: {} };
vm.runInNewContext(code, {
  exports: moduleRef.exports, module: moduleRef, URLSearchParams,
  require: (name) => name === '@capacitor/core' ? { CapacitorHttp } : { makeHeaders: () => ({ authorization: 'Bearer test' }) },
});
const { getCraftInventory, mergeCraftCards } = moduleRef.exports;

test('inventory parser keeps common card ID separate from physical IDs', async () => {
  const result = await getCraftInventory('test', 220944, 8154);
  assert.equal(result[0].cardId, 13008);
  assert.equal(result[0].instanceIds.join(','), '25573126,27501966');
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/api/v3/inventory/items/cards/220944/');
  assert.equal(url.searchParams.get('card__title_id__in'), '8154');
  assert.equal(url.searchParams.get('is_favorite'), 'false');
  assert.equal(url.searchParams.get('is_awakened'), 'false');
});

test('merge sends exactly two physical IDs with type 1', async () => {
  await mergeCraftCards('test', 220944, [25573126, 27501966]);
  const post = calls.find((call) => call.method === 'POST');
  assert.equal(post.url, 'https://api.remanga.org/api/inventory/220944/cards/merge/');
  assert.equal(post.data.cards.join(','), '25573126,27501966');
  assert.equal(post.data.type, 1);
});
