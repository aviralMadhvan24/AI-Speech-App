# Implementation Plan: Communication Skills Analyzer (Phase 1)

## Overview

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

The build order is: foundations (schemas, config, session storage, module registry) → Body Language module (scaffolding, frame sampler, five analyzers, entry point) → scoring + feedback → FastAPI routes → frontend (pure reducers first, then views, then wiring) → end-to-end integration. Analyzers live in their own files and have no inter-dependencies, so they can be built in parallel. Property tests sit next to the code they validate so failures show up early. Tests marked with `*` are optional and may be skipped for the tightest MVP path.

Implementation language: **Python 3.11** (backend) + vanilla **HTML/JS + Chart.js** (frontend). Property tests use **Hypothesis** in Python and **fast-check + vitest** for the JS reducers.

## Tasks

- [ ] 1. Project setup and core schemas
  - [x] 1.1 Create project structure and dependencies
    - Create folders: `backend/`, `backend/modules/`, `frontend/`, `frontend/views/`, `frontend/tests/`, `data/sessions/`, `tests/`, `tests/fixtures/`, `tests/integration/`
    - Write `pyproject.toml` with deps: `fastapi`, `uvicorn[standard]`, `python-multipart`, `opencv-python`, `mediapipe`, `numpy`, `pydantic`, `PyYAML`, `pytest`, `hypothesis`, `httpx`, `pytest-asyncio`
    - Write `frontend/package.json` (dev only) with `vitest`, `fast-check`, `jsdom`
    - Add `README.md` with run instructions and `.gitignore` excluding `data/`
    - _Requirements: 11.1, 13.1, 13.3_

- [x] 2. Define core schemas and global backend config
  - [x] 2.1 Implement Pydantic and dataclass schemas in `backend/schemas.py`
    - `MetricResult`, `ModuleResult`, `Suggestion`, `OverallScore`, `Report`, `SessionMetadata`
    - `FrameLandmarks` dataclass (pose / face_mesh / hands optional fields + frame index)
    - `MetricFlag` and `SessionState` literal types
    - _Requirements: 2.4, 8.6, 9.4_
  - [x] 2.2 Implement global backend config loader in `backend/config.py`
    - Read host, port, data_dir, retention_limit from `backend/config.yaml`
    - Defaults if file missing; fail fast if file present but unparseable
    - _Requirements: 12.5, 13.1, 13.3_
  - [x] 2.3 Scaffold Body Language module folder
    - Create `backend/modules/body_language/` with `__init__.py`, `manifest.json`, `config.yaml`, `suggestions.yaml`, `frame_sampler.py` (stub), `analyzers/__init__.py`, `tests/__init__.py`
    - Populate `manifest.json` with id, display_name, version, entry, config_files
    - Populate `config.yaml` with thresholds and weights from design
    - Populate `suggestions.yaml` with low/mid/high/recheck text bank for all five metrics
    - _Requirements: 11.1, 11.9, 12.1, 12.2, 12.3_

- [x] 3. Session manager and storage
  - [x] 3.1 Implement `backend/session_manager.py` core operations
    - `create_session()` returns new UUID4 session_id and writes initial `metadata.json` with state=`queued`
    - `save_video(session_id, bytes)` writes `video.webm` byte-for-byte
    - `update_state(session_id, state, error=None)` rewrites `metadata.json`
    - `save_report(session_id, report)` persists `report.json` and updates metadata `overall_score`
    - `get_report(session_id)`, `get_metadata(session_id)` with not-found handling
    - _Requirements: 2.2, 2.4, 2.5, 14.4_
  - [x] 3.2 Implement retention, listing, and delete in `backend/session_manager.py`
    - `list_sessions()` returns SessionMetadata list sorted by `created_at` descending
    - `delete_session(session_id)` removes the session directory
    - `enforce_retention(limit)` deletes oldest sessions until count ≤ limit; called after every `save_report`
    - _Requirements: 14.1, 14.2, 14.5, 14.6_
  - [ ]* 3.3 Property tests for session lifecycle in `tests/test_session_lifecycle_properties.py`
    - **Property 2: Session identifiers are unique** — Validates: Requirements 2.2
    - **Property 3: Stored video round-trips byte-for-byte** — Validates: Requirements 2.2
    - **Property 4: Session state stays in the allowed set and progresses monotonically** — Validates: Requirements 2.4
    - **Property 5: Report serialization round-trips** — Validates: Requirements 2.5
    - Use `session_event_strategy()` for Property 4 with `@settings(max_examples=100)`
  - [ ]* 3.4 Property tests for listing, delete, and retention in `tests/test_session_retention_properties.py`
    - **Property 14: Sessions list ordering** — Validates: Requirements 14.1, 14.2
    - **Property 15: Delete leaves session absent** — Validates: Requirements 14.5
    - **Property 16: Retention keeps the newest k sessions** — Validates: Requirements 14.6

