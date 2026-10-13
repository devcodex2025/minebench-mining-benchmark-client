# Будування для всіх Платформ - Швидкий Довідник

> **Note:** this document predates the Tauri v2 migration. The current desktop client is **Tauri v2** (`src-tauri/`); use `npm run tauri:dev` and `npm run tauri:build`. Electron/`electron-builder` steps below are outdated.

## Одна команда для всього

```bash
npm run dist:all
```

Це створить:
- `MineBench Client 0.4.4.exe` - Windows installer
- `MineBench Client-0.4.4.dmg` - macOS disk image
- `.AppImage` та `.deb` файли - Linux

## Окремо для кожної Платформи

### Windows
```bash
npm run dist:win
```
**Результат:** `dist/MineBench Client 0.4.4.exe` (~150-200 MB)

### macOS
```bash
npm run dist:mac
```
**Результат:** `dist/MineBench Client-0.4.4.dmg` (~180-220 MB)

### Linux
```bash
npm run dist:linux
```
**Результат:** 
- `dist/MineBench Client-0.4.4.AppImage`
- `dist/minebench-client-0.4.4-x.x86_64.rpm`
- `dist/minebench-client_0.4.4_amd64.deb`

## Перед Будуванням - Універсальна Підготовка

```bash
# 1. Оновіть код
git pull origin main

# 2. Встановіть залежності
npm install

# 3. Перевірте що все добре
npm run build:prod

# 4. Перевірте конфігурацію
npm run dev:prod
# (Перевірте ⚙️ чи показує production URLs)

# 5. Одна з команд вище для конкретної платформи
npm run dist:win    # або dist:mac, dist:linux, dist:all
```

## Матриця Конфігурацій

| Команда | Платформа | Результат | Тип |
|---------|-----------|-----------|-----|
| `npm run build:dev` | Всі | `web-dist/` | Web build |
| `npm run build:prod` | Всі | `web-dist/` | Web build |
| `npm run dev:local` | Всі | Локальний dev сервер | Dev |
| `npm run dev:prod` | Всі | Локальний сервер з prod URLs | Dev |
| `npm run dist:win` | Windows | `dist/*.exe` | Production |
| `npm run dist:mac` | macOS | `dist/*.dmg` | Production |
| `npm run dist:linux` | Linux | `dist/*.AppImage` + `.deb` | Production |
| `npm run dist:all` | Всі три | Усі установки | Production |

## Детальні Кроки для кожної Платформи

### Windows - Повна Процедура
```bash
# Завантажити код та залежності
git pull origin main
npm install

# Побудувати для production
npm run build:prod

# Створити Windows installer
npm run dist:win

# Результат у: dist/MineBench Client 0.4.4.exe
```

### macOS - Повна Процедура
```bash
# Завантажити код та залежності
git pull origin main
npm install

# Побудувати для production
npm run build:prod

# Створити macOS .dmg
npm run dist:mac

# Результат у: dist/MineBench Client-0.4.4.dmg
```

### Linux - Повна Процедура
```bash
# Завантажити код та залежності
git pull origin main
npm install

# Побудувати для production
npm run build:prod

# Створити Linux пакети
npm run dist:linux

# Результат у:
# - dist/MineBench Client-0.4.4.AppImage
# - dist/minebench-client-0.4.4-x.x86_64.rpm
# - dist/minebench-client_0.4.4_amd64.deb
```

## Конфігурація яка Використовується

Для всіх `npm run dist:*` команд автоматично:

✅ Встановлюється environment на `production`  
✅ Загружаються `.env.production` URLs:
```
Wallet Auth: https://minebench.cloud/auth
API Base:    https://minebench.cloud/api
Backend:     https://minebench.cloud
Solana RPC:  https://api.mainnet-beta.solana.com
Sync:        wss://minebench.cloud/sync
```

✅ Будуються web assets з production конфігурацією  
✅ Підписується Electron app (якщо сертифікат налаштований)  
✅ Створюються нативні installer файли  

## Час Вилучення

- **Windows**: 5-15 хвилин
- **macOS**: 5-15 хвилин
- **Linux**: 5-15 хвилин
- **Всі разом**: 15-45 хвилин

## Розміри Файлів

- **Windows .exe**: ~150-200 MB
- **macOS .dmg**: ~180-220 MB
- **Linux .AppImage**: ~140-170 MB
- **Linux .deb**: ~100-130 MB

## Рекомендована Процедура Релізу

1. **На dev машині:**
   ```bash
   npm run dist:all
   ```

2. **Тест на кожній платформі:**
   - Завантажте .exe на Windows
   - Завантажте .dmg на macOS
   - Завантажте .AppImage на Linux

3. **Перевірте кожний:**
   - Installer встановлюється без помилок
   - Додаток запускається нормально
   - Wallet authentication працює з minebench.cloud
   - Немає крешів під час навігації

4. **Розповсюдіть:**
   - Завантажте усі файли з `dist/` на сервер
   - Оновіть links на сайті
   - Повідомте користувачів

## Швидка Допомога

**Що означає "production"?**
- Production = `https://minebench.cloud` (реальна версія)
- Development = `http://localhost:3000` (локальна версія)

**Який вибрати для користувачів?**
- Завжди `npm run dist:*` (це автоматично production)

**Як перевірити що це production?**
- Після встановлення, клацніть ⚙️ з правого нижнього кута
- Повинна бути написана: "production"
- URL повинна бути: `https://minebench.cloud/auth`

**Можу перебудувати?**
- Так, просто запустіть команду ще раз
- Це перезапише старий installer

---

**Версія:** 0.4.4  
**Дата:** January 29, 2026  
**Status:** Ready for Production ✅
