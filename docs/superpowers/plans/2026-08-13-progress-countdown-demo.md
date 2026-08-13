# Progress and Countdown Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, interactive browser Demo of the approved layered dashboard, quick task timer, and three-step simple setup without modifying production data.

**Architecture:** Create a standalone HTML prototype inside the existing Superpowers visual-companion session. Demo state lives only in browser memory; interactions update the mock dashboard, timer, onboarding, and settings without calling the workbench API.

**Tech Stack:** Semantic HTML, CSS, browser JavaScript, Superpowers visual companion.

## Global Constraints

- Use the approved A layered layout: today progress, important dates, long-term goals, then today tasks.
- Show five today signals: tasks, reading, fitness, diet, and reflection.
- Include manual and automatic countdown examples plus automatic and manually adjusted goal examples.
- Timer presets are exactly 25, 45, and 60 minutes, plus a custom option.
- Timer completion uses an in-page message and optional light sound only.
- Onboarding has exactly three short steps and can be skipped.
- Demo must not call APIs or write to the user's SQLite database.

---

### Task 1: Layered dashboard visual shell

**Files:**
- Create: `.superpowers/brainstorm/dashboard-layout/content/interactive-demo.html`

**Interfaces:**
- Produces dashboard sections `today-progress`, `important-dates`, `long-term-goals`, and `today-tasks`.

- [ ] Build the existing Samuel workbench-style sidebar and top bar so the prototype feels continuous with the product.
- [ ] Add a 72% progress ring and five labeled status cards using realistic sample data.
- [ ] Add two countdown cards, two long-term goal cards, and four today tasks in the approved visual order.
- [ ] Add responsive CSS that collapses cards to one column below 760 pixels.

### Task 2: Timer and lightweight management interactions

**Files:**
- Modify: `.superpowers/brainstorm/dashboard-layout/content/interactive-demo.html`

**Interfaces:**
- Produces `openTimer(taskId)`, `startTimer(minutes)`, `toggleTimer()`, and `stopTimer()` browser functions.

- [ ] Add a timer chooser with 25, 45, 60, and custom-minute controls.
- [ ] Make the active task show countdown, pause/continue, and end controls while leaving task completion manual.
- [ ] Add “新增日期” and “新增目标” dialogs that update the prototype cards only in memory.
- [ ] Add an in-page completion banner and a sound toggle; use a short Web Audio tone only after a user interaction.

### Task 3: Three-step onboarding and Demo verification

**Files:**
- Modify: `.superpowers/brainstorm/dashboard-layout/content/interactive-demo.html`

**Interfaces:**
- Produces `openOnboarding()`, `nextOnboarding()`, `previousOnboarding()`, and `finishOnboarding()`.

- [ ] Add step 1 module selection, step 2 appearance/theme selection, and step 3 week-start/sound selection.
- [ ] Add a compact settings drawer with common settings visible and an expandable advanced section.
- [ ] Verify every button changes visible state, the timer ticks and pauses, dialogs close with Escape, and no console errors occur.
- [ ] Open the complete Demo at the visual-companion URL and hand it to the user for review.
