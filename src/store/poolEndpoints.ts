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
    direct?: boolean;
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
