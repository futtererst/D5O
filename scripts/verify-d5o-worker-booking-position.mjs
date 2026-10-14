import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../app/work/my-schedule/booking-position.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, Date });
const ended = exports.bookingShiftEnded;
assert.equal(ended('2026-10-13', '07:00–15:30', new Date(2026, 9, 13, 15, 29)), false);
assert.equal(ended('2026-10-13', '07:00–15:30', new Date(2026, 9, 13, 15, 30)), true);
assert.equal(ended('2026-10-13', '22:00–02:00', new Date(2026, 9, 14, 1, 59)), false);
assert.equal(ended('2026-10-13', '22:00–02:00', new Date(2026, 9, 14, 2, 0)), true);
assert.equal(ended(undefined, '07:00–15:30', new Date(2026, 9, 14)), false);
assert.equal(ended('2026-02-30', '07:00–15:30', new Date(2026, 2, 1)), false);
console.log('Worker booking presentation: current, ended, overnight and invalid dates handled.');
