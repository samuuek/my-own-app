# Unified Application Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workbench's browser, in-app brand, Apple Touch, and Windows desktop shortcut icons with the user-provided calendar-check artwork while preserving every module-specific icon.

**Architecture:** Store generated, versioned icon assets under one public app-icon directory and point every brand surface at those assets. Use a reproducible Pillow script for high-quality PNG/ICO generation and a narrowly scoped PowerShell script to update only the existing Windows shortcut.

**Tech Stack:** React 19, static HTML metadata, Python 3 with bundled Pillow 12.3, Windows Script Host shortcut API, Vitest, Node test runner.

## Global Constraints

- Preserve the source artwork's composition, colors, and black outer area.
- Keep a square 1:1 aspect ratio and do not crop the subject.
- Do not replace any module icon under `public/assets/module-icons/`.
- Do not modify application behavior, persistence, database schema, or page layout.
- The desktop shortcut must continue to launch `启动木子工作台.bat` from `C:\Users\76518\Desktop\myownapp`.
- No runtime dependency may be added to `package.json`.

---

### Task 1: Generate versioned application icon assets

**Files:**
- Create: `scripts/generate-app-icons.py`
- Create: `public/assets/app/app-icon-1024-v2.png`
- Create: `public/assets/app/app-icon-brand-512-v2.png`
- Create: `public/assets/app/apple-touch-icon-180-v2.png`
- Create: `public/assets/app/favicon-64-v2.png`
- Create: `public/assets/app/muzi-workspace-v2.ico`
- Test: `tests/app-icon-assets.test.mjs`

**Interfaces:**
- Consumes: A source PNG path passed as the first CLI argument and an output directory passed as the second.
- Produces: Four RGB PNG files at exact dimensions and one ICO containing 16, 24, 32, 48, 64, 128, and 256 pixel frames.

- [ ] **Step 1: Write the failing asset test**

Create `tests/app-icon-assets.test.mjs` using Node's built-in test runner. Read PNG width and height from the IHDR bytes, inspect the ICO directory entries, and assert the exact filenames, dimensions, and frame sizes. Also assert that every file under `public/assets/module-icons/` remains present.

- [ ] **Step 2: Run the asset test and verify red**

Run:

```powershell
node --test tests/app-icon-assets.test.mjs
```

Expected: FAIL because `public/assets/app/app-icon-1024-v2.png` and the other generated assets do not exist.

- [ ] **Step 3: Implement the generator**

Create `scripts/generate-app-icons.py` with these operations:

```python
from pathlib import Path
import sys
from PIL import Image

source = Path(sys.argv[1])
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)

with Image.open(source) as original:
    image = original.convert("RGB")
    for size, name in {
        1024: "app-icon-1024-v2.png",
        512: "app-icon-brand-512-v2.png",
        180: "apple-touch-icon-180-v2.png",
        64: "favicon-64-v2.png",
    }.items():
        resized = image.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(output / name, format="PNG", optimize=True)

    icon = image.resize((256, 256), Image.Resampling.LANCZOS)
    icon.save(
        output / "muzi-workspace-v2.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
```

- [ ] **Step 4: Generate the assets**

Run:

```powershell
& 'C:\Users\76518\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts\generate-app-icons.py 'C:\Users\76518\AppData\Local\Temp\codex-clipboard-9670485c-4250-4efd-ae42-17d39866eb1f.png' public\assets\app
```

Expected: five new files under `public/assets/app/`.

- [ ] **Step 5: Run the asset test and verify green**

Run:

```powershell
node --test tests/app-icon-assets.test.mjs
```

Expected: PASS with four exact PNG sizes and seven ICO frame sizes.

- [ ] **Step 6: Commit generated assets and tooling**

```powershell
git add scripts/generate-app-icons.py tests/app-icon-assets.test.mjs public/assets/app
git commit -m "feat: generate unified application icon assets"
```

### Task 2: Use the unified icon across application brand surfaces

**Files:**
- Modify: `index.html`
- Modify: `src/components/Layout.tsx`
- Modify: `tests/components/app-shell.test.tsx`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `/assets/app/favicon-64-v2.png`, `/assets/app/apple-touch-icon-180-v2.png`, and `/assets/app/app-icon-brand-512-v2.png` from Task 1.
- Produces: Stable HTML metadata and a single brand image source for both regular and Neo appearances.

- [ ] **Step 1: Change tests to require the new icon URLs**

Update component assertions so both regular and Neo appearances expect `/assets/app/app-icon-brand-512-v2.png`. Update rendered HTML assertions to require `/assets/app/favicon-64-v2.png` and `/assets/app/apple-touch-icon-180-v2.png`, and require all five generated assets in `dist/assets/app/`.

- [ ] **Step 2: Run focused tests and verify red**

Run:

```powershell
npx vitest run tests/components/app-shell.test.tsx
node --test tests/rendered-html.test.mjs
```

