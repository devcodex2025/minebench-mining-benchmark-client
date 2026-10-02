export interface PoolEndpoint {
    id: string;
    label: string;
    region: string;
    host: string;
    port: number;
    url: string;
    default?: boolean;
    // When true this endpoint speaks direct p2pool stratum, so the miner must
    // log in with the MineBench identity (mb_<solana>[.<worker>]) instead of the
    // Monero wallet used with the proxy topology.
    //
    // Opt-in only: direct endpoints change the attribution model and are NEVER
    // selected by the fastest-ping auto-selection. They are only used after an
    // explicit user choice (Mining chip / Settings), which sets
    // manualPoolSelection.
    direct?: boolean;
}

/**
 * Endpoints eligible for automatic (fastest-ping) selection.
 *
 * Direct-to-p2pool endpoints are opt-in only, so they are excluded here to
 * prevent silently switching a miner to the direct attribution model.
 */
export function autoSelectableEndpoints(endpoints: PoolEndpoint[]): PoolEndpoint[] {
    return endpoints.filter((endpoint) => !endpoint.direct);
}

/**
 * Picks the fastest auto-selectable endpoint from measured latencies.
 *
 * Direct endpoints are ignored even when their latency is the lowest. When no
 * latency is known (or none is reachable) the non-direct `default` proxy
 * endpoint is the fallback. Returns null when every endpoint is direct, so
 * auto-selection can never opt into the direct attribution model by itself.
 */
export function selectFastestAutoEndpoint(
    endpoints: PoolEndpoint[],
    latencyByUrl: ReadonlyMap<string, number>
): PoolEndpoint | null {
    const candidates = autoSelectableEndpoints(endpoints);
    if (candidates.length === 0) return null;

    const reachable = candidates
        .map((endpoint) => ({ endpoint, latencyMs: latencyByUrl.get(endpoint.url) }))
        .filter((entry): entry is { endpoint: PoolEndpoint; latencyMs: number } =>
            entry.latencyMs !== undefined && Number.isFinite(entry.latencyMs))
        .sort((a, b) => a.latencyMs - b.latencyMs);

    return reachable[0]?.endpoint || candidates.find((endpoint) => endpoint.default) || candidates[0];
}

function normalizeEndpoint(endpoint: any): PoolEndpoint | null {
    const host = String(endpoint?.host || endpoint?.stratumHost || '');
    const port = Number(endpoint?.port || endpoint?.stratumPort || 0);
    const url = String(endpoint?.url || (host && port ? `${host}:${port}` : ''));
    const id = String(endpoint?.id || endpoint?.region || url || '');

    if (!id || !host || port <= 0 || !url.includes(':')) return null;

    return {
        id,
        label: String(endpoint?.label || endpoint?.region || host || 'MineBench Pool'),
        region: String(endpoint?.region || endpoint?.id || 'GLOBAL'),
        host,
        port,
        url,
        default: !!endpoint?.default,
        direct: !!endpoint?.direct
    };
}

/**
 * Returns the direct-to-p2pool stratum endpoint URL for the active pool when
 * that endpoint is flagged as direct, otherwise undefined so the miner keeps
 * using the default proxy topology (-u <wallet> + --rig-id).
 */
export function directStratumForEndpoint(endpoints: PoolEndpoint[], url: string): string | undefined {
    const endpoint = endpoints.find((candidate) => candidate.url === url);
    return endpoint?.direct ? endpoint.url : undefined;
}

export function normalizeBackendPoolEndpoints(pool: any): PoolEndpoint[] {
    const endpoints: PoolEndpoint[] = Array.isArray(pool?.endpoints)
        ? pool.endpoints
            .map((endpoint: unknown) => normalizeEndpoint(endpoint))
            .filter((endpoint: PoolEndpoint | null): endpoint is PoolEndpoint => endpoint !== null)
        : [];

    const backup = normalizeEndpoint({
        id: 'backup',
        label: 'MineBench Reserve Pool',
        region: 'BACKUP',
        host: pool?.backup?.stratumHost,
        port: pool?.backup?.stratumPort,
        default: false
    });

    if (backup && !endpoints.some((endpoint) => endpoint.url === backup.url)) {
        endpoints.push(backup);
    }

    return endpoints;
}
