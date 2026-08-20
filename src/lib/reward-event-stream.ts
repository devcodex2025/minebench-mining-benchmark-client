import { getEnvironmentConfig } from '../config/environment';
import { authStorage } from './auth-storage';

export type ServerRewardEventType = 'rewards-distributed' | 'payout-completed';

export interface ServerRewardEvent {
  id: string;
  type: ServerRewardEventType;
}

const KNOWN_EVENTS = new Set<ServerRewardEventType>(['rewards-distributed', 'payout-completed']);
const MAX_EVENT_BUFFER = 64 * 1024;
const MAX_RECONNECT_DELAY_MS = 30_000;

const getEventStreamUrl = () => {
  const base = getEnvironmentConfig().apiBaseUrl.replace(/\/+$/, '');
  return `${base}/rewards/events`;
};

export const subscribeToRewardEvents = (
  onEvent: (event: ServerRewardEvent) => void
): (() => void) => {
  let stopped = false;
  let reconnectDelayMs = 1_000;
  let reconnectTimer: number | null = null;
  let controller: AbortController | null = null;
  let lastEventId = '';

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== null) return;
    const jitter = Math.floor(Math.random() * Math.min(1_000, reconnectDelayMs / 2));
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, reconnectDelayMs + jitter);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  };

  const connect = async () => {
    const token = authStorage.getToken();
    if (stopped || !token) return;

    controller = new AbortController();
    let permanentFailure = false;
    try {
      const response = await fetch(getEventStreamUrl(), {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`
        },
        cache: 'no-store',
        signal: controller.signal
      });

      if ([401, 403, 404].includes(response.status)) {
        permanentFailure = true;
        return;
      }
      if (!response.ok || !response.body) throw new Error(`Reward event stream failed (${response.status})`);

      reconnectDelayMs = 1_000;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        if (buffer.length > MAX_EVENT_BUFFER) throw new Error('Reward event stream buffer exceeded');

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');

          let id = '';
          let type = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('id:')) id = line.slice(3).trim();
            if (line.startsWith('event:')) type = line.slice(6).trim();
          }

          if (
            id &&
            id !== lastEventId &&
            id.length <= 256 &&
            KNOWN_EVENTS.has(type as ServerRewardEventType)
          ) {
            lastEventId = id;
            onEvent({ id, type: type as ServerRewardEventType });
          }
        }
      }
    } catch (error) {
      if (!stopped && !(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('[Rewards] Event stream disconnected; reconnecting with backoff');
      }
    } finally {
      controller = null;
      if (!permanentFailure) scheduleReconnect();
    }
  };

  void connect();

  return () => {
    stopped = true;
    controller?.abort();
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
  };
};