Expected: component test FAILS with the old brand image source; the rendered artifact test fails before a rebuild because the new asset URLs are absent.

- [ ] **Step 3: Update HTML metadata and brand rendering**

Set `index.html` to:

```html
<link rel="icon" href="/assets/app/favicon-64-v2.png" type="image/png" />
<link rel="apple-touch-icon" href="/assets/app/apple-touch-icon-180-v2.png" />
```

Set the `Layout.tsx` brand image to a single source for all appearances:

```tsx
<img src="/assets/app/app-icon-brand-512-v2.png" alt="" draggable={false} />
```

- [ ] **Step 4: Build and run focused tests**

Run:

```powershell
npx vitest run tests/components/app-shell.test.tsx
npm run build
node --test tests/rendered-html.test.mjs
```

Expected: all focused tests pass and the generated build contains every app icon.

- [ ] **Step 5: Commit brand integration**

```powershell
git add index.html src/components/Layout.tsx tests/components/app-shell.test.tsx tests/rendered-html.test.mjs
git commit -m "style: use unified icon across application branding"
```

### Task 3: Update and verify the Windows desktop shortcut

**Files:**
- Create: `scripts/update-windows-shortcut.ps1`
- Modify: `C:\Users\76518\Desktop\samuel的工作台.lnk`
- Test: `tests/windows-shortcut.test.ps1`

**Interfaces:**
- Consumes: Project root, `启动木子工作台.bat`, and `public/assets/app/muzi-workspace-v2.ico`.
- Produces: A desktop shortcut named `samuel的工作台.lnk` whose target, working directory, description, and icon location are deterministic.

- [ ] **Step 1: Write the failing shortcut inspection test**

Create `tests/windows-shortcut.test.ps1` to open the shortcut with `WScript.Shell` and assert:

```powershell
$shortcut.TargetPath -eq "$env:SystemRoot\System32\cmd.exe"
$shortcut.Arguments -eq '/c "C:\Users\76518\Desktop\myownapp\启动木子工作台.bat"'
$shortcut.WorkingDirectory -eq 'C:\Users\76518\Desktop\myownapp'
$shortcut.IconLocation -like '*\public\assets\app\muzi-workspace-v2.ico,0'
```

- [ ] **Step 2: Run the shortcut test and verify red**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\windows-shortcut.test.ps1
```

Expected: FAIL because the current shortcut does not use the new ICO path.

- [ ] **Step 3: Implement the shortcut updater**

Create `scripts/update-windows-shortcut.ps1` that resolves the project root from the script location, verifies the BAT and ICO exist, and updates only `%USERPROFILE%\Desktop\samuel的工作台.lnk` through `WScript.Shell.CreateShortcut()`. Set target to `%SystemRoot%\System32\cmd.exe`, arguments to `/c "<project>\启动木子工作台.bat"`, working directory to the project root, description to `打开 samuel 的工作台`, and icon location to `<project>\public\assets\app\muzi-workspace-v2.ico,0`.

- [ ] **Step 4: Update the desktop shortcut**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\update-windows-shortcut.ps1
```

Expected: the existing desktop shortcut is updated in place without modifying any other shortcut.

- [ ] **Step 5: Run the shortcut test and verify green**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\windows-shortcut.test.ps1
```

Expected: PASS for target, arguments, working directory, and icon path.

- [ ] **Step 6: Commit the reproducible shortcut tooling**

```powershell
git add scripts/update-windows-shortcut.ps1 tests/windows-shortcut.test.ps1
git commit -m "feat: update Windows desktop shortcut branding"
```

### Task 4: Full verification and desktop launch check

**Files:**
- Verify: all files changed in Tasks 1–3.

**Interfaces:**
- Consumes: The production build, generated icon assets, and updated desktop shortcut.
- Produces: Evidence that web branding and desktop launch behavior work together without affecting module artwork.

- [ ] **Step 1: Run the complete verification suite**

Run:

```powershell
npm run verify
node --test tests/app-icon-assets.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File tests\windows-shortcut.test.ps1
```

Expected: all commands pass with zero failures.

- [ ] **Step 2: Launch through the desktop shortcut**

Invoke `C:\Users\76518\Desktop\samuel的工作台.lnk`, wait for `/api/health` on `http://127.0.0.1:4317`, and verify the production page loads.

- [ ] **Step 3: Verify visible branding**

Confirm the browser favicon URL is `/assets/app/favicon-64-v2.png`, the sidebar brand image URL is `/assets/app/app-icon-brand-512-v2.png`, both images load successfully, and the navigation still contains distinct module artwork URLs.

- [ ] **Step 4: Inspect repository state**

Run:

```powershell
git status --short
git log -4 --oneline
```

Expected: only known pre-existing temporary `.superpowers` files remain untracked; all icon work is committed.
