# MineBench Client - Нові Функції

## 📊 Огляд змін

Додано повноцінну систему для:
1. **Solana Wallet Authentication** - Інтеграція з Solana гаманцями (Phantom, Magic Eden, Ledger)
2. **Multi-Device Mining** - Синхронізація статистики між кількома пристроями
3. **Mining Statistics Dashboard** - Вкладка зі статистикою винагород та продуктивності
4. **P2Pool Integration** - Інтеграція з P2Pool для отримання даних про винагороди

---

## 🔐 Автентифікація через Solana гаманець

### Як це працює:

#### 1. Підключення гаманця
- Користувач натискає "Connect Solana Wallet" у боковій панелі
- Вибирає свій гаманець (Phantom, Magic Eden, etc.)
- Підписує повідомлення для верифікації власності адреси

#### 2. Зберігання користувача
```typescript
// src/services/solanaAuth.ts
const user: SolanaUser = {
  publicKey: "...",           // Solana public key
  displayName: "User-xxx",
  createdAt: Date.now(),
  walletType: 'phantom',
  isVerified: false
};
```

#### 3. Використання в компонентах
```tsx
import { useSolanaAuth } from '../services/solanaAuth';

const MyComponent = () => {
  const { user, isConnected } = useSolanaAuth();
  
  if (isConnected && user) {
    console.log(`Користувач: ${user.publicKey}`);
  }
};
```

### Файли:
- [SolanaAuthButton.tsx](src/components/SolanaAuthButton.tsx) - UI компонент для підключення
- [solanaAuth.ts](src/services/solanaAuth.ts) - Сервіс для роботи з гаманцем

---

## 📈 Статистика майнінгу

### Вкладка "Statistics"

Нова сторінка доступна за маршрутом `/statistics` показує:

#### Метрики (4 stat cards):
- **Total Rewards** - Загальна кількість винагород (XMR)
- **This Month** - Винагороди за поточний місяц
- **Current Hashrate** - Поточний хешрейт з усіх пристроїв
- **Today** - Винагороди за сьогодні

#### Графіки:
1. **Reward History** (7 днів) - Стовпчастий графік винагород
2. **Device Performance** - Лінійний графік продуктивності пристроїв

#### Список пристроїв:
- Ім'я пристрою
- Статус (Active/Offline)
- Поточний хешрейт
- Загальні винагороди

### Як використовувати:
```tsx
import { MiningStatistics } from './pages/Statistics';

// Автоматично отримує дані з useSolanaAuth store
<Routes>
  <Route path="/statistics" element={<MiningStatistics />} />
</Routes>
```

### Файлури:
- [Statistics.tsx](src/pages/Statistics.tsx) - Сторінка статистики

---

## 🔗 P2Pool API

### Сервіс для інтеграції з P2Pool

```typescript
import { p2poolAPI } from '../services/p2poolAPI';

// Отримати статистику пулу
const poolStats = await p2poolAPI.getPoolStats();
console.log(poolStats.poolHashrate);

// Розрахувати оцінку винагради
const reward = p2poolAPI.calculateEstimatedReward(
  hashrate,      // вашій хешрейт в H/s
  networkDiff,   // складність мережі
  blockReward    // винагорода за блок (4.4 XMR для Monero)
);

console.log(`Орієнтовна винагорода на день: ${reward.daily} XMR`);

// Перевірити wallet адресу
const isValid = p2poolAPI.validateMoneroAddress(walletAddress);
```

### API Методи:

| Метод | Параметри | Повернення | Опис |
|-------|-----------|-----------|------|
| `getPoolStats()` | - | `P2PoolStats` | Статистика пулу (хешрейт, складність, тощо) |
| `getWorkerStats(wallet)` | Wallet address | `P2PoolWorkerStats` | Статистика майнера за wallet (TODO) |
| `calculateEstimatedReward(hr, diff, reward)` | Хешрейт, складність | `{hourly, daily, monthly}` | Розрахунок оцінки винагороди |
| `validateMoneroAddress(addr)` | Адреса | `boolean` | Перевірка валідності Monero адреси |
| `getBlockHistory(limit)` | Кількість блоків | `BlockHeader[]` | Історія останніх блоків |

### Файли:
- [p2poolAPI.ts](src/services/p2poolAPI.ts)

---

## 📱 Синхронізація між пристроями

### MultiDeviceSyncService

Дозволяє синхронізувати дані майнінгу між кількома пристроями користувача.

