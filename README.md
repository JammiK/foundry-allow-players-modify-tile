# Allow Players to Create/Edit Tiles (Foundry VTT v13)

This module allows **players** (non-GM users) to create, move, edit, and delete **Tiles** on the **active Scene**, similarly to how a GM can.

## Setup

1. Copy this folder into your Foundry `Data/modules/` directory as `allow-player-create-tile`.
2. Enable the module in your world.
3. As GM, open **Game Settings → Configure Settings → Module Settings** and enable:
   - **Allow players to create/edit Tiles**

## Notes

- The permission override is intentionally limited to the currently active canvas Scene.
- The module is system-agnostic; it should work fine with D&D 5e / 2024 rules (dnd5e) as well as other systems.

## GitHub Releases (automation)

This repo includes a GitHub Actions workflow that can create a release + zip automatically.

1. Push your changes to `main`.
2. Go to **Actions → Release → Run workflow**.
3. Enter a version like `0.1.0` (without the leading `v`).
4. The workflow will:
   - Update `module.json` (`version`, `url`, `manifest`, `download`)
   - Create and push tag `vX.Y.Z`
   - Build `allow-player-create-tile-vX.Y.Z.zip`
   - Create a GitHub Release and attach the zip

Manifest URL for Foundry install/update checks:
- `https://github.com/JammiK/foundry-allow-players-modify-tile/releases/latest/download/module.json`

## По-русски (кратко)

1. Скопируйте папку модуля в `Data/modules/allow-player-create-tile`.
2. Включите модуль в мире.
3. Зайдите как ГМ в **Настройки игры → Настроить настройки → Настройки модулей** и включите:
   - **Разрешить игрокам создавать/редактировать Tile**

## Релизы на GitHub (автоматически)

В репозитории есть workflow: `.github/workflows/release.yml`.

1. Залей изменения в `main`.
2. Открой **Actions → Release → Run workflow**.
3. Введи версию `0.1.0` (без `v`).
4. Workflow сам обновит `module.json`, создаст тег `v0.1.0`, соберёт zip и создаст Release с ассетом.

Ссылка на манифест (удобно вставлять в Foundry при установке):
- `https://github.com/JammiK/foundry-allow-players-modify-tile/releases/latest/download/module.json`
