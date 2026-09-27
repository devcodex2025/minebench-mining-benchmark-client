# 📚 MineBench Environment Configuration - Документація

> **Примітка (актуальність):** частина build/environment-документів нижче досі
> описує Electron і `electron-builder`. Поточний десктопний клієнт — **Tauri v2**
> (`npm run tauri:dev`, `npm run tauri:build`, `src-tauri/`). Використовуйте ці
> команди та актуальні гайди `docs/BROWSER_WALLET_AUTH.md` і `docs/BUILD.md`.
> Застарілі Electron-згадки підлягають плановому оновленню.

## 🚀 Швидкий Старт

### Побудувати Windows з Production Auth
👉 [QUICK_BUILD_WINDOWS.md](QUICK_BUILD_WINDOWS.md)  
Просто: `npm run dist:win`

### Шпаргалка
👉 [CHEATSHEET.md](CHEATSHEET.md)  
Найважливіші команди на одній сторінці

---

## 📖 Детальна Документація

### Побудування

| Документ | Для чого |
|----------|----------|
| [QUICK_BUILD_WINDOWS.md](QUICK_BUILD_WINDOWS.md) | Windows Production Build (найпопулярніше) |
| [BUILD_WINDOWS_PRODUCTION.md](BUILD_WINDOWS_PRODUCTION.md) | Детальна інструкція Windows |
| [BUILD_ALL_PLATFORMS.md](BUILD_ALL_PLATFORMS.md) | Для всіх платформ (Win/Mac/Linux) |
| [WINDOWS_BUILD_CHECKLIST.md](WINDOWS_BUILD_CHECKLIST.md) | Чек-лист перевірок |

### Конфігурація

| Документ | Для чого |
|----------|----------|
| [ENVIRONMENT_CONFIG.md](ENVIRONMENT_CONFIG.md) | Повний гайд конфігурації |
| [QUICK_START_ENVIRONMENT.md](QUICK_START_ENVIRONMENT.md) | Швидкий старт конфіг |
| [ENVIRONMENT_SETUP_SUMMARY.md](ENVIRONMENT_SETUP_SUMMARY.md) | Резюме імплементації |
| [IMPLEMENTATION_COMPLETE.md](IMPLEMENTATION_COMPLETE.md) | Повна інформація про реалізацію |

---

## 🎯 Вибери За Твоєю Потребою

### "Я хочу побудувати Windows з production auth прямо зараз"
👉 [QUICK_BUILD_WINDOWS.md](QUICK_BUILD_WINDOWS.md)  
Команда: `npm run dist:win`

### "Я хочу детальну інструкцію"
👉 [BUILD_WINDOWS_PRODUCTION.md](BUILD_WINDOWS_PRODUCTION.md)

### "Мені потрібна шпаргалка"
👉 [CHEATSHEET.md](CHEATSHEET.md)

### "Я хочу розібратися з конфігурацією"
👉 [ENVIRONMENT_CONFIG.md](ENVIRONMENT_CONFIG.md)

### "Я будую для macOS/Linux"
👉 [BUILD_ALL_PLATFORMS.md](BUILD_ALL_PLATFORMS.md)

### "Я перевіряю свої дії перед побудуванням"
👉 [WINDOWS_BUILD_CHECKLIST.md](WINDOWS_BUILD_CHECKLIST.md)

### "Я хочу знати що було реалізовано"
👉 [IMPLEMENTATION_COMPLETE.md](IMPLEMENTATION_COMPLETE.md)

---

## 📋 Основні Команди

### Development
```bash
npm run dev:local       # Dev з localhost
npm run dev:prod        # Dev з production URLs
npm run tauri:dev      # Dev з Tauri
```

### Building
```bash
npm run build:dev       # Build для development
npm run build:prod      # Build для production
```

### Distributables
```bash
npm run dist:win        # Windows installer
npm run dist:mac        # macOS .dmg
npm run dist:linux      # Linux пакети
npm run dist:all        # Усі платформи
```

---

## 🔑 Ключові Файли (Технічні)

### Нові файли що були створені:

```
src/
├── config/
│   └── environment.ts           # Основна конфігурація
├── hooks/
│   └── useEnvironment.ts        # React hooks
└── components/
    └── DeveloperSettings.tsx    # Settings panel

.env.development                 # Dev URLs
.env.production                  # Prod URLs

build-windows-production.bat     # Windows script
build-windows-production.ps1     # PowerShell script
```

---

## 🎨 Особливості Системи

✅ **Без Hardcoding** - Всі URLs централізовані  
✅ **Миттєве Переключення** - Одна команда для зміни  
✅ **Візуальна Зворотна Зв'язок** - Settings panel показує активні URLs  
✅ **Type-Safe** - Full TypeScript  
✅ **Production Ready** - Безпечні production URLs  
✅ **Extensible** - Легко додавати нові змінні  

---

## 🌍 URLs по Режимах

### Development (localhost)
```
Wallet Auth:  http://localhost:3000/auth
API Base:     http://localhost:3000/api
Backend:      http://localhost:3000
Solana RPC:   https://api.devnet.solana.com
Sync:         ws://localhost:3000/sync
```

### Production (minebench.cloud)
```
Wallet Auth:  https://minebench.cloud/auth
API Base:     https://minebench.cloud/api
Backend:      https://minebench.cloud
Solana RPC:   https://api.mainnet-beta.solana.com
Sync:         wss://minebench.cloud/sync
```

---

## 🚨 Часті Проблеми

### "Як я знаю що це production?"
Клацніть ⚙️ в правому нижньому куті.  
Повинна бути написана: `Environment: production`

### "Гаманець не підключається"
Перевірте URL = `https://minebench.cloud/auth` (НЕ localhost!)

### "Build failled з 'Internal compiler error'"
Закрийте браузери, перезавантажте, спробуйте ще раз.

---

## 💡 Tips & Tricks

**Перевірити конфіг перед build:**
```bash
npm run dev:prod
# Клацніть ⚙️ для перевірки URLs
```

**Очистити і перебудувати:**
```bash
npm run clean
npm install
npm run dist:win
```

**Перебудувати якщо помилка:**
```bash
npm run dist:win  # Просто запустіть ще раз
```

---

## 📞 Потрібна Допомога?

1. Перевірте [QUICK_BUILD_WINDOWS.md](QUICK_BUILD_WINDOWS.md)
2. Подивіться [WINDOWS_BUILD_CHECKLIST.md](WINDOWS_BUILD_CHECKLIST.md)
3. Прочитайте [ENVIRONMENT_CONFIG.md](ENVIRONMENT_CONFIG.md)

---

## 🎉 Готово!

Всі документи готові до використання.

**Почніть з:** [QUICK_BUILD_WINDOWS.md](QUICK_BUILD_WINDOWS.md)

**Команда:** `npm run dist:win`

---

**Status:** ✅ Production Ready  
**Version:** 0.4.4  
**Date:** January 29, 2026