#### Як це працює:

1. **Реєстрація пристрою**
```typescript
import { MultiDeviceSyncService } from '../services/multiDeviceSync';

const syncService = MultiDeviceSyncService.getInstance(walletPublicKey);

syncService.registerDevice({
  deviceId: 'desktop-001',
  name: 'Desktop CPU',
  publicKey: userSolanaKey,
  deviceType: 'cpu',
  totalHashrate: 5000,
  lastSeen: Date.now(),
  isActive: true,
  totalRewards: 0.05
});
```

2. **Оновлення статистики**
```typescript
// Оновити хешрейт та винагороди
syncService.updateDevice('desktop-001', {
  currentHashrate: 5150,
  totalHashesComputed: 1000000,
  accumulatedRewards: 0.06,
  lastUpdate: Date.now()
});
```

3. **Отримання всіх пристроїв**
```typescript
const devices = syncService.getDevices();
const stats = syncService.getAggregatedStats();

console.log(`Загальний хешрейт: ${stats.totalHashrate} H/s`);
console.log(`Загальні винагороди: ${stats.totalRewards} XMR`);
```

4. **Підписка на оновлення (real-time)**
```typescript
const unsubscribe = syncService.subscribe((devices) => {
  console.log('Пристрої оновлені:', devices);
});

// Пізніше
unsubscribe();
```

#### Сховище:
- **LocalStorage**: Основне сховище (`minebench_sync_${walletPublicKey}`)
- **WebSocket** (опціонально): Real-time синхронізація
- **IPFS** (в майбутньому): Децентралізоване сховище
- **Solana Program** (в майбутньому): On-chain синхронізація

#### Особливості:
- ✅ Авто-синхронізація кожні 30 сек
- ✅ Консенсус механізм для запобігання спуфінгу
- ✅ Шифрування даних (TODO)
- ✅ Резервна копія на IPFS (TODO)

### Файли:
- [multiDeviceSync.ts](src/services/multiDeviceSync.ts)

---

## 🧠 Zustand Store (useMinerStore)

### Нові поля:

```typescript
interface MiningState {
  // Solana auth
  walletVerified: boolean;           // Wallet верифікований через Solana
  solanaPublicKey?: string;          // Публічний ключ Solana для мульти-пристрої
  
  // P2Pool balance
  p2poolBalance: number;             // XMR баланс у P2Pool
}
```

### Нові методи:
```typescript
const { 
  setWalletVerified,        // Встановити верифікацію wallet
  setP2PoolBalance          // Встановити баланс у P2Pool
} = useMinerStore();

// Використання
setWalletVerified(true, 'solana_public_key_xxx');
setP2PoolBalance(0.15);
```

---

## 🎨 UI Компоненти

### SolanaAuthButton
Новий компонент у боковій панелі для підключення гаманця.

**Стани:**
- 🔴 Не підключено - показує кнопку "Connect Solana Wallet"
- 🟢 Підключено - показує адресу та кнопку "Disconnect"
- ⚠️ Помилка - показує повідомлення про помилку

### Layout.tsx (оновлено)
- Додана кнопка `SolanaAuthButton` у боковій панелі
- Нова вкладка "Statistics" з іконкою TrendingUp

---

## 📖 Як використовувати нові функції

### 1. Підключити гаманець
```tsx
import { SolanaAuthButton } from './components/SolanaAuthButton';

// Компонент уже інтегрований у Layout.tsx
// Користувач натискає кнопку → вибирає гаманець → підписує
```

### 2. Отримати статистику
```tsx
import { useSolanaAuth } from './services/solanaAuth';

const MyComponent = () => {
  const { user, miningStats } = useSolanaAuth();
  
  if (user && miningStats) {
    return (
      <div>
        <h1>Total Rewards: {miningStats.totalRewards} XMR</h1>
      </div>
    );
  }
};
```

### 3. Синхронізувати пристрої
```tsx
import { MultiDeviceSyncService } from './services/multiDeviceSync';
import { useSolanaAuth } from './services/solanaAuth';

const MyMinerComponent = () => {
  const { user } = useSolanaAuth();
  
  useEffect(() => {
    if (!user) return;
    
    const sync = MultiDeviceSyncService.getInstance(user.publicKey);
    
    // Реєстрація поточного пристрою
    sync.registerDevice({
      deviceId: 'device-1',
      name: 'My Mining PC',
      publicKey: user.publicKey,
      deviceType: 'cpu',
      totalHashrate: 5000,
      lastSeen: Date.now(),
      isActive: true,
      totalRewards: 0
    });
    
    // Запустити периодичну синхронізацію
    sync.startSyncLoop(30000);
    
    return () => sync.stopSyncLoop();
  }, [user]);
};
```

