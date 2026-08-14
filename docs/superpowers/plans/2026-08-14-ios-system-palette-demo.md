# iOS System Palette Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the standalone progress-and-countdown Demo with an iPhone-like light system palette while preserving its layout, content, and interactions.

**Architecture:** Add one final, scoped CSS override block to the existing standalone HTML Demo so the established markup and JavaScript remain unchanged. Verify the palette through static assertions and then exercise the rendered page at desktop and narrow widths.

**Tech Stack:** Standalone HTML, CSS custom properties, browser JavaScript, local Python HTTP server.

## Global Constraints

- Modify only `.superpowers/brainstorm/dashboard-layout/content/interactive-progress-demo.html`.
- Use `#F2F2F7`, `#1C1C1E`, `#8E8E93`, `#D1D1D6`, `#007AFF`, `#34C759`, `#FF9500`, and `#FF3B30` as the canonical palette.
- Do not change layout, information hierarchy, sample data, or JavaScript behavior.
- Do not add dark mode, third-party packages, fonts, or icons.
- The Demo must remain standalone and must not call production APIs or write formal data.

---

### Task 1: Apply the iOS light system palette

**Files:**
- Modify: `.superpowers/brainstorm/dashboard-layout/content/interactive-progress-demo.html`

**Interfaces:**
- Consumes: Existing CSS classes and the current HTML/JavaScript interaction contract.
- Produces: A final `<style id="ios-system-palette">` override block defining the approved palette for every visible surface and state.

- [ ] **Step 1: Record the pre-change palette assertion**

Run:

```powershell
$html = Get-Content -Raw '.superpowers\brainstorm\dashboard-layout\content\interactive-progress-demo.html'
if ($html -match 'id="ios-system-palette"') { throw 'Palette override already exists' }
```

Expected: command succeeds because the approved override is not present yet.

- [ ] **Step 2: Add the scoped palette override**

Insert immediately before `</head>`:

```html
<style id="ios-system-palette">
:root{--bg:#f2f2f7;--ink:#1c1c1e;--muted:#8e8e93;--line:#d1d1d6;--card:rgba(255,255,255,.82);--accent:#007aff;--soft:rgba(0,122,255,.1);--orange:#ff9500;--green:#34c759;--danger:#ff3b30;--shadow:0 10px 30px rgba(0,0,0,.07)}
body{color:var(--ink);background:linear-gradient(180deg,#f8f8fa 0%,#f2f2f7 42%,#e9e9ee 100%);background-attachment:fixed}
body:before{background:radial-gradient(circle,rgba(255,255,255,.9),rgba(255,255,255,0) 70%)}
body:after{background:radial-gradient(circle,rgba(0,122,255,.06),rgba(0,122,255,0) 70%)}
.side,.topbar,.card,.modal,.drawer{background:rgba(255,255,255,.82);border-color:rgba(255,255,255,.95);box-shadow:var(--shadow)}
.side,.topbar,.card{backdrop-filter:blur(24px) saturate(120%);-webkit-backdrop-filter:blur(24px) saturate(120%)}
.nav button{color:#3a3a3c}.nav button.active{color:#0066d6;background:rgba(0,122,255,.11);border-color:rgba(0,122,255,.12);box-shadow:none}
.btn,.iconbtn,.choice,.signal,.module-checks label,.option-row label{color:var(--ink);background:rgba(255,255,255,.9);border-color:rgba(60,60,67,.16);box-shadow:0 3px 12px rgba(0,0,0,.05)}
.btn.primary{background:#007aff;border-color:#007aff;box-shadow:0 6px 16px rgba(0,122,255,.22)}
.ring{background:conic-gradient(#007aff 72%,#e5e5ea 0);box-shadow:0 10px 26px rgba(0,122,255,.14)}
.ring-inner{background:#fff}.bar{background:#e5e5ea}.bar i{background:#007aff}.goal-card .bar i{background:#34c759}
.count-card{border-left-color:#ff9500}.count-card .days{color:#c93400}.timer-live b{color:#ff3b30}
.signal span,.count-card p,.goal-card p,.section-head p,.hero p,.task small,.task-time,.modal>p{color:#8e8e93}
.overlay{background:rgba(28,28,30,.28)}
.field input,.field select{color:#1c1c1e;background:#fff;border-color:#d1d1d6}
.banner{background:#1c1c1e;color:#fff;box-shadow:0 12px 30px rgba(0,0,0,.18)}
.demo-note{color:#6b4c00;background:#fff8e6;border-color:#ffd88a}
</style>
```

- [ ] **Step 3: Run static palette assertions**

Run:

```powershell
$html = Get-Content -Raw '.superpowers\brainstorm\dashboard-layout\content\interactive-progress-demo.html'
$required = @('id="ios-system-palette"','#f2f2f7','#007aff','#34c759','#ff9500','#ff3b30')
foreach ($token in $required) { if (-not $html.Contains($token)) { throw "Missing $token" } }
if ($html -notmatch 'function startTimer\(') { throw 'Timer behavior was removed' }
if ($html -notmatch 'function openOnboarding\(') { throw 'Onboarding behavior was removed' }
```

Expected: all assertions pass with no output.

- [ ] **Step 4: Commit the palette change**

```powershell
git add -- '.superpowers/brainstorm/dashboard-layout/content/interactive-progress-demo.html'
git commit -m "style: adopt iOS system palette in progress demo"
```

### Task 2: Verify rendering and interaction preservation

**Files:**
- Test: `.superpowers/brainstorm/dashboard-layout/content/interactive-progress-demo.html`

**Interfaces:**
- Consumes: The local URL `http://127.0.0.1:8765/interactive-progress-demo.html`.
- Produces: Verified desktop and narrow-screen rendering with unchanged task timer, dialogs, onboarding, and settings behavior.

- [ ] **Step 1: Refresh the local Demo**

Open `http://127.0.0.1:8765/interactive-progress-demo.html` and force a reload so the browser uses the modified HTML.

- [ ] **Step 2: Verify desktop visual state**

At a desktop viewport, confirm the computed page background is based on `#F2F2F7`, the primary button is `#007AFF`, cards are white translucent surfaces, and all four dashboard sections remain visible without overflow.

- [ ] **Step 3: Verify interactions**

Open the 25-minute timer, pause and continue it, open and close the add-date dialog, open the three-step onboarding, and open the settings drawer. Expected: each control changes visible state and Escape closes open dialogs.

- [ ] **Step 4: Verify narrow layout and errors**

At `390 × 844`, confirm the dashboard collapses to one column with no horizontal overflow. Check the browser console and expect zero JavaScript errors.

- [ ] **Step 5: Run project regression tests**

Run:

```powershell
npm test -- --run
```

Expected: the existing test suite passes; the standalone Demo remains isolated from production data.
