const AUTH_TOKEN_KEY = 'minebench_auth_token';
const WALLET_SIGNATURE_KEY = 'minebench_signature';

const getSessionStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const getLocalStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const getSecret = (key: string) => {
  const sessionValue = getSessionStorage()?.getItem(key);
  if (sessionValue) return sessionValue;

  const local = getLocalStorage();
  const localValue = local?.getItem(key) || null;
  if (localValue) {
    getSessionStorage()?.setItem(key, localValue);
  }
  return localValue;
};

const setSecret = (key: string, value: string) => {
  getSessionStorage()?.setItem(key, value);
  getLocalStorage()?.setItem(key, value);
};

const removeSecret = (key: string) => {
  getSessionStorage()?.removeItem(key);
  getLocalStorage()?.removeItem(key);
};

export const authStorage = {
  getToken: () => getSecret(AUTH_TOKEN_KEY),
  setToken: (token: string) => setSecret(AUTH_TOKEN_KEY, token),
  removeToken: () => removeSecret(AUTH_TOKEN_KEY),
  getSignature: () => getSecret(WALLET_SIGNATURE_KEY),
  setSignature: (signature: string) => setSecret(WALLET_SIGNATURE_KEY, signature),
  removeSignature: () => removeSecret(WALLET_SIGNATURE_KEY),
  clearSecrets: () => {
    removeSecret(AUTH_TOKEN_KEY);
    removeSecret(WALLET_SIGNATURE_KEY);
  },
};
