import assert from 'node:assert/strict';
import { directStratumForEndpoint, normalizeBackendPoolEndpoints } from './poolEndpoints.ts';

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

const directEndpoints = normalizeBackendPoolEndpoints({
    endpoints: [
        {
            id: 'proxy',
            host: 'xmr.minebench.cloud',
            port: 3333,
            url: 'xmr.minebench.cloud:3333',
            default: true
        },
        {
            id: 'direct',
            host: 'direct.minebench.cloud',
            port: 3344,
            url: 'direct.minebench.cloud:3344',
            direct: true
        }
    ]
});

assert.equal(directEndpoints.length, 2);
assert.equal(directEndpoints[0].direct, false);
assert.equal(directEndpoints[1].direct, true);
// Direct endpoint selection must resolve to the mb_ login endpoint.
assert.equal(
    directStratumForEndpoint(directEndpoints, 'direct.minebench.cloud:3344'),
    'direct.minebench.cloud:3344'
);
// Proxy/default endpoints must not trigger direct stratum mode.
assert.equal(directStratumForEndpoint(directEndpoints, 'xmr.minebench.cloud:3333'), undefined);
assert.equal(directStratumForEndpoint(directEndpoints, 'unknown:9999'), undefined);

console.log('pool endpoint normalization tests passed');
