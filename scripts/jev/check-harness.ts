import assert from 'node:assert/strict';
import { groundingPolicy, readSignals } from './harness';

assert.equal(groundingPolicy('supported', .99, { support: .98, contradiction: .01 }), 'accept');
assert.equal(groundingPolicy('supported', .99), 'review');
assert.equal(groundingPolicy('supported', .99, { support: .94, contradiction: .01 }), 'review');
assert.equal(groundingPolicy('supported', .99, { support: .99, contradiction: .8 }), 'review');
assert.equal(groundingPolicy('contradicted', .99, { support: .99, contradiction: .01 }), 'review');
assert.equal(groundingPolicy('supported', .8, { support: .99, contradiction: .01 }), 'review');
assert.equal(groundingPolicy('supported', NaN, { support: .99, contradiction: .01 }), 'review');
assert.equal(groundingPolicy('supported', 2, { support: .99, contradiction: .01 }), 'review');
assert.equal(groundingPolicy('supported', .99, { support: 2, contradiction: -1 }), 'review');
assert.deepEqual(readSignals({ all_parts_supported: { type: 'noul', noul: 0 }, explicit_conflict: { type: 'noul', noul: 1 } }), { support: 0, contradiction: 1 });
for (const bad of [null, {}, { all_parts_supported: { type: 'noul', noul: '1' } }, { all_parts_supported: { type: 'noul', noul: NaN }, explicit_conflict: { type: 'noul', noul: 0 } }]) assert.throws(() => readSignals(bad));
console.log('PASS harness: missing/invalid/contradictory signals and low confidence always require review.');
