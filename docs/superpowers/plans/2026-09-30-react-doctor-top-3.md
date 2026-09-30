# Fix Top 3 React Doctor Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review and eliminate the top 3 React Doctor findings in `@tether/web` (high control-flow complexity, state initializer running on every render, non-component exports in component files) following canonical fix recipes without suppressing rules.

**Architecture:** 
1. Lazy state initialization: wrap direct hook arguments in pure lambdas.
2. Fast Refresh compliance: separate non-component helpers, style variants, and key generators into dedicated modules (`lib/` or `*-variants.ts` / `*-model.ts`).
3. React control-flow decomposition: extract independent conditional branches and sub-sections into focused functional subcomponents while preserving all state, props, refs, and accessibility attributes.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict mode, Tailwind CSS v4, Vitest, React Testing Library.

**Spec:** Canonical fix recipes from React Doctor docs:
- [no-high-complexity-react-function](https://react.doctor/docs/rules/react-doctor/no-high-complexity-react-function)
- [rerender-lazy-state-init](https://react.doctor/docs/rules/react-doctor/rerender-lazy-state-init)
- [only-export-components](https://react.doctor/docs/rules/react-doctor/only-export-components)

## Global Constraints
- Strictly zero rule suppressions or silences.
- Preserve 100% of existing behavior, interfaces, accessibility attributes, and visual styles.
- Keep all files well under the 700-line repository ceiling.
- Strict TypeScript with zero `any`.
- All tests, typechecks, and linters must pass cleanly.

---

### Task 1: Fix `rerender-lazy-state-init` in `components/landing/start-panel.tsx`

**Files:**
- Modify: `apps/web/components/landing/start-panel.tsx:108`

**Interfaces:**
- Consumes: `useSearchParams()` from Next.js.
- Produces: `roomId` state initialized lazily.

- [x] **Step 1: Update `useState` call to pass a lazy initializer**
  Change:
  ```tsx
  const [roomId, setRoomId] = useState(params.get('room') ?? '');
  ```
  To:
  ```tsx
  const [roomId, setRoomId] = useState(() => params.get('room') ?? '');
  ```

- [x] **Step 2: Verify with vitest**
  Run: `pnpm --filter @tether/web test`
  Expected: PASS

---

### Task 2: Fix `only-export-components` across all 4 files (6 diagnostics)

**Files:**
- Create: `apps/web/components/ui/button-variants.ts`
- Modify: `apps/web/components/ui/button.tsx`
- Modify: `apps/web/components/ui/ui.test.tsx`
- Create: `apps/web/lib/presence.ts`
- Modify: `apps/web/components/ui/avatar.tsx`
- Modify: `apps/web/components/landing/mini-editor.tsx`
- Modify: `apps/web/components/workspace/editor/collab.ts`
- Modify: `apps/web/components/workspace/presence-overlays.tsx`
- Create: `apps/web/components/workspace/sync-status-model.ts`
- Modify: `apps/web/components/workspace/sync-status.tsx`
- Modify: `apps/web/components/workspace/sync-status.test.tsx`
- Modify: `apps/web/lib/session.ts`
- Modify: `apps/web/components/workspace/room-screen.tsx`
- Modify: `apps/web/components/landing/start-panel.tsx`

- [x] **Step 2A: Button component non-component export**
  - Extract `buttonVariants` definition into `components/ui/button-variants.ts`.
  - Re-export `buttonVariants` or import in `button.tsx` and `ui.test.tsx`.
  - Note: `button.tsx` only exports `Button` and types `ButtonProps`.

- [x] **Step 2B: Avatar non-component exports**
  - Create `apps/web/lib/presence.ts` with `PRESENCE_CLASSES` and `presenceClass(colorIndex: number)`.
  - Update imports in `mini-editor.tsx`, `editor/collab.ts`, `presence-overlays.tsx`, and `avatar.tsx`.
  - Keep `initials()` unexported in `avatar.tsx`.
  - `avatar.tsx` only exports `Avatar`.

- [x] **Step 2C: SyncStatus non-component exports**
  - Create `apps/web/components/workspace/sync-status-model.ts` containing `StatusView` interface and `describeStatus` function.
  - Update `sync-status.tsx` and `sync-status.test.tsx` to import from `./sync-status-model`.
  - `sync-status.tsx` only exports `StatusPill`, `LatencyHud`, `Metric`.

- [x] **Step 2D: RoomScreen non-component export**
  - Move `seedKey(roomId: string)` from `room-screen.tsx` to `lib/session.ts`.
  - Update imports in `room-screen.tsx` and `start-panel.tsx`.

- [x] **Step 2E: Run tests and typecheck**
  Run: `pnpm --filter @tether/web test && pnpm --filter @tether/web typecheck`
  Expected: PASS

---

### Task 3: Fix `no-high-complexity-react-function` across all 6 files

**Files:**
- Modify: `apps/web/components/landing/start-panel.tsx`
- Modify: `apps/web/components/workspace/room-screen.tsx`
- Modify: `apps/web/components/workspace/drawer.tsx`
- Modify: `apps/web/components/workspace/sidebar.tsx`
- Modify: `apps/web/components/workspace/view-menu.tsx`
- Modify: `apps/web/components/workspace/workspace.tsx`

- [x] **Step 3A: `start-panel.tsx` (`StartPanel`)**
  - Extract `CreateRoomSection` and `JoinRoomSection` subcomponents.
  - Keep state handling clean and pass props.

- [x] **Step 3B: `room-screen.tsx` (`JoinGate`)**
  - Extract `JoinHeader` (logo, language indicator, title, room ID, user count).
  - Extract `JoinPasscodeField` (handling `otpMode`, OTP slots vs password input).

- [x] **Step 3C: `drawer.tsx` (`ChaosLab`)**
  - Extract `StormControls` (`<fieldset>` with bot count, duration, fault injection slider/switches).
  - Extract `StormStatusDisplay` (running orb, gauge/converged badge, or idle explanation).

- [x] **Step 3D: `sidebar.tsx` (`RosterRow`)**
  - Extract `RosterMemberInfo` (avatar, name, host/bot badge, typing/status text).
  - Extract `FollowButton` (follow button tooltip, button, and icons).

- [x] **Step 3E: `view-menu.tsx` (`ViewMenu`)**
  - Extract `WorkspacePanelsItems` and `DiagnosticsViewsItems` subcomponents for the dropdown items.

- [x] **Step 3F: `workspace.tsx` (`Shell`)**
  - Extract `MaximizedPanelView` (rendering maximized editor, preview, sidebar, or drawer).
  - Extract `DesktopResizableLayout` (rendering normal resizable multi-panel layout).

---

### Task 4: Verification & Educational Report

- [x] **Step 4A: Run `react-doctor`**
  Run: `pnpm --filter @tether/web exec npx --yes react-doctor@latest --verbose`
  Confirm that all warnings for `no-high-complexity-react-function`, `rerender-lazy-state-init`, and `only-export-components` have disappeared (0 remaining).

- [x] **Step 4B: Run all verification suites**
  Run `test`, `typecheck`, and `lint` to ensure complete code health.

- [x] **Step 4C: Generate educational report**
  Explain each issue in plain language with concrete real-world impact and severity. Summarize remaining findings for follow-up.
