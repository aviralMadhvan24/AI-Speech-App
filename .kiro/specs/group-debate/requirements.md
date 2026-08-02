# Requirements Document

## Introduction

Group Debate ek naya multi-player speaking mode hai jahan 4 se 6 students ek shared room me join karke ek motion par baari-baari se bolte hain. Har participant apni turn locally record karta hai (browser MediaRecorder), audio backend par upload hoti hai, aur existing `/analyze` pipeline (Whisper ASR + pronunciation provider + fluency) turn ka AI score compute karta hai. Ek round me har player exactly ek baar bolta hai; highest AI-weighted score wala participant winner declare hota hai. Teacher-role users har turn ka score override kar sakte hain aur comment add kar sakte hain — leaderboard effective score use karta hai.

Feature backend me new modules (`app/debate/`, `app/storage/debates.py`, `app/storage/debate_turns.py`) aur frontend me new view (`DebateArenaView.tsx`) ke through implement hoga. Existing pronunciation, battles, ASR, audio, attempts, auth, interview, admin, fluency, aur `ss3/` modules ko chhua nahi jayega — sirf `MainMenuView.tsx`, `App.tsx`, aur admin panel me additive changes allowed hain. Koi new external dependency (Postgres, Redis, WebRTC media server) introduce nahi hogi; persistence existing JSONL abstraction (`app/storage/_jsonl.py`) ke upar chalegi.

## Glossary

- **Debate_System**: Backend + frontend components collectively responsible for group debate rooms, turn recording, AI scoring, teacher review, and leaderboard.
- **Debate_Room**: A server-side entity identified by a 6-character unambiguous alphabet code, hosting 4 to 6 participants for exactly one debate round.
- **Room_Manager**: In-memory backend component that owns Debate_Room state, turn order, timers, and pause/forfeit transitions.
- **Participant**: An authenticated user (via `require_user`) who has joined a Debate_Room.
- **Speaker**: The Participant whose `turn_index` equals the Debate_Room's current active turn index during the `speaking` state.
- **Turn**: One Participant's single speaking attempt in a Debate_Room, capped at 120 seconds of audio, wrapping exactly one call to the existing `/analyze` pipeline.
- **Motion**: A static debate topic entry loaded from `app/data/debate_motions.json`, shape-parallel to `app/data/pronunciation_prompts.json`.
- **Prep_Phase**: A shared 60-second countdown that begins after auto-start and ends before turn 1 of `speaking`.
- **Reconnect_Grace**: A 30-second orthogonal `paused` overlay triggered when any Participant disconnects mid-debate, during which the disconnected Participant may rejoin.
- **Forfeit**: The state assigned to a Participant who fails to reconnect within Reconnect_Grace or fails to upload audio within the 120s + 15s grace deadline; forfeited Turn receives AI score 0.
- **AI_Score**: Per-Turn score computed as `avg(pronunciation.overall_score, fluency.clarity_score)` from the existing `AnalyzeResponse`; falls back to `fluency.clarity_score` alone if pronunciation is unavailable; 0 with `scoring_unavailable` marker if neither is available.
- **Teacher_Override_Score**: An integer 0–100 set by a `require_teacher` user via the admin review endpoint, optionally accompanied by a comment.
- **Effective_Score**: Teacher_Override_Score if present for a Turn, otherwise AI_Score. Used for winner selection and leaderboard display. For winner selection, Effective_Score values are compared after rounding each value to 1 decimal place, matching the rounded value shown to users in final standings.
- **Room_State**: One of `waiting`, `ready`, `prep`, `speaking`, `scoring`, `complete`, `abandoned`; with orthogonal `paused` overlay applicable during `prep`, `speaking`, or `scoring`.

## Requirements

### Requirement 1: Room Creation and Join Code

**User Story:** As a student, I want to create a debate room and share a short code, so that my classmates can join the same room.

#### Acceptance Criteria

1. WHEN an authenticated user POSTs to `/debate/rooms`, THE Debate_System SHALL create a new Debate_Room in state `waiting` and return a JSON body containing a 6-character room code drawn from an unambiguous alphabet using `secrets.choice`.
2. IF a generated room code collides with an existing active Debate_Room code, THEN THE Debate_System SHALL retry code generation until a non-colliding code is produced before returning the response.
3. WHEN an unauthenticated request hits `POST /debate/rooms`, THE Debate_System SHALL reject the request with the standard `require_user` authentication failure response.
4. WHEN a Debate_Room is created, THE Debate_System SHALL record the creating user as the first Participant with `is_ready = false` and `turn_index = 0`.
5. WHEN a Debate_Room is created, THE Debate_System SHALL assign exactly one Motion selected from `app/data/debate_motions.json` and persist the motion id on the room record.

