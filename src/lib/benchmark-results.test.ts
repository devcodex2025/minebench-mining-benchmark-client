import assert from 'node:assert/strict';
import { getVerifiedSharesDelta, getVerifiedSharesTotal } from './benchmark-results.ts';

assert.equal(
    getVerifiedSharesTotal({ activeShares: 7, paidShares: 3 }),
    10,
    'verified share total combines active and already paid shares'
);
assert.equal(getVerifiedSharesTotal(null), null);
assert.equal(getVerifiedSharesDelta(10, 14), 4);
assert.equal(getVerifiedSharesDelta(10, 10), 0);
assert.equal(
    getVerifiedSharesDelta(10, 8),
    null,
    'a decreasing total is not reported as a negative benchmark share count'
);

console.log('benchmark verified shares tests passed');
