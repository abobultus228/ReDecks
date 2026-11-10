const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/utils/repassRun.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

function harness(readStatus = 200, unreadFails = false) {
  const calls = [];
  let stored = null;
  const Preferences = {
    get: async () => ({ value: stored }),
    set: async ({ value }) => { calls.push('save'); stored = value; },
    remove: async () => { calls.push('clear'); stored = null; },
  };
  const extra = {
    readChapter: async () => { calls.push('read'); return { status: readStatus }; },
    markChapterUnread: async () => { calls.push('unread'); if (unreadFails) throw new Error('HTTP 502'); },
  };
  const moduleRef = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: moduleRef.exports,
    module: moduleRef,
    require: (name) => name === '@capacitor/preferences' ? { Preferences } : extra,
  });
  return { ...moduleRef.exports, calls, getStored: () => stored };
}

test('originally unread chapter is read then made unread', async () => {
  const h = harness();
  await h.runRepassChapter('token', { userId: '1', chapterId: 10, titleName: 'Title', originallyViewed: false });
  assert.equal(h.calls.join(','), 'save,read,unread,clear');
  assert.equal(h.getStored(), null);
});

test('originally read chapter is reset before reading and left read', async () => {
  const h = harness();
  await h.runRepassChapter('token', { userId: '1', chapterId: 10, titleName: 'Title', originallyViewed: true });
  assert.equal(h.calls.join(','), 'save,unread,read,clear');
});

test('failed read still restores originally unread chapter', async () => {
  const h = harness(502);
  await assert.rejects(() => h.runRepassChapter('token', { userId: '1', chapterId: 10, titleName: 'Title', originallyViewed: false }));
  assert.equal(h.calls.join(','), 'save,read,unread,clear');
});

test('failed restoration keeps a journal for recovery', async () => {
  const h = harness(200, true);
  await assert.rejects(() => h.runRepassChapter('token', { userId: '1', chapterId: 10, titleName: 'Title', originallyViewed: false }));
  assert.ok(h.getStored());
  assert.equal(h.calls.join(','), 'save,read,unread');
});
