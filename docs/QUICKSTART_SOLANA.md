# 🚀 Швидкий старт - Солана Інтеграція

> **Note:** застаріло. Актуальний вхід через гаманець: nonce + Wallet Standard + JWT-refresh — див. [BROWSER_WALLET_AUTH.md](BROWSER_WALLET_AUTH.md). Десктопний клієнт — Tauri v2.

## Встановлення (вже виконано ✅)

```bash
cd MineBench-Client

# Встановлені бібліотеки
npm install @solana/web3.js @solana/wallet-adapter-base @solana/wallet-adapter-react

# Перевірте що все скомпілюється
npm run build
```

---

## 🔐 Крок 1: Підключити гаманець

1. **Запустіть додаток**
   ```bash
   npm run dev:all
   ```

2. **В UI натисніть кнопку**
   - Знайдіть "Connect Solana Wallet" у лівій панелі (нижня частина)
   - Натисніть кнопку

3. **Вибір гаманця**
   - Вибирайте з доступних гаманців (Phantom, Magic Eden, Ledger)
   - Гаманець запитатиме дозвіл на підключення

4. **Успішне підключення**
   - ✅ Кнопка стане зеленою
   - ✅ Покаже вашу Solana адресу
   - ✅ Буде кнопка для відключення

---

## 📊 Крок 2: Переглянути статистику

1. **Перейдіть на нову вкладку**
   - Натисніть "Statistics" у лівій панелі (або перейдіть на `/statistics`)

2. **Що ви побачите:**
   - 📈 4 stat cards з метриками
   - 📉 2 графіки з historией
   - 📱 Список всіх ваших пристроїв

3. **Дані:**
   - Знімаються з `useSolanaAuth` store
   - На разі це mock дані (можна вручну редагувати в сервісі)

---

## 📱 Крок 3: Синхронізувати пристрої

### Вручну (для тестування):

```typescript
// В будь-якому компоненті
import { MultiDeviceSyncService } from './services/multiDeviceSync';
import { useSolanaAuth } from './services/solanaAuth';

const { user } = useSolanaAuth.getState();

if (user) {
  const sync = MultiDeviceSyncService.getInstance(user.publicKey);
  
  // Додати пристрій
  sync.registerDevice({
    deviceId: 'device-1',
    name: 'Desktop CPU',
    publicKey: user.publicKey,
    deviceType: 'cpu',
    totalHashrate: 5000,
    lastSeen: Date.now(),
    isActive: true,
    totalRewards: 0.05
  });
  
  // Оновити дані
  sync.updateDevice('device-1', {
    currentHashrate: 5500,
    accumulatedRewards: 0.06
  });
  
  // Отримати все
  console.log(sync.getDevices());
  console.log(sync.getAggregatedStats());
}
```

### Автоматично (интеграція з майнером):

```typescript
// В Mining.tsx або src-tauri/src/commands.rs

import { MultiDeviceSyncService } from '../services/multiDeviceSync';

const onStatsUpdate = (hashrate, temp, power) => {
  const { currentHashrate, solanaPublicKey } = useMinerStore.getState();
  
  if (!solanaPublicKey) return; // User not authenticated
  
  const sync = MultiDeviceSyncService.getInstance(solanaPublicKey);
  
  sync.updateDevice('my-device-id', {
    currentHashrate: hashrate,
    totalHashesComputed: totalHashes,
    accumulatedRewards: currentRewards,
    lastUpdate: Date.now()
  });
};
```

---

## 🔗 Крок 4: Інтегрувати P2Pool API

### Получити інформацію про пул:

```typescript
import { p2poolAPI } from './services/p2poolAPI';

// Отримати статистику пулу
const poolStats = await p2poolAPI.getPoolStats();
console.log('Pool hashrate:', poolStats.poolHashrate);
console.log('Network difficulty:', poolStats.poolDifficulty);

// Розрахувати оцінку винагороди
const myHashrate = 5000; // H/s
const estimatedReward = p2poolAPI.calculateEstimatedReward(
  myHashrate,
  poolStats.poolDifficulty,
  4.4 // XMR block reward
);

console.log('Daily reward:', estimatedReward.daily, 'XMR');
console.log('Monthly reward:', estimatedReward.monthly, 'XMR');

// Перевірити wallet адресу
const isValid = p2poolAPI.validateMoneroAddress(walletAddress);
```

---

## 🧪 Тестування без Solana гаманця

Якщо у вас немає гаманця, можна тестувати локально:

### 1. Mock Solana User

```typescript
// В DevTools Console
const user = {
  publicKey: 'test-wallet-key',
  displayName: 'Test User',
  walletType: 'phantom',
  isVerified: true,
  createdAt: Date.now()
};

localStorage.setItem('minebench_user', JSON.stringify(user));

// Перезавантажте сторінку
```

### 2. Mock Device Data