- [x] 4. Module Registry
  - [x] 4.1 Implement `backend/module_registry.py`
    - Walk `backend/modules/*/manifest.json` at startup, validate shape, `importlib` the `entry` callable
    - Skip and log on bad manifest or import failure; track registration errors
    - Expose `list_modules()` and `get_module(id)`; raise distinct error if `body_language` is missing
    - _Requirements: 11.3, 11.4, 11.6, 11.7_
  - [ ]* 4.2 Unit tests for registry in `tests/test_module_registry.py`
    - Good module registers and is callable
    - Malformed manifest is skipped with logged error, other modules still load
    - Missing `body_language` triggers the no-modules sentinel
    - Unknown module id lookup raises
    - _Requirements: 11.4, 11.6, 11.7, 11.8_

- [x] 5. Body Language config loader and Frame_Sampler
  - [x] 5.1 Implement Body Language config loader at `backend/modules/body_language/config_loader.py`
    - Load `config.yaml` and `suggestions.yaml`
    - Overlay user values onto built-in defaults; emit warnings list for missing analyzer threshold fields
    - Hard-fail if suggestions bank is missing any metric × band entry required by Req 9
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6_
  - [ ]* 5.2 Property test for config overlay in `backend/modules/body_language/tests/test_config_overlay_property.py`
    - **Property 13: Config overlay merges defaults with present fields and warns about missing ones** — Validates: Requirements 12.4
  - [x] 5.3 Implement `Frame_Sampler` in `backend/modules/body_language/frame_sampler.py`
    - Open video with `cv2.VideoCapture`, raise `UnsupportedFormatError` if `isOpened()` is false or first frame read fails
    - Sample at configured fps (default 5) regardless of source fps
    - Run MediaPipe Pose, Face Mesh, Hands on each sampled frame in one pass
    - Return `list[FrameLandmarks]` with detection flags per modality
    - _Requirements: 2.6, 3.1, 4.1, 5.1, 6.1, 7.1_
  - [ ]* 5.4 Unit test for Frame_Sampler in `backend/modules/body_language/tests/test_frame_sampler_examples.py`
    - Loads `tests/fixtures/upright_2s.webm`, asserts ~10 sampled frames at 5 fps, pose detected on majority
    - Loads a 1-frame fixture and asserts the unsupported-format path raises on a `.txt` file
    - _Requirements: 2.6_

- [x] 6. Posture_Analyzer
  - [x] 6.1 Implement `backend/modules/body_language/analyzers/posture.py`
    - Pure function `analyze(frames, cfg) -> MetricResult`
    - Compute neck-to-shoulder angle and shoulder-to-hip vertical alignment per pose-detected frame
    - Apply 15° / 10° default thresholds; produce `score = round(100 × upright / detected)`
    - Flag `low_confidence` with score=0 when pose detection rate ≤ 0.5
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ]* 6.2 Example unit tests in `backend/modules/body_language/tests/test_posture_examples.py`
    - Synthetic upright skeleton → score 100, flag `ok`
    - Synthetic slouched skeleton → score 0, flag `ok`
    - 30% detection rate → score 0, flag `low_confidence`
    - _Requirements: 3.3, 3.4, 3.5_
  - [ ]* 6.3 Property test in `backend/modules/body_language/tests/test_posture_property.py`
    - **Property 6: Posture score formula and low-confidence flag** — Validates: Requirements 3.2, 3.3, 3.4, 3.5
    - `frame_landmarks_strategy()` with random detection success and coordinates; `@settings(max_examples=200)`

