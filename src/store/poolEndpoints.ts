export interface PoolEndpoint {
    id: string;
    label: string;
    region: string;
    host: string;
    port: number;
    url: string;
    default?: boolean;
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
        default: !!endpoint?.default
    };
}

export function normalizeBackendPoolEndpoints(pool: any): PoolEndpoint[] {
    const endpoints = Array.isArray(pool?.endpoints)
        ? pool.endpoints.map(normalizeEndpoint).filter((endpoint): endpoint is PoolEndpoint => !!endpoint)
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
