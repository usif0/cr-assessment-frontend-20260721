# Implementation Notes

## Screens and state

The list shows the current organization's change requests and filters them by status without changing the underlying rows. Selecting a row loads its detail: baseline/proposed line items, API-provided totals and delta, and an oldest-first approval timeline. Both components expose explicit loading, loaded and error states; the list also distinguishes an empty organization from an empty filter result. The detail keeps confirmed data visible during a decision, disables competing actions, and displays action failures separately from load failures. The demo shell switches users and refreshes the list after a successful decision.

## Changes and requirement review

The existing implementation supplied diff fixes, filtering, timeline ordering, permissions, rejection validation, actions and list synchronization. This pass added list load versions, lifecycle invalidation, reason reset on navigation, and per-CR pending decisions that remain locked across navigation. It expanded rendered tests and completed these notes, preserving the architecture without dependencies.

| Brief requirement                        | Implementation / evidence                                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original failing tests                   | Quantity-only diff and read-only Approve tests pass.                                                                                                                                                            |
| List states and filter                   | DOM tests cover organization scoping, loading, failure/retry, both empty states, filtering, clearing the filter and selection.                                                                                  |
| Diff, totals and timeline                | DOM tests cover all four diff kinds, before/after cells, formatted totals/negative delta, description changes and chronological audit entries. Pure tests cover independent field changes and unchanged values. |
| Status and permissions                   | Only pending requests in the user's organization with an existing approve policy permit decisions. Tests cover every non-pending status, read-only and cross-organization access.                               |
| Actions and validation                   | DOM tests cover success, failure/retry, blank/whitespace reasons, trimming, duplicate/competing clicks and confirmed-state preservation.                                                                        |
| Slow/stale responses and synchronization | Tests control response order, discard older success/error loads, isolate older action completions, and verify actual shell/list/detail refreshes after both decisions.                                          |
| Submission                               | Notes complete; genuine baseline history retained. Clean-install verification and the candidate's 5–8 minute walkthrough remain outstanding.                                                                    |

## Invariants and API contract

`ViewState<T>` remains the shared load-state model. Detail action state is separate: a set of pending CR IDs, a derived `submitting` flag, `actionError` and a reactive `FormControl`. `ngOnChanges` reloads a new ID. The shell listens to `decisionCompleted` and reloads the list, preserving its filter.

| Invariant                               | Enforcement                                                                                                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisions require status and permission | The same getters drive controls and method guards; organization equality is checked too.                                                                                                                                                     |
| One decision at a time per CR           | The CR ID is marked pending before awaiting; buttons and handlers guard it, even after navigating away and back.                                                                                                                             |
| Failures preserve confirmed state       | No optimistic status/audit mutation; failures change `actionError`, and retry retains the reason.                                                                                                                                            |
| Navigation isolates requests            | Reads check load versions. Decisions match the current CR/user; confirming one invalidates pending reads. Each completion releases only its own CR's lock. Navigation clears reason/error; destruction invalidates reads and detail updates. |
| Failed decisions do not persist         | The mock saves inside the successful timer callback. `failNext` is assigned at invocation so overlapping calls are deterministic.                                                                                                            |

The mock's public methods, Promises, organization scope, latency and error messages are preserved. Its existing persistence/failure fix gained rejection/retry and overlapping-call tests. UI guards do not replace server authorization or idempotency.

## Assumptions and tradeoffs

- The supplied `canApprovePolicy` helper governs both decisions. Models lack ownership/workspace membership; no new scope semantics were invented.
- SKU is unique identity. Totals/delta come from the API. The timeline sorts a copy, leaving API data intact.
- Read-only/non-pending views keep Approve disabled and hide Reject, matching the original test. Reasons require non-whitespace text and are trimmed.
- Obsolete Promises are ignored, not cancelled. A successful decision for a previously selected CR still refreshes the list. Request state is component-local, not a cross-tab concurrency protocol.
- Existing zero-delay async tests remain. New component tests use Jest asynchronous fake timers and controlled Promises; Angular 15 `fakeAsync` did not reliably flush native ES2022 `async` continuations in this configuration.

## Validation

- `rtk npm test -- --runInBand`: 5 suites, 55 tests passed.
- `rtk npm run build`: production build passed after an elevated retry; the sandbox initially blocked the optimizer with `spawn EPERM`.
- `rtk npm run typecheck`: passed.
- `rtk npm run lint`: passed without warnings.
- Prettier: changed TypeScript/HTML and this document; unrelated starter files were not reformatted. Command: `$assessmentFiles = @(git diff 49d9485 --name-only -- '*.ts' '*.html') + @(git ls-files --others --exclude-standard -- '*.ts' '*.html'); node node_modules/prettier/bin-prettier.js --check $assessmentFiles IMPLEMENTATION_NOTES.md`.

The host uses Node 24.13.1/npm 11.8.0, outside the declared Node 18 range; Jest reports a `punycode` deprecation warning. `npm ci` and pinned Node 18.20.3 checks were not repeated. No controllable browser is available, so this pass's DOM tests are jsdom evidence, not fresh visual verification. No recording, deployment or upload was performed.

## AI usage and history

Penny AI supplied the starter. The candidate reports manually integrating ChatGPT guidance and code suggestions for the earlier implementation and 17 tests, reviewing changes, running tests/builds and verifying behavior in a browser. That work is AI-assisted, manually integrated and verified; it is not claimed as entirely handwritten. Codex performed this final review, targeted fixes, additional tests, notes and command validation. Earlier browser verification is the candidate's report, distinct from this pass's automated evidence.

The original-code baseline is commit `49d9485`. Earlier implementation was uncommitted when this pass began. New commits group current work by API, UI/tests and notes; no past incremental commits are fabricated, and nothing is pushed.

## With more time

Verify a clean install on Node 18, record the walkthrough, and add browser/keyboard checks and keyboard-accessible list selection. A real service needs server policy/state checks, idempotency, cancellation and shared invalidation for concurrent viewers.


Final local verification (Windows, Node.js 18.20.3):
- npm ci — passed
- npm test -- --runInBand — 55 tests passed
- npm run typecheck — passed
- npm run lint — passed
- npm run build — passed

The earlier Codex review used Node.js 24.13.1.
The final clean installation, tests, and build were subsequently
verified locally using the project's required Node.js version.