### Requirement 2: Joining an Existing Room

**User Story:** As a student, I want to join a room using a code, so that I can participate in the debate with my classmates.

#### Acceptance Criteria

1. WHEN an authenticated user POSTs to `/debate/rooms/{code}/join` and the target Debate_Room is in state `waiting` and has fewer than 6 Participants, THE Debate_System SHALL add the caller as a new Participant with `is_ready = false` and return the current public room state.
2. IF the target Debate_Room does not exist, THEN THE Debate_System SHALL respond with HTTP 404 and error code `room_not_found`.
3. IF the target Debate_Room already contains 6 Participants, THEN THE Debate_System SHALL reject the join with error code `room_full`.
4. IF the target Debate_Room's state is not `waiting`, THEN THE Debate_System SHALL reject the join with error code `room_not_joinable`.
5. WHEN a Participant successfully joins, THE Debate_System SHALL broadcast the updated room state to all WebSocket subscribers of that room code.
6. WHERE the caller is already a Participant of the target Debate_Room, THE Debate_System SHALL return the current room state without adding a duplicate Participant entry.

### Requirement 3: Ready Flip and Auto-Start

**User Story:** As a participant, I want to indicate that I'm ready, so that the debate auto-starts once everyone is ready.

#### Acceptance Criteria

1. WHEN an authenticated Participant POSTs to `/debate/rooms/{code}/ready`, THE Debate_System SHALL toggle that Participant's `is_ready` flag and broadcast the updated room state.
2. WHEN every currently-joined Participant has `is_ready = true` AND the Participant count is greater than or equal to 4, THE Debate_System SHALL transition the Debate_Room from `waiting` (or `ready`) to `prep` and start the shared 60-second Prep_Phase countdown.
3. WHILE a Debate_Room's state is `waiting` or `ready`, THE Debate_System SHALL allow any Participant to toggle their own ready flag at any time.
4. IF a caller who is not a Participant of the target Debate_Room POSTs to the ready endpoint, THEN THE Debate_System SHALL reject the request with error code `not_a_participant`.
5. THE Debate_System SHALL NOT expose a host force-start endpoint; auto-start is the only transition path into `prep`.

### Requirement 4: Prep Phase and Motion Reveal

**User Story:** As a participant, I want a shared prep window and to see the motion, so that I can plan what to say before turns start.

#### Acceptance Criteria

1. WHEN a Debate_Room enters `prep`, THE Debate_System SHALL broadcast the Motion (id, title, text, and any side assignments) and a `prep_deadline` timestamp exactly 60 seconds in the future.
2. WHEN the 60-second Prep_Phase countdown reaches zero, THE Debate_System SHALL transition the Debate_Room to `speaking` and set the active `turn_index` to 0.
3. WHILE a Debate_Room is in `prep`, THE Debate_System SHALL reject any turn upload requests with error code `not_in_speaking_state`.
4. WHEN entering `speaking` for the first time, THE Debate_System SHALL assign each Participant a stable `turn_index` in join order starting at 0.

### Requirement 5: Turn Recording Upload

**User Story:** As the current speaker, I want to upload my recorded audio, so that it gets scored and the debate advances to the next speaker.

#### Acceptance Criteria

1. WHEN the current Speaker POSTs multipart audio to `/debate/rooms/{code}/turn` while the Debate_Room is in `speaking` and the caller's `turn_index` equals the room's active turn index, THE Debate_System SHALL accept the upload and enqueue it for analysis.
2. IF a Participant whose `turn_index` does not equal the active turn index POSTs to the turn endpoint, THEN THE Debate_System SHALL reject the request with error code `not_your_turn`.
3. WHEN a Turn upload is accepted, THE Debate_System SHALL invoke the existing `/analyze` pipeline code path (the same as `app/api/analysis_routes.py::analyze_audio`) without modifying that pipeline's modules.
4. WHEN the analysis result is available, THE Debate_System SHALL persist a Turn record via `app/storage/debate_turns.py` containing at minimum `debate_id`, `participant_id`, `turn_index`, `analysis_id`, `ai_score`, `submitted_at`, and `scoring_unavailable` flag.
5. WHEN a Turn's analysis result is persisted, THE Debate_System SHALL advance the active turn index by 1 and broadcast the updated room state.
6. IF the current Speaker has not uploaded audio within 120 seconds plus a 15-second grace period after their turn began, THEN THE Debate_System SHALL mark that Turn as Forfeit with `ai_score = 0` and advance the active turn index.

