import assert from 'node:assert/strict';
import { autoSelectableEndpoints, canUseDirectEndpoint, directStratumForEndpoint, normalizeBackendPoolEndpoints, resolveAccessiblePoolUrl, selectFastestAutoEndpoint, visiblePoolEndpoints } from './poolEndpoints.ts';

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

// Auto-selection must ignore direct endpoints, even when their latency is the
// lowest, and only ever pick non-direct endpoints.
assert.equal(autoSelectableEndpoints(directEndpoints).length, 1);
assert.equal(autoSelectableEndpoints(directEndpoints)[0].url, 'xmr.minebench.cloud:3333');

const autoPicked = selectFastestAutoEndpoint(
    directEndpoints,
    new Map([
        ['xmr.minebench.cloud:3333', 120],
        ['direct.minebench.cloud:3344', 5] // Lower latency, must still be ignored.
    ])
);
assert.equal(autoPicked?.url, 'xmr.minebench.cloud:3333');
assert.equal(autoPicked?.direct, false);

// No reachable latency -> fall back to the non-direct default proxy endpoint.
assert.equal(selectFastestAutoEndpoint(directEndpoints, new Map())?.url, 'xmr.minebench.cloud:3333');

// Explicit choice of the direct endpoint (Mining chip / Settings) still resolves
// to the direct stratum URL; auto-selection never produces it.
const explicitDirectUrl = 'direct.minebench.cloud:3344';
assert.equal(directStratumForEndpoint(directEndpoints, explicitDirectUrl), explicitDirectUrl);
assert.notEqual(autoPicked?.url, explicitDirectUrl);

// No-direct case is unchanged: fastest reachable wins, default is the fallback.
const proxyOnly = normalizeBackendPoolEndpoints({
    endpoints: [
        {
            id: 'global',
            host: 'xmr.minebench.cloud',
            port: 3333,
            url: 'xmr.minebench.cloud:3333',
            default: true
        }
    ]
});
assert.equal(
    selectFastestAutoEndpoint(proxyOnly, new Map([['xmr.minebench.cloud:3333', 90]]))?.url,
    'xmr.minebench.cloud:3333'
);
assert.equal(selectFastestAutoEndpoint(proxyOnly, new Map())?.url, 'xmr.minebench.cloud:3333');

// A direct-only endpoint set is never auto-selected.
const directOnly = normalizeBackendPoolEndpoints({
    endpoints: [
        {
            id: 'direct',
            host: 'direct.minebench.cloud',
            port: 3344,
            url: 'direct.minebench.cloud:3344',
            direct: true
        }
    ]
});
assert.equal(selectFastestAutoEndpoint(directOnly, new Map([['direct.minebench.cloud:3344', 3]])), null);

// --- Direct-endpoint gating -------------------------------------------------
// Only premium app users and direct Monero miners (a real XMR wallet on the
// account) may use the direct endpoint. Regular app users are proxy-only.
const regularUser = { isPremium: false, hasMoneroWallet: false };
const premiumUser = { isPremium: true, hasMoneroWallet: false };
const directMoneroMiner = { isPremium: false, hasMoneroWallet: true };

assert.equal(canUseDirectEndpoint(regularUser), false);
assert.equal(canUseDirectEndpoint(premiumUser), true);
assert.equal(canUseDirectEndpoint(directMoneroMiner), true);

// Premium keeps the direct entry; regular users see only the proxy.
assert.equal(visiblePoolEndpoints(directEndpoints, premiumUser).length, 2);
assert.equal(visiblePoolEndpoints(directEndpoints, premiumUser).some((ep) => ep.direct), true);
assert.equal(visiblePoolEndpoints(directEndpoints, regularUser).length, 1);
assert.equal(visiblePoolEndpoints(directEndpoints, regularUser)[0].url, 'xmr.minebench.cloud:3333');
assert.equal(visiblePoolEndpoints(directEndpoints, regularUser).some((ep) => ep.direct), false);
assert.equal(visiblePoolEndpoints(directEndpoints, directMoneroMiner).length, 2);

// Default/proxy-only users are unchanged by gating.
assert.equal(visiblePoolEndpoints(proxyOnly, regularUser).length, 1);
assert.equal(visiblePoolEndpoints(proxyOnly, regularUser)[0].url, 'xmr.minebench.cloud:3333');

// Explicit selection still resolves to direct for eligible users...
assert.equal(
    directStratumForEndpoint(directEndpoints, explicitDirectUrl, premiumUser),
    explicitDirectUrl
);
// ...but is forced back to the proxy topology for regular users, even if a
// direct URL was persisted by an earlier session.
assert.equal(directStratumForEndpoint(directEndpoints, explicitDirectUrl, regularUser), undefined);
assert.equal(directStratumForEndpoint(directEndpoints, explicitDirectUrl, directMoneroMiner), explicitDirectUrl);
// Legacy callers without an access descriptor are unchanged.
assert.equal(directStratumForEndpoint(directEndpoints, explicitDirectUrl), explicitDirectUrl);

// --- Pool URL coercion on load ---------------------------------------------
// A direct poolUrl persisted by an earlier premium session must not survive for
// an ineligible user: loadSettings/fetchPublicConfig coerce it to the proxy host.
assert.equal(
    resolveAccessiblePoolUrl(explicitDirectUrl, directEndpoints, regularUser, 'xmr.minebench.cloud:3333'),
    'xmr.minebench.cloud:3333'
);
// A premium user keeps the direct selection.
assert.equal(
    resolveAccessiblePoolUrl(explicitDirectUrl, directEndpoints, premiumUser, 'xmr.minebench.cloud:3333'),
    explicitDirectUrl
);
// A direct Monero miner also keeps it.
assert.equal(
    resolveAccessiblePoolUrl(explicitDirectUrl, directEndpoints, directMoneroMiner, 'xmr.minebench.cloud:3333'),
    explicitDirectUrl
);
// An already-selected proxy URL is unchanged for regular users.
assert.equal(
    resolveAccessiblePoolUrl('xmr.minebench.cloud:3333', directEndpoints, regularUser, 'xmr.minebench.cloud:3333'),
    'xmr.minebench.cloud:3333'
);
// Proxy-only endpoint sets are unchanged for regular users.
assert.equal(
    resolveAccessiblePoolUrl('xmr.minebench.cloud:3333', proxyOnly, regularUser, 'xmr.minebench.cloud:3333'),
    'xmr.minebench.cloud:3333'
);
// When only direct endpoints are configured, an ineligible user falls back to
// the proxy fallback supplied by the backend rather than dialing direct.
assert.equal(
    resolveAccessiblePoolUrl(explicitDirectUrl, directOnly, regularUser, 'xmr.minebench.cloud:3333'),
    'xmr.minebench.cloud:3333'
);

console.log('pool endpoint normalization tests passed');
