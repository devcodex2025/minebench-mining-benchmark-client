import assert from 'node:assert/strict';
import { getMinerMsrStatusFromOutput } from './miner-msr.ts';

assert.equal(
    getMinerMsrStatusFromOutput('\u001b[1;32mmsr\u001b[0m      register values for "AMD Ryzen" preset has been set successfully (1 ms)'),
    'enabled',
);
assert.equal(
    getMinerMsrStatusFromOutput('msr      register 0x000001a4 already set to 0x000000000000000f'),
    null,
);
assert.equal(getMinerMsrStatusFromOutput('msr      FAILED TO APPLY MSR MOD, HASHRATE WILL BE LOW'), 'unavailable');
assert.equal(getMinerMsrStatusFromOutput('msr      cannot set MSR 0x000001a4'), 'unavailable');
assert.equal(getMinerMsrStatusFromOutput('cpu      use argon2 implementation AVX2'), null);
assert.equal(getMinerMsrStatusFromOutput('msr      preset selected'), null);

console.log('miner MSR telemetry tests passed');
