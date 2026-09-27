# ✅ Підготування Windows Версії - Чек-лист

> **Note:** this document predates the Tauri v2 migration. Use `npm run tauri:build`. `electron-builder` cache paths below do not apply.

## Перед Будуванням

- [ ] Закрийте всі браузери та важкі додатки
- [ ] Переконайтеся що у вас 5+ GB вільної пам'яті на диску
- [ ] Переконайтеся що коду актуальний: `git pull`
- [ ] Node.js встановлений: `node -v` (має бути 16+)
- [ ] Залежності встановлені: `npm install`

## Перевірка Конфігурації

### Перевірте Production URLs
```bash
npm run dev:prod
```

Клацніть ⚙️ внизу справа і переконайтеся що видно:
```
Environment: production
Wallet Auth: https://minebench.cloud/auth
API Base: https://minebench.cloud/api
Solana RPC: https://api.mainnet-beta.solana.com
```

- [ ] Wallet Auth = https://minebench.cloud/auth
- [ ] API Base = https://minebench.cloud/api
- [ ] Solana RPC = mainnet-beta (НЕ devnet)

## Вибір Способу Будування

### Способ 1: Командний Рядок (Найпростіший)
```bash
npm run dist:win
```

- [ ] Запустив команду
- [ ] Очікую завершення (може зайняти 5-15 хвилин)

### Способ 2: Скрипт (Рекомендується)
```bash
# PowerShell
.\build-windows-production.ps1

# або CMD
build-windows-production.bat
```

- [ ] Запустив скрипт
- [ ] Слідую інструкціям на екрані

### Способ 3: Крок за Кроком (Контрольований)
```bash
# Крок 1: Побудувати
npm run build:prod

# Крок 2: Створити installer
npm run dist:win
```

- [ ] `npm run build:prod` - успішно завершився
- [ ] `npm run dist:win` - успішно завершився

## Після Будування

### Перевірка Файлів
- [ ] Файл `dist/MineBench Client 0.4.4.exe` створений
- [ ] Розмір файлу > 50 MB (це нормально)
- [ ] Файл можна скопіювати

### Тестування Installer
```bash
# Запустіть installer
./dist/MineBench\ Client\ 0.4.4.exe
```

- [ ] Installer запустився без помилок
- [ ] Можна вибрати папку для встановлення
- [ ] Встановлення завершилось
- [ ] Додаток запустився після встановлення

### Тестування Додатка
- [ ] Додаток запустився нормально
- [ ] Кнопка "Connect Wallet" (Solana) присутня
- [ ] Кліки на ⚙️ показує production URLs
- [ ] Додаток не крешиться при навігації

### Перевірка Автентифікації
- [ ] Натискаю "Connect Wallet"
- [ ] Перенаправляє на https://minebench.cloud/auth (НЕ localhost!)
- [ ] Можу підключити Solana гаманець
- [ ] Додаток повертає користувача після автентифікації

## Розповсюдження

- [ ] Скопіював `dist/MineBench Client 0.4.4.exe` на сервер
- [ ] Завантажив на сайт мінезенча
- [ ] Тестував download link
- [ ] Інформував користувачів про новий release

## Проблеми & Вирішення

### Помилка: "Internal compiler error"
- [ ] Закрив всі браузери
- [ ] Перезавантажив Windows
- [ ] Спробував ще раз

### Помилка: "makensis not found"
- [ ] Видалив папку: `%LOCALAPPDATA%\electron-builder\Cache\nsis`
- [ ] Запустив `npm run dist:win` (переванача завантажить NSIS)

### Додаток крешиться після встановлення
- [ ] Видалив попередню версію
- [ ] Встановив нову версію с нуля
- [ ] Перезавантажив Windows

### Гаманець не підключається
- [ ] Перевірив що URL = https://minebench.cloud/auth
- [ ] Перевірив що Solana RPC = mainnet-beta
- [ ] Перевірив інтернет з'єднання

## Фінальна Перевірка

- [ ] Installer розміщений у `dist/`
- [ ] Файл має назву `MineBench Client 0.4.4.exe`
- [ ] Додаток використовує production URLs
- [ ] Додаток встановлюється без помилок
- [ ] Гаманець автентифікація працює
- [ ] Додаток функціонує без крешів

## Готово до Розповсюдження! 🎉

Можете розповсюджувати Windows версію користувачам.

---

**Час збирання:** ~10-15 хвилин  
**Розмір файлу:** ~150-200 MB  
**Потрібно:** 5+ GB вільної пам'яті на диску