### Requirement 6: AI Score Computation

**User Story:** As a participant, I want a consistent AI score for each turn, so that comparison across the room is fair.

#### Acceptance Criteria

1. WHEN the existing `/analyze` pipeline returns an `AnalyzeResponse` containing both `pronunciation.overall_score` and `fluency.clarity_score`, THE Debate_System SHALL compute the Turn's AI_Score as the arithmetic average of those two values.
2. IF `pronunciation.overall_score` is unavailable in the `AnalyzeResponse` but `fluency.clarity_score` is available, THEN THE Debate_System SHALL compute the Turn's AI_Score as `fluency.clarity_score` alone.
3. IF neither `pronunciation.overall_score` nor `fluency.clarity_score` is available, THEN THE Debate_System SHALL set the Turn's AI_Score to 0 and set the Turn's `scoring_unavailable` flag to true.
4. THE Debate_System SHALL clamp every persisted AI_Score to the inclusive range 0 through 100.

### Requirement 7: Room Lifecycle State Machine

**User Story:** As a client, I want a well-defined room lifecycle, so that I can render correct UI at every stage.

#### Acceptance Criteria

1. THE Debate_System SHALL model Room_State transitions in strict order: `waiting` → `ready` (implicit sub-state as ready flips arrive) → `prep` → `speaking` → `scoring` → `complete`.
2. WHEN the last Turn's audio has been accepted for analysis and the Debate_Room enters `scoring`, THE Debate_System SHALL wait for every non-forfeit Turn's analysis result to be persisted before transitioning to `complete`.
3. WHEN a Debate_Room enters `complete`, THE Debate_System SHALL persist the final debate record via `app/storage/debates.py` including per-participant Effective_Score, winner id, and completed_at timestamp.
4. IF fewer than 2 Participants remain connected at any point after leaving `waiting`, THEN THE Debate_System SHALL transition the Debate_Room to terminal state `abandoned` and stop accepting further Turn uploads.
5. THE Debate_System SHALL treat `abandoned` and `complete` as terminal states from which no further transitions occur.

### Requirement 8: Disconnect, Pause, and Forfeit

**User Story:** As a participant, I want the debate to pause briefly if someone drops, so that transient network issues don't ruin the round.

#### Acceptance Criteria

1. WHEN any Participant's WebSocket connection closes while the Debate_Room is in `prep`, `speaking`, or `scoring`, THE Debate_System SHALL apply the orthogonal `paused` overlay and start a 30-second Reconnect_Grace countdown for that Participant.
2. WHEN the disconnected Participant re-establishes their WebSocket connection to the same room code within 30 seconds, THE Debate_System SHALL clear the `paused` overlay and resume timers from the point at which they were paused.
3. IF the disconnected Participant does not reconnect within 30 seconds, THEN THE Debate_System SHALL mark that Participant as Forfeit, set any pending or upcoming Turn for that Participant to `ai_score = 0` with `scoring_unavailable = false`, clear the `paused` overlay, and resume the debate with the remaining Participants.
4. WHILE the `paused` overlay is active, THE Debate_System SHALL reject Turn uploads with error code `debate_paused`.
5. WHEN a Forfeit is applied to the currently active Speaker, THE Debate_System SHALL advance the active turn index by 1 and broadcast the updated room state.
6. IF the Participant count of connected non-forfeited Participants drops below 2, THEN THE Debate_System SHALL transition the Debate_Room to `abandoned`.

### Requirement 9: Winner Selection and Ties

**User Story:** As a participant, I want a clear outcome that reflects debate merit, so that no winner is crowned on factors unrelated to the debate.

#### Acceptance Criteria