- [x] 7. Eye_Contact_Analyzer
  - [x] 7.1 Implement `backend/modules/body_language/analyzers/eye_contact.py`
    - Pure function `analyze(frames, cfg) -> MetricResult`
    - Estimate yaw/pitch via `cv2.solvePnP` on 6 canonical face-mesh points against a generic 3D face model
    - On-camera iff `|yaw| < 15` and `|pitch| < 15`
    - 0% face → score None, flag `detection_failed`; >0 and ≤50% → score 0, flag `low_confidence`; else `score = round(100 × on_camera / face_frames)`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [ ]* 7.2 Example unit tests in `backend/modules/body_language/tests/test_eye_contact_examples.py`
    - Synthetic frontal face → score 100
    - Synthetic 30° yaw face → score 0 (face detected, off-camera)
    - 0% face → score None, flag `detection_failed`
    - _Requirements: 4.3, 4.5, 4.6_
  - [ ]* 7.3 Property test in `backend/modules/body_language/tests/test_eye_contact_property.py`
    - **Property 7: Eye contact score formula and flags** — Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6

- [x] 8. Gesture_Analyzer
  - [x] 8.1 Implement `backend/modules/body_language/analyzers/gesture.py`
    - Per-frame priority-ordered classifier: `hand_to_face` → `crossed_arms` → `open_gesture` → `hands_at_rest` → `hands_not_visible`
    - Compute frame diagonal and apply 10%-diagonal threshold for hand-to-face proximity
    - `score = round(100 × (open_gesture + hands_at_rest) / sampled_frames)`; emit per-category counts in `details`
    - 0 sampled frames → score None, flag `no_frames`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
  - [ ]* 8.2 Example unit tests in `backend/modules/body_language/tests/test_gesture_examples.py`
    - One fixture per category; assert exclusive classification
    - 0-frames input → score None, flag `no_frames`
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.8_
  - [ ]* 8.3 Property test in `backend/modules/body_language/tests/test_gesture_property.py`
    - **Property 8: Gesture classification partitions frames and aggregates correctly** — Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8

- [x] 9. Stillness_Analyzer
  - [x] 9.1 Implement `backend/modules/body_language/analyzers/stillness.py`
    - Per-frame normalized displacement = mean Euclidean distance of nose + both wrists between consecutive pose-detected frames, divided by frame diagonal
    - Compute variance of the series
    - Piecewise-linear map: variance ≤ 0.0005 → 100, ≥ 0.01 → 0, linear in between, clamp + round
    - <2 frames with pose → score 0, flag `low_confidence`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]* 9.2 Example unit tests in `backend/modules/body_language/tests/test_stillness_examples.py`
    - Identical frames → variance 0 → score 100
    - Boundary variance values 0.0005 and 0.01 map exactly
    - 1-frame pose input → score 0, flag `low_confidence`
    - _Requirements: 6.4, 6.5_
  - [ ]* 9.3 Property test in `backend/modules/body_language/tests/test_stillness_property.py`
    - **Property 9: Stillness is translation-invariant and variance-monotone** — Validates: Requirements 6.2, 6.4, 6.5