---

## 🧪 Тестування

### Build проект
```bash
cd MineBench-Client
npm run build
```

### Dev режим
```bash
npm run dev
```

### Видимі вкладки:
- ✅ Dashboard (/)
- ✅ Benchmarks (/benchmark)
- ✅ Mining Mode (/mining)
- ✅ **Statistics (/statistics)** - НОВА
- ✅ Node Logs (/logs)
- ✅ Settings (/settings)

### Боковій панель:
- ✅ **Connect Solana Wallet** - НОВА у нижній частині
- ✅ Rewards card
- ✅ Settings button

---

## 📝 TODO (Для майбутнього)

### Backend API endpoints
```
POST /api/sync/device-update
  - Запис даних пристрою
  - Верифікація Solana підпису
  - Синхронізація з IPFS

GET /api/rewards/{walletAddress}
  - Отримати винагороди користувача
  - Інтеграція з P2Pool

POST /api/devices/register
  - Реєстрація нового пристрою
  - Генерація device ID
```

### IPFS Integration
```typescript
// Зберігання даних на IPFS для резервної копії
await ipfs.add(JSON.stringify(deviceData));
```

### Solana Program
```typescript
// On-chain запис статистики
await program.methods
  .recordMiningStats(deviceData)
  .accounts({ user: wallet.publicKey })
  .rpc();
```

### Шифрування даних
```typescript
// AES-256 шифрування чутливих даних
import nacl from 'tweetnacl';
```

### WebSocket real-time sync
```typescript
syncService.connectWebSocket('wss://minebench.cloud/sync');
```

---

## 🔒 Безпека

### Верифікація Solana підпису
```typescript
import { PublicKey, ed25519 } from '@solana/web3.js';
import nacl from 'tweetnacl';

// Сервер перевіряє підпис
const verified = nacl.sign.detached.verify(
  message,
  signature,
  publicKey.toBytes()
);
```

### Валідація Monero адреси
```typescript
// Перевірка формату та checksum
const isValid = p2poolAPI.validateMoneroAddress(address);
```

---

## 📚 Посилання

- [Solana Wallet Adapter](https://github.com/solana-labs/wallet-adapter)
- [P2Pool](https://github.com/SChernykh/p2pool)
- [Monero RPC](https://www.monero.how/monero-rpc)
- [IPFS](https://ipfs.io/)

---

## 💡 Приклади інтеграції

### Приклад 1: Отримати винагороди за період
```typescript
import { useSolanaAuth } from './services/solanaAuth';
import { p2poolAPI } from './services/p2poolAPI';

async function getRewardsSummary() {
  const { user, miningStats } = useSolanaAuth.getState();
  
  if (!user) return null;
  
  const thisMonth = miningStats?.thisMonth || 0;
  const xmrEquivalent = thisMonth * 0.00001; // BMT to XMR conversion
  
  return {
    user: user.publicKey,
    rewards: thisMonth,
    xmr: xmrEquivalent
  };
}
```

### Приклад 2: Синхронізувати дані при рестарту майнера
```typescript
import { MultiDeviceSyncService } from './services/multiDeviceSync';
import { useMinerStore } from './store/useMinerStore';

async function onMinerRestart() {
  const { solanaPublicKey, currentHashrate } = useMinerStore.getState();
  
  if (!solanaPublicKey) return;
  
  const sync = MultiDeviceSyncService.getInstance(solanaPublicKey);
  
  // Оновити поточний стан
  sync.updateDevice('device-id', {
    currentHashrate,
    lastUpdate: Date.now(),
    isActive: true
  });
}
```

---

## 🎯 Резюме

✅ **Готово до використання:**
- Solana Wallet Authentication
- Mining Statistics Dashboard
- P2Pool API integration
- Multi-Device Synchronization
- All UI components

⏳ **Потребує backend:**
- API endpoints для синхронізації
- IPFS integration
- Solana program для on-chain records
- WebSocket сервер для real-time updates

---

**Версія**: 0.5.0  
**Дата**: 27 січня 2026  
**Статус**: Готово до тестування