1. WHEN a Debate_Room enters `complete`, THE Debate_System SHALL compute each Participant's total as their single Turn's Effective_Score.
2. WHEN exactly one Participant holds the strictly highest Effective_Score after each Participant's Effective_Score is rounded to 1 decimal place, THE Debate_System SHALL select that Participant as the winner.
3. WHEN two or more Participants share the highest Effective_Score after each Effective_Score is rounded to 1 decimal place, THE Debate_System SHALL declare a draw by setting `winner_participant_id` to null, marking no Participant as `is_winner` in the final standings, and including the draw outcome in the `complete` state broadcast so the results screen can display a tie result.
4. WHEN a single winner is selected, THE Debate_System SHALL persist the winner's `participant_id` on the debate record and include the winner's `participant_id` in the `complete` state broadcast.
5. WHERE the outcome is a draw, THE Debate_System SHALL count the debate as a win for no Participant in participant win statistics.

### Requirement 10: Teacher Review and Score Override

**User Story:** As a teacher, I want to review completed debates and override AI scores, so that I can correct unfair or noisy AI outputs.

#### Acceptance Criteria

1. WHEN an authenticated `require_teacher` user GETs `/admin/debates?status=pending_review`, THE Debate_System SHALL return the list of debates in state `complete` that have at least one Turn without a Teacher_Override_Score.
2. WHEN a `require_teacher` user GETs `/admin/debates/{debate_id}`, THE Debate_System SHALL return the full debate record including every Turn's `ai_score`, `scoring_unavailable`, existing Teacher_Override_Score, and comment (if any).
3. WHEN a `require_teacher` user POSTs to `/admin/debates/{debate_id}/turns/{turn_id}/review` with an integer `score` in [0, 100] and an optional `comment` string, THE Debate_System SHALL persist those values on the Turn as Teacher_Override_Score and teacher_comment.
4. WHEN a Teacher_Override_Score is persisted for a Turn, THE Debate_System SHALL recompute that Debate_Room's winner using the draw-on-tie rule in Requirement 9 and update the persisted `winner_participant_id`, which SHALL become null WHERE the recomputed outcome is a draw and SHALL become the new winner's `participant_id` WHERE exactly one Participant holds the highest rounded Effective_Score.
5. IF a non-teacher user calls any `/admin/debates*` endpoint, THEN THE Debate_System SHALL reject the request with the standard `require_teacher` failure response.
6. IF the submitted `score` is outside the range [0, 100] or not an integer, THEN THE Debate_System SHALL reject the review with error code `invalid_score`.

### Requirement 11: Public Room State and WebSocket Broadcast

**User Story:** As a client, I want live room state via WebSocket and REST snapshots, so that every participant sees consistent progress.

#### Acceptance Criteria

1. WHEN an authenticated user GETs `/debate/rooms/{code}`, THE Debate_System SHALL return the public room state including code, state, participants (id, display name, is_ready, turn_index, is_forfeit), motion, active turn index, and any active deadline timestamps.
2. WHEN a client connects to `WS /debate/ws/{code}` with a valid Firebase ID token in the query string, THE Debate_System SHALL accept the connection and immediately send the current public room state.
3. IF the query-string ID token is missing or invalid, THEN THE Debate_System SHALL close the WebSocket with close code `4401`.
4. IF the requested room code does not correspond to an existing Debate_Room, THEN THE Debate_System SHALL close the WebSocket with close code `4404`.
5. WHEN Room_State changes (join, ready flip, prep start, turn advance, pause, forfeit, complete, abandoned), THE Debate_System SHALL broadcast the updated public room state to every open WebSocket subscribed to that room code.

### Requirement 12: Motions Catalog

**User Story:** As a participant, I want a curated list of debate motions, so that each debate has a real, coherent topic.

#### Acceptance Criteria

1. THE Debate_System SHALL load motions at startup from the static file `app/data/debate_motions.json`, whose entry shape mirrors `app/data/pronunciation_prompts.json`.
2. WHEN an authenticated user GETs `/debate/motions`, THE Debate_System SHALL return the full loaded motions list.
3. WHEN creating a Debate_Room, THE Debate_System SHALL select exactly one Motion from the loaded list and pin it to the room for the remainder of the room's lifecycle.
4. IF `app/data/debate_motions.json` is missing or fails to parse, THEN THE Debate_System SHALL fail room creation with error code `motions_unavailable` and log the parse failure.

