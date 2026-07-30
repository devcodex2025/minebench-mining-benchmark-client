# 🔧 Створення окремого репозиторію для MineBench-Client

## Проблема
Зараз MineBench-Client є частиною головного репозиторію MineBench-dApp.
Потрібно створити окремий репозиторій для клієнта.

## Рішення (покроково)

### 1️⃣ Створити новий GitHub репозиторій

1. Відкрийте: https://github.com/new
2. Налаштування:
   - Repository name: `MineBench-Client`
   - Description: `MineBench Desktop Mining Client - Cross-platform Electron app`
   - Public
   - **НЕ додавайте** README, .gitignore, license
3. Натисніть "Create repository"

### 2️⃣ Ініціалізувати Git в MineBench-Client

```powershell
cd "D:\Projects\MineBench dApp\MineBench-Client"

# Ініціалізувати новий git репозиторій
git init

# Додати новий remote (замініть на ваш URL з GitHub)
git remote add origin https://github.com/karbivskyi/MineBench-Client.git

# Додати всі файли
git add .

# Перший коміт
git commit -m "Initial commit: MineBench Desktop Client v0.2.0

Features:
- Cross-platform Electron app (Windows x64/ARM64, macOS Intel/Apple Silicon, Linux x64)
- CPU mining with XMRig 6.26.0
- Custom UI with React + Three.js + Tailwind CSS
- Real-time mining statistics and monitoring
- Node synchronization tracking
- Thread control for CPU usage
- BMT rewards system backed by XMR
- Custom title bar and window controls
- GitHub Actions for automated multi-platform releases

Tech Stack:
- Electron 31 + React 18 + TypeScript
- Tailwind CSS 4 + Three.js
- Zustand + Vite + electron-builder"

# Push до GitHub
git branch -M main
git push -u origin main

# Створити перший release tag
git tag v0.2.0
git push origin v0.2.0
```

### 3️⃣ Оновити package.json

Відкрийте `package.json` і оновіть секцію `publish` (рядок ~88):

```json
"publish": {
  "provider": "github",
  "owner": "karbivskyi",
  "repo": "MineBench-Client"
}
```

### 4️⃣ Видалити з головного репозиторію та додати як submodule

```powershell
cd "D:\Projects\MineBench dApp"

# Видалити MineBench-Client з git tracking головного репо
git rm -r --cached MineBench-Client

# Додати в .gitignore головного репо (щоб не трекати локальні зміни)
# Або краще - додати як submodule:

# Додати як submodule
git submodule add https://github.com/karbivskyi/MineBench-Client.git MineBench-Client

# Commit зміни в головному репо
git add .gitignore .gitmodules MineBench-Client
git commit -m "Convert MineBench-Client to separate repository (submodule)"
git push
```

### 5️⃣ Перевірка

```powershell
# Перевірити що submodule працює
cd "D:\Projects\MineBench dApp"
git submodule status

# Клонувати головний проект з submodule (для тесту)
cd D:\Temp
git clone --recursive https://github.com/karbivskyi/MineBench-dApp.git
cd MineBench-dApp\MineBench-Client
npm install
npm run dev:all
```

## 📝 Альтернатива (без submodule)

Якщо НЕ хочете використовувати submodule:

```powershell
cd "D:\Projects\MineBench dApp"

# Просто видалити з tracking
git rm -r --cached MineBench-Client

# Додати в .gitignore
echo "MineBench-Client/" >> .gitignore

# Commit
git add .gitignore
git commit -m "Remove MineBench-Client from main repo (now separate repository)"
git push
```

MineBench-Client залишиться на диску, але більше не буде частиною головного репо.

## ✅ Результат

✅ MineBench-Client - окремий репозиторій
✅ Власні releases та CI/CD
✅ Незалежне версіонування
✅ (Опціонально) Інтеграція через submodule

## 🔗 Корисні посилання після створення

- Репозиторій: https://github.com/karbivskyi/MineBench-Client
- Releases: https://github.com/karbivskyi/MineBench-Client/releases
- Actions: https://github.com/karbivskyi/MineBench-Client/actions
