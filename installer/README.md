# Installer Skeleton

This directory is the placeholder skeleton for TSC desktop installers.

## What is already wired

- `package.json` points `electron-builder` `buildResources` to this directory.
- macOS DMG layout is configured (drag app to Applications).
- Windows NSIS installer skeleton is configured via `win/installer.nsh`.
- Linux package metadata (`category`, `synopsis`, desktop comment) is configured.

## Replace these placeholders before release

- `dmg/background.png` — base (1×) art; **pixel size must match** `build.dmg.window` (e.g. 620×420).
- `dmg/background@2x.png` — **Retina (2×)** art at **double** pixel size (e.g. 1240×840 for a 620×420 pt window). Export from your design tool when possible; `electron-builder` merges 1× + 2× into a multi-resolution TIFF so the background **fills the window** on Retina. Without `@2x`, the image can look half-sized with empty margins.
- `icons/mac/icon.icns`: macOS app icon.
- `icons/win/icon.ico`: Windows app icon.
- `icons/linux/`: Linux icon set (`512x512.png` minimum recommended).

### DMG background shows white on macOS

This is usually **not** your PNG/SVG being wrong. Recent macOS Finder builds can ignore the background when `dmgbuild` writes a Finder **bookmark** (`pBBk`) next to the background alias. TSC applies a small `patch-package` fix to `dmg-builder` (see `patches/dmg-builder+25.1.8.patch`) so only the alias is stored. Re-run `npm install` after pulling so `postinstall` applies patches.

## Optional Windows message customization

Edit `win/installer.nsh` to tune installer title/copy strings.

## Suggested quick workflow

1. Drop final artwork into the paths above.
2. Build installers:
   - `npm run build:mac`
   - `npm run build:win`
   - `npm run build:linux`
3. Verify:
   - macOS: DMG opens with background and app-to-Applications layout.
   - Windows: NSIS installer text/flow.
   - Linux: app metadata in desktop menus.
