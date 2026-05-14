import { getEnvironmentConfig } from '../config/environment';
import { nativeApi } from './native-api';

type BackendRequestOptions = {
  method?: 'GET' | 'POST';
  body?: any;
  token?: string | null;
};

export class BackendApiError extends Error {
  status: number;
  payload: any;

  constructor(status: number, payload: any, fallback: string) {
    const message = payload?.message || payload?.error || fallback;
    super(message);
    this.name = 'BackendApiError';
    this.status = status;
    this.payload = payload;
  }
}

export async function backendJson<T = any>(path: string, options: BackendRequestOptions = {}): Promise<T> {
  const method = options.method || 'GET';
  const isNative = (window as any).__TAURI_INTERNALS__;

  if (isNative) {
    const result = await nativeApi.invoke<{ ok: boolean; status: number; data: any; text: string }>('backend_request', {
      request: {
        method,
        path,
        body: options.body,
        token: options.token || null
      }
    });

    if (!result.ok) {
      throw new BackendApiError(result.status, result.data, `Backend request failed (${result.status})`);
    }

    return result.data as T;
  }

  const env = getEnvironmentConfig();
  const base = env.apiBaseUrl.replace(/\/+$/, '');
  const backendBase = env.backendUrl.replace(/\/+$/, '');
  const url = path.startsWith('/api/')
    ? `${base}${path.slice('/api'.length)}`
    : path.startsWith('/public/')
      ? `${backendBase}${path}`
    : path;
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(url, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(15000)
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new BackendApiError(response.status, payload, `Backend request failed (${response.status})`);
  }

  return payload as T;
}
