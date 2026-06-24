import assert from 'node:assert/strict';
import { normalizeBackendPoolEndpoints } from './poolEndpoints.ts';

const endpoints = normalizeBackendPoolEndpoints({
    endpoints: [
        {
            id: 'global',
            label: 'XMR Pool MineBench',
            region: 'GLOBAL',
            host: 'xmr.minebench.cloud',
            port: 3333,
            url: 'xmr.minebench.cloud:3333',
            default: true
        }
    ],
    backup: {
        stratumHost: '62.3.50.200',
        stratumPort: 3333
    }
});

assert.equal(endpoints.length, 2);
assert.equal(endpoints[0].url, 'xmr.minebench.cloud:3333');
assert.equal(endpoints[1].id, 'backup');
assert.equal(endpoints[1].url, '62.3.50.200:3333');

const deduped = normalizeBackendPoolEndpoints({
    endpoints: [
        {
            id: 'global',
            host: 'xmr.minebench.cloud',
            port: 3333,
            url: 'xmr.minebench.cloud:3333'
        }
    ],
    backup: {
        stratumHost: 'xmr.minebench.cloud',
        stratumPort: 3333
    }
});

assert.equal(deduped.length, 1);

console.log('pool endpoint normalization tests passed');
