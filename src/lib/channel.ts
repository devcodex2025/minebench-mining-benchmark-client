/**
 * Delivery channel of this build.
 *
 * The channel is baked in at build time (`VITE_APP_CHANNEL`, set by the
 * `build:<channel>` scripts), because it decides which infrastructure the client
 * talks to and which update files it reads. It must never be user-selectable:
 * changing channels means installing a different installer.
 *
 * Everything here is public: the endpoints are compiled into the bundle anyway.
 */

export const CHANNELS = ['stable', 'canary', 'nightly'] as const;

export type Channel = (typeof CHANNELS)[number];

/** Where the release tooling publishes manifests and installers. */
export const DOWNLOADS_BASE = 'https://bitbucket.org/minebenchapp/minebench-client/downloads/';

export const isChannel = (value: unknown): value is Channel =>
  typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);

/**
 * Resolves the channel of this build. Anything missing or unexpected is treated
 * as `stable`, which is the only channel whose endpoints are the compiled
 * production defaults.
 */
export const resolveChannel = (value: unknown): Channel => (isChannel(value) ? value : 'stable');

const buildChannel = (import.meta as unknown as { env?: Record<string, unknown> })?.env
  ?.VITE_APP_CHANNEL;

export const APP_CHANNEL: Channel = resolveChannel(buildChannel);

/**
 * Update manifest this channel reads.
 *
 * `stable` keeps the unprefixed `latest.json`, because that is the URL every
 * pre-0.9 client is compiled with and it must keep working. Channels added later
 * use their own file, so a canary or nightly client can never be served a stable
 * build (or the other way round).
 */
export const manifestFileName = (channel: Channel): string =>
  channel === 'stable' ? 'latest.json' : `${channel}-latest.json`;

export const manifestUrl = (channel: Channel = APP_CHANNEL): string =>
  `${DOWNLOADS_BASE}${manifestFileName(channel)}`;

/** Version pool of the channel: what may be installed, and what may be rolled back to. */
export const versionsUrl = (channel: Channel = APP_CHANNEL): string =>
  `${DOWNLOADS_BASE}${channel}-versions.json`;

/** Explicitly revoked versions of the channel. */
export const revokedUrl = (channel: Channel = APP_CHANNEL): string =>
  `${DOWNLOADS_BASE}${channel}-revoked.json`;