```typescript
// В DevTools Console
import { MultiDeviceSyncService } from './services/multiDeviceSync';

const sync = MultiDeviceSyncService.getInstance('test-wallet-key');

sync.registerDevice({
  deviceId: 'test-device-1',
  name: 'Test Desktop',
  publicKey: 'test-wallet-key',
  deviceType: 'cpu',
  totalHashrate: 5000,
  lastSeen: Date.now(),
  isActive: true,
  totalRewards: 0.25
});

sync.registerDevice({
  deviceId: 'test-device-2',
  name: 'Test Laptop',
  publicKey: 'test-wallet-key',
  deviceType: 'cpu',
  totalHashrate: 2000,
  lastSeen: Date.now(),
  isActive: false,
  totalRewards: 0.10
});

// Перевірте результати
console.log(sync.getAggregatedStats());
```

---

## 🐛 Отладка

### Включить логування:

```typescript
// В консолі браузера
localStorage.setItem('minebench_debug', 'true');

// Перезавантажте
// Тепер у консолі будуть логи всіх операцій
```

### Подивити LocalStorage:

```javascript
// У DevTools Console
JSON.parse(localStorage.getItem('minebench_sync_<wallet-key>'))
JSON.parse(localStorage.getItem('minebench_user'))
```

### Очистити дані:

```javascript
localStorage.removeItem('minebench_user');
localStorage.removeItem('minebench_sync_*'); // All devices
```

---

## 📋 Структура файлів

```
src/
├── components/
│   ├── SolanaAuthButton.tsx          ✅ Нова - підключення гаманця
│   └── Layout.tsx                    ✏️ Оновлено - додана кнопка
├── pages/
│   ├── Statistics.tsx                ✅ Нова - вкладка статистики
│   └── Mining.tsx                    ✏️ Потребує інтеграції
├── services/
│   ├── solanaAuth.ts                 ✅ Нова - Solana auth
│   ├── p2poolAPI.ts                  ✅ Нова - P2Pool integration
│   └── multiDeviceSync.ts            ✅ Нова - синхронізація
├── store/
│   └── useMinerStore.ts              ✏️ Оновлено - нові поля
└── App.tsx                           ✏️ Оновлено - маршрут /statistics
```

---

## ✅ Чек-лист

- [x] Встановлено Solana бібліотеки
- [x] Солана кнопка в UI
- [x] Statistics вкладка готова
- [x] P2Pool API сервіс
- [x] Multi-device sync сервіс
- [x] Zustand store оновлено
- [ ] Backend API endpoints (TODO)
- [ ] IPFS integration (TODO)
- [ ] WebSocket real-time (TODO)
- [ ] Solana program (TODO)

---

## 🎓 Наступні кроки

### Для фронтенду:
1. Інтегрувати Tauri events у MultiDeviceSync
2. Додати real-time updates до Statistics
3. Показувати нотифікації при нових винаградах
4. Додати історію винагород за місяці

### Для бекенду:
1. Создати API endpoints для sync
2. Зберігати дані в БД
3. Верифікувати Solana підписи
4. Запустити IPFS ноду
5. Создати Solana program для on-chain records

### Для тестування:
1. Unit тести для сервісів
2. Integration тести для UI
3. E2E тести з справжнім гаманцем
4. Load тести для multi-device sync

---

## 🤝 Потребує доповнення

```typescript
// src/services/multiDeviceSync.ts - Рядок 200
private async syncWithServer(data: DeviceSyncData): Promise<void> {
  // TODO: Реалізувати POST на server/backend
  // POST /api/sync/device-update
}

// src/services/p2poolAPI.ts - Рядок 68
async getWorkerStats(walletAddress: string): Promise<P2PoolWorkerStats> {
  // TODO: Інтегрувати з реальним API
  // Потребує власного P2Pool API endpoint або DB
}

// src/services/solanaAuth.ts - Рядок 320
private async syncDeviceWithServer(...) {
  // TODO: Надіслати на backend для верифікації
  // POST /api/devices/register
}
```

---

## 📞 Помилки й Рішення

### "No Solana wallet found"
**Рішення:**
- Встановіть Phantom або Magic Eden розширення
- Або використайте mock дані (див. вище)

### "Device not synced"
**Рішення:**
- Перевірте що Solana гаманець підключений
- Зберегти device ID в localStorage
- Перезавантажте сторінку

### Chart не показує дані
**Рішення:**
- Перевірте localStorage за наявністю даних
- Додайте mock дані вручну
- Перевірте відсутність помилок у Console

---

## 📚 Документація

- Детальна: [SOLANA_INTEGRATION.md](SOLANA_INTEGRATION.md)
- Швидкий старт: **Ви тут!**
- API: [P2POOL_API.md](../MineBench-Pool/README.md)
- Архітектура: [../ARCHITECTURE.md](../ARCHITECTURE.md)

---

**Готово до тестування! 🎉**

Запустіть `npm run dev:all` та спробуйте нові функції!
