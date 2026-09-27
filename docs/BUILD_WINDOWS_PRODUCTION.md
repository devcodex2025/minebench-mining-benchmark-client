# Підготування Windows версії з Production Автентифікацією

> **Note:** this document predates the Tauri v2 migration. The current desktop client is **Tauri v2** (`src-tauri/`); use `npm run dist:win` (wrapper) or `npm run tauri:build`. Electron/`electron-builder` steps below are outdated.

## Швидкий Старт

Щоб створити Windows installer з production автентифікацією (https://minebench.cloud/auth), виконайте:

```bash
npm run dist:win
```

Це команда автоматично:
1. ✅ Встановлює environment на `production` (Vite mode)
2. ✅ Загружає `.env.production` з minebench.cloud URLs
3. ✅ Собирає web-dist з production конфігурацією
4. ✅ Підписує electron app (якщо налаштовано)
5. ✅ Створює Windows installer (`.exe`)

## Що Змінюється?

### Development (локальне тестування)
```
Wallet Auth: http://localhost:3000/auth
API Base:    http://localhost:3000/api
RPC:         https://api.devnet.solana.com (DevNet)
```

### Production (Windows installer)
```
Wallet Auth: https://minebench.cloud/auth
API Base:    https://minebench.cloud/api  
RPC:         https://api.mainnet-beta.solana.com (MainNet)
```

## Детальна Інструкція

### Крок 1: Переконайтеся що коду актуальний
```bash
git pull origin main
npm install
```

### Крок 2: Збудити Production версію
```bash
npm run build:prod
```

Це створить папку `web-dist/` з production конфігурацією.

### Крок 3: Створити Windows Installer
```bash
npm run dist:win
```

Installer буде створений у папці `dist/`:
- `MineBench Client 0.4.4.exe` - Основний installer
- `MineBench Client-0.4.4-Windows-setup.exe` - Portable версія (можливо)

## Команди для всіх Платформ

```bash
# Просто Windows
npm run dist:win

# macOS
npm run dist:mac

# Linux
npm run dist:linux

# Всі платформи одразу
npm run dist:all
```

## Перевірка Конфігурації

Перед будуванням можете перевірити, що production URLs налаштовані:

```bash
npm run dev:prod
```

Відкрийте app і клацніть на ⚙️ (gear icon) в правому нижньому куті - побачите:

```
Environment: production
Wallet Auth: https://minebench.cloud/auth
API Base: https://minebench.cloud/api
Solana RPC: https://api.mainnet-beta.solana.com
```

## Файли в Результаті

```
dist/
├── MineBench Client 0.4.4.exe          ← Основний installer
├── MineBench Client-0.4.4-Windows-setup.exe
└── ... інші файли ...
```

## Деякі Проблеми & Вирішення

### Проблема: "Internal compiler error #12345"
**Причина:** Недостатньо пам'яті для NSIS компіляції  
**Вирішення:** 
- Закрийте інші додатки
- Перезавантажте комп'ютер
- Спробуйте ще раз

### Проблема: Неправильні URLs в готовому додатку
**Причина:** Можливо використовувалася dev версія  
**Перевірка:** 
```bash
npm run build:prod    # Переконайтеся що це запустилось
npm run dist:win      # Тоді це
```

### Проблема: Додаток не запускається
**Вирішення:**
- Перевірте що Windows Defender не блокує .exe
- Перезавантажте Windows (якщо потрібно)
- Спробуйте в безпечному режимі

## Цифрові署Підписи (Необов'язково)

Якщо потрібна署подпись:

1. Додайте до `src-tauri/tauri.conf.json` (`bundle.windows`):
```yaml
certificateFile: "path/to/certificate.pfx"
certificatePassword: "password"
```

2. Запустіть:
```bash
npm run dist:win
```

## Результат

Готова Windows версія з:
- ✅ Production wallet auth (https://minebench.cloud/auth)
- ✅ Production API endpoints
- ✅ MainNet Solana RPC
- ✅ Встановювач (installer) для кінцевих користувачів
- ✅ Автоматичні оновлення (якщо налаштовано)

## Наступні Кроки

1. Протестуйте installer на чистій Windows машині
2. Розпростеніть на користувачів
3. Моніторьте логи для будь-яких проблем

## Допомога

Для додаткової інформації див.:
- [ENVIRONMENT_CONFIG.md](ENVIRONMENT_CONFIG.md) - Детальна конфігурація
- [README.md](README.md) - Основне керівництво
- [IMPLEMENTATION_COMPLETE.md](IMPLEMENTATION_COMPLETE.md) - Деталі імплементації