- [x] 10. Facial_Expression_Analyzer
  - [x] 10.1 Implement `backend/modules/body_language/analyzers/facial_expression.py`
    - Per-frame smile metric = `dist(mouth_left, mouth_right) / dist(eye_left_outer, eye_right_outer)`; smiling iff metric > 0.45
    - `raw_pct = 100 × smiling / face_frames`; cap at 80; rescale `score = round(min(raw, 80) × 100 / 80)`
    - 0% face → score None, flag `student_absent`; >0 and ≤50% → score 0, flag `low_confidence`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - [ ]* 10.2 Example unit tests in `backend/modules/body_language/tests/test_facial_expression_examples.py`
    - Hand-crafted face mesh with known coordinates → expected smile ratio
    - All-smiling input → score 100 (capped + rescaled)
    - 0% face → score None, flag `student_absent`
    - _Requirements: 7.3, 7.4, 7.5_
  - [ ]* 10.3 Property test in `backend/modules/body_language/tests/test_facial_expression_property.py`
    - **Property 10: Smile metric is scale-invariant; score is capped, rescaled, and flag-aware** — Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6

- [x] 11. Body Language module entry point
  - [x] 11.1 Wire `run(video_path, config) -> ModuleResult` in `backend/modules/body_language/__init__.py`
    - Load module config via the config loader, build `cfg` map
    - Call Frame_Sampler once, pass cached `FrameLandmarks` list to all five analyzers
    - Wrap any analyzer-level MediaPipe exception → `MetricResult(score=None, flag="detection_failed")`
    - Return `ModuleResult(module_id="body_language", metrics=[...])` with all five metrics
    - _Requirements: 11.2, 11.9, 3.1, 4.1, 5.1, 6.1, 7.1_
  - [ ]* 11.2 Module-level integration test in `backend/modules/body_language/tests/test_module_integration.py`
    - Run end-to-end against `tests/fixtures/upright_2s.webm`, assert 5 metrics with valid score/flag combinations
    - Run against `tests/fixtures/blank.webm`, assert flagged metrics (no-face, no-pose)
    - _Requirements: 11.2, 11.9_

- [ ] 12. Checkpoint — analyzers and module entry point
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Scoring_Engine
  - [x] 13.1 Implement `backend/scoring.py`
    - `compute_overall(metrics, weights) -> OverallScore`
    - Filter out non-`ok` flags; renormalize surviving weights; weighted-average + round
    - Empty surviving set → `value=0`, `session_flag="low_confidence"`, `applied_weights={}`
    - Record `applied_weights[m]` for every metric (0 for excluded)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [ ]* 13.2 Property test in `tests/test_scoring_property.py`
    - **Property 11: Overall score is a flag-aware weighted average** — Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
    - Use `metric_results_strategy()` with `@settings(max_examples=200)`

- [x] 14. Feedback_Generator
  - [x] 14.1 Implement `backend/feedback.py`
    - `generate(metrics, bank) -> list[Suggestion]`
    - Band selection: 0–39 low, 40–69 mid, 70–100 high
    - `ok` + score<70 → ≥1 suggestion from `bank[m][band]`; `ok` + score≥70 → exactly one from `bank[m]["high"]`
    - Non-`ok` flag → emit `bank[m]["recheck"]` suggestion in addition to any band suggestion
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [ ]* 14.2 Example unit tests in `tests/test_feedback_examples.py`
    - Canned 3-entry bank; assert correct band selection at boundary scores 39, 40, 69, 70
    - Flagged metric emits `recheck` plus the score=0 low-band suggestion
    - _Requirements: 9.2, 9.3, 9.5_
  - [ ]* 14.3 Property test in `tests/test_feedback_property.py`
    - **Property 12: Feedback suggestions are correct and grounded in the bank** — Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5