### Requirement 13: Participant Debate History

**User Story:** As a student, I want to see my past debates, so that I can review my scores and teacher feedback.

#### Acceptance Criteria

1. WHEN an authenticated user GETs `/debate/my-debates`, THE Debate_System SHALL return the list of debates in state `complete` in which the caller was a Participant.
2. THE Debate_System SHALL include per-debate: room code, motion, completed_at, caller's `ai_score`, caller's Teacher_Override_Score if present, caller's teacher_comment if present, and winner participant id.
3. THE Debate_System SHALL order the returned list by `completed_at` in descending order.
4. IF the caller has no completed debates, THEN THE Debate_System SHALL return an empty list with HTTP 200.

### Requirement 14: Frontend Integration Surface

**User Story:** As a student using the web app, I want a Group Debate tile and full arena UI, so that I can run through the whole debate flow from one place.

#### Acceptance Criteria

1. THE Debate_System SHALL add a new "Group Debate" tile to `frontend/src/components/MainMenuView.tsx` that routes into a new `DebateArenaView.tsx` via the `App.tsx` view state machine.
2. THE Debate_System SHALL provide a new `frontend/src/debateApi.ts` HTTP wrapper covering room create, join, ready, turn upload, state fetch, motions list, and my-debates list, mirroring the structure of `battleApi.ts`.
3. THE Debate_System SHALL provide a new `frontend/src/hooks/useDebateSocket.ts` WebSocket client with automatic reconnect and Firebase ID token attached via query string, mirroring `useBattleSocket.ts`.
4. WHILE a Debate_Room is in `speaking` and the client is the active Speaker, THE Debate_System frontend SHALL start local MediaRecorder capture, auto-stop at 120 seconds, and upload the resulting audio blob to `/debate/rooms/{code}/turn`.
5. THE Debate_System SHALL add a new "Pending Debates" tab to `frontend/src/components/AdminPanelView.tsx` mirroring the existing "Pending Interviews" tab layout and wiring it to the `/admin/debates` endpoints.
6. THE Debate_System SHALL add a `/debate` proxy entry to the Vite dev configuration so that dev frontend requests reach backend port 8080.

### Requirement 15: Storage and Persistence Boundaries

**User Story:** As a maintainer, I want debate data isolated in new JSONL stores, so that we avoid touching existing storage modules.

#### Acceptance Criteria

1. THE Debate_System SHALL persist debate room records via a new module `app/storage/debates.py` built on top of the existing `app/storage/_jsonl.py` abstraction.
2. THE Debate_System SHALL persist per-turn records via a new module `app/storage/debate_turns.py` built on top of the existing `app/storage/_jsonl.py` abstraction.
3. THE Debate_System SHALL NOT introduce any new database engine, message broker, or media server dependency (including Postgres, Redis, and WebRTC media servers).
4. WHERE a Turn stores its analysis linkage, THE Debate_System SHALL store the existing `analysis_id` returned by the `/analyze` pipeline rather than duplicating raw pronunciation or fluency payloads.

### Requirement 16: Non-Modification Boundaries

**User Story:** As a maintainer, I want existing modules preserved, so that the feature ships without regressing established flows.

#### Acceptance Criteria

1. THE Debate_System SHALL NOT modify any file under `app/pronunciation/`, `app/battles/`, `app/asr/`, `app/audio/`, `app/attempts/`, `app/auth/`, `app/interview/`, `app/fluency/`, or `ss3/`.
2. WHERE new admin endpoints are required, THE Debate_System SHALL expose them via a new admin sub-router rather than editing existing files in `app/admin/`, except for the minimal registration wiring needed to mount the new sub-router.
3. THE Debate_System SHALL NOT modify existing frontend feature views for Pronunciation, Battle, Voice CruiseControl, or Interview Studio; only additive changes to `frontend/src/components/MainMenuView.tsx`, `frontend/src/App.tsx`, and `frontend/src/components/AdminPanelView.tsx` are permitted.
4. THE Debate_System SHALL reuse the existing `/analyze` pipeline code path (`app/api/analysis_routes.py::analyze_audio`) for every Turn without altering that route, its callees, or its response schema.
5. IF an implementation change would require editing any module listed in acceptance criterion 1, THEN the Debate_System implementers SHALL surface the conflict for scope review before proceeding, rather than modifying the protected module.
