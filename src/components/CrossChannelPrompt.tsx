import { useEffect, useState } from 'react';
import { nativeApi, type CrossChannelPresence } from '../lib/native-api';

/**
 * Blocks the client when another delivery channel is already running.
 *
 * The channels are separate applications with their own identity, data and
 * installer, and they must never run at the same time: two miners on one machine
 * would fight over the same hardware and corrupt benchmark and reward
 * attribution. Tauri's single-instance plugin only covers this channel, so the
 * Rust side reports a conflicting channel here and offers to close it.
 */
export const CrossChannelPrompt = () => {
  const [other, setOther] = useState<CrossChannelPresence | null>(null);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!(window as any).__TAURI_INTERNALS__) return;
    nativeApi.crossChannel
      .conflict()
      .then(setOther)
      .catch((err) => console.error('[CrossChannel] check failed:', err));
  }, []);

  if (!other) return null;

  const closeOther = async () => {
    setClosing(true);
    setError(null);
    try {
      await nativeApi.crossChannel.closeOther();
      setOther(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClosing(false);
    }
  };

  const quitThisClient = () => {
    // Reuses the app's own quit path, so the miner is stopped properly.
    nativeApi.invoke<void>('window_close').catch((err) =>
      console.error('[CrossChannel] failed to close the window:', err)
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cross-channel-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-6"
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 text-zinc-100 shadow-2xl">
        <h2 id="cross-channel-title" className="text-base font-semibold">
          Another MineBench channel is already running
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          <span className="font-medium">{other.productName}</span>{' '}
          <span className="font-mono text-xs">{other.version}</span> is running right now. Only one
          channel can run at a time.
        </p>
        {error && (
          <p className="mt-3 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={quitThisClient}
            disabled={closing}
            className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            Quit this client
          </button>
          <button
            type="button"
            onClick={closeOther}
            disabled={closing}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {closing ? 'Closing the other channel…' : 'Close it and continue'}
          </button>
        </div>
      </div>
    </div>
  );
};