- [x] 15. FastAPI app and routes
  - [x] 15.1 Create `backend/main.py` app factory
    - Build FastAPI app, mount `frontend/` at `/`, on startup load global config + module registry + body_language config, print local URL
    - Include three (initially empty) routers: `routes_modules`, `routes_precheck`, `routes_sessions`
    - Refuse startup if Body Language config or suggestions bank is invalid
    - _Requirements: 11.7, 12.5, 12.6, 13.1, 13.2, 13.5_
  - [x] 15.2 Implement `backend/routes_modules.py`
    - `GET /modules` returns registered modules with id, display_name, version from the registry
    - _Requirements: 11.4_
  - [x] 15.3 Implement `backend/routes_precheck.py`
    - `POST /precheck` accepts a single JPEG frame, runs MediaPipe Pose + Face Mesh, returns `{pose_ok, face_ok}`
    - _Requirements: 15.1, 15.2_
  - [x] 15.4 Implement `backend/routes_sessions.py`
    - `POST /sessions` multipart upload + optional `modules` field → `create_session` + `save_video` + spawn `BackgroundTasks` pipeline → 202 with `{session_id, state}`
    - Background pipeline: call Body Language `run` → Scoring → Feedback → `save_report` → update state; catch all exceptions and surface `internal_error`
    - Map `UnsupportedFormatError` → state `failed`, code `unsupported_format`
    - 503 with `no_modules_available` when body_language is not registered (Req 11.7)
    - 400 with `unknown_module` for unrecognised module ids (Req 11.8)
    - `GET /sessions`, `GET /sessions/{id}/status`, `GET /sessions/{id}/report`, `DELETE /sessions/{id}` (404 with `session_not_found` when missing)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 11.5, 11.7, 11.8, 14.2, 14.3, 14.4, 14.5_
  - [ ]* 15.5 Integration test (happy path) in `tests/integration/test_happy_path.py`
    - Upload `tests/fixtures/upright_2s.webm`, poll status, fetch report
    - Assert 5 metric entries, applied_weights present, suggestions grouped by metric
    - `GET /modules` includes `body_language`
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 10.5, 11.4_
  - [ ]* 15.6 Integration tests (error paths) in `tests/integration/test_error_paths.py`
    - `.txt` upload → state `failed`, code `unsupported_format`
    - `POST /sessions` with `["unknown_module"]` → 400 `unknown_module`
    - Stubbed missing body_language at startup → 503 `no_modules_available`
    - `GET /sessions/{nonexistent}/report` → 404 `session_not_found`
    - _Requirements: 2.6, 11.7, 11.8, 14.4_

- [ ] 16. Checkpoint — backend end-to-end pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Frontend foundations and recorder reducer
  - [x] 17.1 Create `frontend/index.html`, `frontend/styles.css`, `frontend/vendor/chart.min.js`
    - Three `<section>` skeleton (home, recording, report) with visibility toggling hooks
    - Include Chart.js locally to avoid CDN dependency
    - _Requirements: 13.2, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - [x] 17.2 Implement recorder state-machine reducer in `frontend/recorder.js`
    - Pure ES-module reducer: states `idle | recording | stopped`; events `tick(t)`, `start`, `stop`
    - `stop_enabled = (30 ≤ t < 120)`; transition to `stopped` on `tick(t≥120)` or `stop` when enabled
    - Export the reducer so `vitest` can import it without a browser
    - _Requirements: 1.4, 1.5, 1.6, 1.7_
  - [ ]* 17.3 Property test in `frontend/tests/recorder.test.js`
    - **Property 1: Recorder state machine respects time bounds** — Validates: Requirements 1.4, 1.5, 1.6
    - fast-check with arbitrary event sequences (`tick` / `start` / `stop`) and elapsed times; ≥100 examples

- [x] 18. Frontend pre-check reducer
  - [x] 18.1 Implement readiness + guidance reducer in `frontend/precheck.js`
    - Pure reducer over a sequence of `{pose_ok, face_ok}` results; emits `{indicator: green|amber, guidance: bool}`
    - `indicator = green` iff latest result has both flags true; else `amber`
    - `guidance = true` iff the last 5 results were all `amber`
    - _Requirements: 15.3, 15.4_
  - [ ]* 18.2 Property test in `frontend/tests/precheck_readiness.test.js`
    - **Property 17: Readiness indicator reflects the latest pre-check result** — Validates: Requirements 15.3
    - fast-check with sequence-of-results arbitrary; ≥100 examples
  - [ ]* 18.3 Property test in `frontend/tests/precheck_guidance.test.js`
    - **Property 18: Guidance text triggers on five consecutive amber results** — Validates: Requirements 15.4

