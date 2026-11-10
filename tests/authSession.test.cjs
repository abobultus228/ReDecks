const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/utils/authSession.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleRef = { exports: {} };
vm.runInNewContext(compiled, { exports: moduleRef.exports, module: moduleRef, decodeURIComponent, Map });
const { findAuthSession } = moduleRef.exports;

test('reads current auth cookie names, including URL-encoded colon and user JSON', () => {
  const cookie = 'auth%3Atoken=fake.jwt.value; auth%3Auser=%7B%22id%22%3A2053263%7D';
  assert.deepEqual({ ...findAuthSession(cookie, {}) }, { token: 'fake.jwt.value', userId: '2053263' });
});

test('keeps support for old cookie names and storage fallback', () => {
  assert.deepEqual({ ...findAuthSession('token=old-token; user=%7B%22id%22%3A42%7D', {}) }, { token: 'old-token', userId: '42' });
  assert.deepEqual({ ...findAuthSession('', { 'auth:token': 'stored-token', 'auth:user': '{"id":7}' }) }, { token: 'stored-token', userId: '7' });
});

test('does not mistake unrelated cookies for credentials', () => {
  assert.deepEqual({ ...findAuthSession('auth:version=2; other_token=nope', {}) }, { token: '', userId: '' });
});
