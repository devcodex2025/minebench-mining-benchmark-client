# 🚀 WINDOWS PRODUCTION BUILD - ІНСТРУКЦІЯ

> **Note:** this document predates the Tauri v2 migration. Use `npm run dist:win` / `npm run tauri:build`. `electron-builder` cache paths below do not apply.

## ❓ Що ви хочете?

Створити версію MineBench для Windows з **production автентифікацією** (https://minebench.cloud/auth)

## ✅ Рішення - Три Способи

### Способ 1️⃣ : Найпростіший (Одна команда)

```bash
npm run dist:win
```

**Готово!** 🎉

Файл буде у: `dist/MineBench Client 0.4.4.exe`

---

### Способ 2️⃣ : За допомогою Скрипта (Рекомендується)

Двічі клацніть на:
```
build-windows-production.ps1
```

(PowerShell скрипт автоматично:
- Побудує веб-версію
- Створить installer
- Покаже результати)

---

### Способ 3️⃣ : Крок за Кроком (Контроль)

```bash
# Крок 1: Переконатися що залежності встановлені
npm install

# Крок 2: Побудувати з production конфігурацією
npm run build:prod

# Крок 3: Створити Windows installer
npm run dist:win

# Готово! Installer у папці dist/
```

---

## 🔍 Перевірка Конфігурації

Перед або після будування можете перевірити що це production:

```bash
npm run dev:prod
```

Потім клацніть ⚙️ в правому нижньому куті і перевірте:

```
Environment: production ✅
Wallet Auth: https://minebench.cloud/auth ✅
API Base: https://minebench.cloud/api ✅
Solana RPC: https://api.mainnet-beta.solana.com ✅
```

---

## ⏱️ Скільки часу займе?

- **Повна збірка:** 10-15 хвилин
- **Розмір файлу:** ~150-200 MB
- **Потрібно:** 5+ GB вільної пам'яті на диску

---

## 📦 Результат

Буде створено файл:

```
dist/
└── MineBench Client 0.4.4.exe  ← Це ваш installer!
```

Цей файл можна:
- ✅ Розповсюджувати користувачам
- ✅ Завантажити на сайт
- ✅ Розіслати у email
- ✅ Завантажити на GitHub Releases

---

## 🔒 Що змінилось?

| Що | Development | Production |
|---|---|---|
| **Wallet Auth** | http://localhost:3000 | https://minebench.cloud |
| **API** | http://localhost:3000 | https://minebench.cloud |
| **Solana** | Devnet | **Mainnet** (реальні кошти!) |

---

## ❌ Якщо щось пішло не так

### Помилка: "Internal compiler error"
```bash
# Закрийте все, перезавантажте комп'ютер, спробуйте ще раз
npm run dist:win
```

### Помилка: "makensis not found"
```bash
# Видаліть NSIS cache і спробуйте ще раз
rmdir "%LOCALAPPDATA%\electron-builder" /s /q
npm run dist:win
```

### Додаток крешиться
```bash
# Очистіть і перебудуйте
npm run clean
npm install
npm run dist:win
```

### Гаманець не підключається
- Перевірте що URL = `https://minebench.cloud/auth` (не localhost!)
- Перевірте інтернет з'єднання
- Перезавантажте додаток

---

## 📋 Чек-лист перед Будуванням

- [ ] Закрив браузери та важкі додатки
- [ ] `npm install` виконаний
- [ ] `npm run build:prod` пройшов успішно
- [ ] Перевірив конфігурацію через `npm run dev:prod`
- [ ] Вільно >5 GB на диску

---

## 🎯 Швидка Довідка Команд

```bash
# Перевірити production конфіг (в браузері)
npm run dev:prod

# Побудувати тільки web версію
npm run build:prod

# Створити Windows installer
npm run dist:win

# Створити для всіх платформ
npm run dist:all

# Очистити старі файли
npm run clean
```

---

## 📚 Додаткові Ресурси

- [BUILD_WINDOWS_PRODUCTION.md](BUILD_WINDOWS_PRODUCTION.md) - Детальна інструкція
- [WINDOWS_BUILD_CHECKLIST.md](WINDOWS_BUILD_CHECKLIST.md) - Чек-лист
- [BUILD_ALL_PLATFORMS.md](BUILD_ALL_PLATFORMS.md) - Для macOS/Linux
- [ENVIRONMENT_CONFIG.md](ENVIRONMENT_CONFIG.md) - Конфігурація

---

## 🎉 Готово?

Просто запустіть:

```bash
npm run dist:win
```

І чекайте 10-15 хвилин. Все решта буде автоматично!

Файл буде у: **`dist/MineBench Client 0.4.4.exe`**

---

**Status:** ✅ Production Ready  
**Environment:** Production (https://minebench.cloud)  
**Wallet Auth:** Mainnet Solana  
**Version:** 0.4.4