- [x] 19. Frontend views and wiring
  - [x] 19.1 Implement `frontend/views/recording_view.js`
    - Wire `getUserMedia` + MediaRecorder + recorder reducer + 1 fps `/precheck` loop using precheck reducer
    - Permission-denied path disables Start and shows guidance text (Req 1.8)
    - On Stop: POST video to `/sessions`, navigate to processing view
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 15.1, 15.3, 15.4, 15.5_
  - [x] 19.2 Implement `frontend/views/home_view.js`
    - Fetch `GET /sessions`, render list sorted by timestamp descending with overall score and delete buttons
    - Delete button calls `DELETE /sessions/{id}` and refreshes list
    - New Recording button navigates to recording view
    - _Requirements: 14.1, 14.2, 14.3, 14.5_
  - [x] 19.3 Implement `frontend/views/report_view.js` (plus processing screen)
    - Processing screen polls `GET /sessions/{id}/status` every 1 s, shows spinner, transitions on `completed`/`failed`
    - Report screen fetches `GET /sessions/{id}/report`, renders Overall_Score, per-metric Chart.js bar chart, gesture-category breakdown chart, suggestion list grouped by metric
    - Low-confidence session banner listing affected metrics
    - "New Recording" button navigates back to recording view
    - On 404, show "session no longer available" message
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 14.4_
  - [x] 19.4 Wire navigation in `frontend/app.js`
    - Bootstrap on `DOMContentLoaded`, render home view, register navigation events between home/recording/processing/report
    - Single top-level state object; view modules import from `recorder.js`, `precheck.js`, and views
    - _Requirements: 1.1, 10.1, 14.1_
  - [ ]* 19.5 DOM smoke tests in `frontend/tests/views.test.js`
    - Renders home/recording/report sections; permission-denied path; empty-state home view
    - _Requirements: 1.1, 1.8, 10.1, 14.1_

- [ ] 20. Final integration test
  - [ ]* 20.1 End-to-end test in `tests/integration/test_e2e.py`
    - Boot the app via `httpx.AsyncClient`, verify URL print on startup
    - Run the full upload → process → poll → fetch report flow against `tests/fixtures/upright_2s.webm`
    - Assert response shape matches the `Report` schema and overall score is in [0,100]
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.8, 13.5_

- [ ] 21. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP path; the core implementation tasks (no `*`) are sufficient to ship a working Phase 1.
- Each analyzer lives in its own file under `backend/modules/body_language/analyzers/` so future modules and contributors can change one without touching others.
- Property tests sit next to the code they validate (analyzer property test in the analyzer's `tests/` folder). Each property test file is named so it can be a separate parallel job.
- Routes are split into `routes_modules.py`, `routes_precheck.py`, `routes_sessions.py` so they can be implemented in parallel without conflicting on `main.py`.
- Frontend state lives in two pure-function reducers (`recorder.js`, `precheck.js`) which is what makes Properties 1, 17, 18 testable with fast-check without a real browser.
- Performance budget (Req 2.8) is validated implicitly by the e2e test on a 2 s fixture; the 60 s benchmark test from the design's Testing Strategy section is intentionally out of scope for the 1–2 week MVP.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["3.1", "4.1", "5.1", "5.3"] },
    { "id": 3, "tasks": ["3.2", "4.2", "5.2", "5.4", "6.1", "7.1", "8.1", "9.1", "10.1", "13.1", "14.1"] },
    { "id": 4, "tasks": ["3.3", "3.4", "6.2", "6.3", "7.2", "7.3", "8.2", "8.3", "9.2", "9.3", "10.2", "10.3", "11.1", "13.2", "14.2", "14.3"] },
    { "id": 5, "tasks": ["11.2", "15.1", "17.1", "17.2", "18.1"] },
    { "id": 6, "tasks": ["15.2", "15.3", "15.4", "17.3", "18.2", "18.3", "19.1", "19.2", "19.3"] },
    { "id": 7, "tasks": ["15.5", "15.6", "19.4"] },
    { "id": 8, "tasks": ["19.5", "20.1"] }
  ]
}
```
