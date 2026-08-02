# Requirements Document

## Introduction

The Debate feature is turn-based: each participant records their turn with the browser
`MediaRecorder`, uploads it for scoring, and the backend persists a `DebateTurn`. Debate
currently lacks two things that the Group Discussion (GD) feature already provides: (a) **live
voice** between the two participants while a debate is in progress, and (b) a durable,
first-class **post-debate playback** experience in the personal panel and on the results screen.

This document specifies the requirements for adding three capabilities to the existing Debate
feature, plus the non-functional and boundary constraints the design calls out. The requirements
are derived from the approved design (`design.md`) and are organized so that the design's
correctness properties map cleanly onto them:

1. **Live audio between participants (LiveKit).** A `livekit_room` is established around the
   prep/speaking phases and exposed in public state only during those phases; a token endpoint
   mirrors GD's authentication, membership, and status-code behavior; live audio is gated so
   that only the active speaker publishes a microphone while both participants continuously
   subscribe (hear); and the debate degrades gracefully when LiveKit is not configured.
2. **Durable per-speaker audio storage.** Each non-forfeit completed turn produces a durable,
   retrievable audio reference stored through a storage-location abstraction with a stable key
   scheme, with access control restricted to the debate's participants and teachers/admins.
3. **Post-debate playback in the personal panel.** The `my-debates` list and a new
   debate-detail endpoint return per-turn audio references and speaker labels (PII-safe), and
   the results screen and profile "My Debates" panel render per-speaker playback.

The design treats student voice as sensitive PII, introduces no new required environment
variables (LiveKit keys are shared with GD), introduces no new external dependency for the
initial implementation (Cloudflare R2 is an additive, optional, out-of-scope backend), and
preserves the non-modification boundaries established by the group-debate spec.

## Glossary

- **Debate_System**: The overall Debate feature, comprising its backend routes, room manager,
  storage, schemas, and frontend arena/playback views.
- **Debate_Room_Manager**: The backend component (`app/debate/room_manager.py`) that owns debate
  room state, phase transitions, LiveKit room lifecycle, and turn submission.
- **Public_State_Projection**: The `to_public` transformation that produces the
  `PublicDebateRoom` broadcast to clients from the internal `DebateRoom`.
- **LiveKit_Token_Endpoint**: The backend route `GET /debate/rooms/{code}/livekit-token`.
- **Audio_Serve_Endpoint**: The backend route `GET /debate/rooms/{code}/audio/{turn_id}`.
- **My_Debates_Endpoint**: The backend route `GET /debate/my-debates`.
- **Debate_Detail_Endpoint**: The backend route `GET /debate/debates/{debate_id}`.
- **Audio_Blob_Store**: The storage-location abstraction (`app/debate/audio_store.py`) that
  persists and retrieves per-turn audio blobs; default backend is local disk.
- **Debate_Arena_View**: The frontend component (`frontend/src/components/DebateArenaView.tsx`)
  that hosts recording, live audio, and playback UI.
- **Active_Speaker**: The participant whose `turn_index` equals the room's `active_turn_index`
  while the room state is `speaking`.
- **Listener**: A participant who is not the Active_Speaker during the current turn.
- **livekit_room**: The LiveKit room name assigned to a debate for live audio transport.
- **audio_key**: The Audio_Blob_Store key locating a turn's persisted audio blob; format
  `debate-audio/{debate_id}/{turn_id}.{ext}`.
- **audio_url**: The application route URL through which a turn's audio is served.
- **Forfeit_Turn**: A completed turn with a non-null `forfeit_reason` (e.g. `"timeout"`,
  `"reconnect_timeout"`).
- **Non_Forfeit_Turn**: A completed turn with a null `forfeit_reason`.
- **PII**: Personally identifiable information; for this feature, includes user email, user uid,
  and student voice recordings.
- **Teacher_Or_Admin**: An authenticated user whose role is teacher or admin (including
  `is_teacher`).

## Requirements

### Requirement 1: Live audio between participants (LiveKit)

**User Story:** As a debate participant, I want to hear the other participant's voice live while
the debate is in progress, so that the debate feels like a real head-to-head exchange.

#### Acceptance Criteria

1. WHEN a debate room enters the prep phase, WHILE LiveKit is configured, THE Debate_Room_Manager SHALL assign a stable livekit_room name that remains unchanged for the remainder of the debate, and THE Public_State_Projection SHALL include the livekit_room name in the public room state only while the room state is prep or speaking.
2. WHEN a caller requests the LiveKit_Token_Endpoint AND the caller is a participant of the room AND LiveKit is configured AND the room has an assigned livekit_room name, THE LiveKit_Token_Endpoint SHALL return HTTP 200 with a token, the LiveKit connection URL, and the livekit_room name.
3. WHERE LiveKit is not configured, THE Debate_System SHALL allow the debate to proceed to completion with recording, upload, scoring, and playback unaffected, and THE LiveKit_Token_Endpoint SHALL return HTTP 503 with detail `livekit_not_configured`.
4. IF a caller requests the LiveKit_Token_Endpoint for an unknown room, THEN THE LiveKit_Token_Endpoint SHALL return HTTP 404 with detail `room_not_found`.
5. IF a caller requests the LiveKit_Token_Endpoint AND the caller is not a participant of the room, THEN THE LiveKit_Token_Endpoint SHALL return HTTP 403 with detail `not_a_participant`.
6. IF a caller requests the LiveKit_Token_Endpoint AND LiveKit is configured AND the room has no assigned livekit_room name, THEN THE LiveKit_Token_Endpoint SHALL return HTTP 400 with detail `audio_not_ready`.
7. IF token generation fails while LiveKit is configured and the room is ready, THEN THE LiveKit_Token_Endpoint SHALL return HTTP 500 with detail `token_generation_failed`.
8. WHILE the room state is speaking, THE Debate_Arena_View SHALL publish the microphone only for the Active_Speaker, and THE Debate_Arena_View SHALL keep every Listener's microphone unpublished.
9. WHILE the room state is prep or speaking AND a livekit_room name is present, THE Debate_Arena_View SHALL subscribe every participant to the published audio so that each participant hears the live audio.
10. WHILE the room state is prep, THE Debate_Arena_View SHALL keep every participant's microphone unpublished.
11. WHEN the Debate_Room_Manager attempts to assign a livekit_room name to a room that already has one, THE Debate_Room_Manager SHALL preserve the existing livekit_room name.

### Requirement 2: Durable per-speaker audio storage

**User Story:** As a debate participant or reviewing teacher, I want every recorded turn to be
durably stored and retrievable, so that each speaker's audio can be replayed after the debate.

#### Acceptance Criteria

1. WHEN a turn's recording is persisted through the Audio_Blob_Store, THE Debate_Room_Manager SHALL store the blob under the key scheme `debate-audio/{debate_id}/{turn_id}.{ext}` and SHALL record a turn's audio_url as non-null if and only if its audio_key is non-null.
2. WHEN a Non_Forfeit_Turn is completed and its recording is stored successfully, THE Debate_System SHALL ensure the turn has a non-null audio_key, a non-null audio_url, and a blob retrievable from the Audio_Blob_Store.
3. WHEN a caller requests the Audio_Serve_Endpoint, THE Audio_Serve_Endpoint SHALL return the turn's audio if and only if the caller is a participant of the turn's own debate_id or is a Teacher_Or_Admin, evaluating access against the turn's stored debate_id rather than the path code.
4. IF the recording storage write fails for a completed turn, THEN THE Debate_System SHALL persist the turn with its scoring intact and SHALL set both audio_key and audio_url to null.
5. WHEN a Forfeit_Turn is persisted, THE Debate_System SHALL set the turn's audio_key, audio_url, and audio_content_type to null.
6. THE Debate_System SHALL treat the MediaRecorder recording as the authoritative audio used for scoring and durable playback, and SHALL NOT persist LiveKit live-transport audio.
7. IF a caller requests the Audio_Serve_Endpoint for a turn that has no stored audio, THEN THE Audio_Serve_Endpoint SHALL return HTTP 404 with detail `audio_not_available`.
8. IF a caller requests the Audio_Serve_Endpoint for a turn whose audio_key references a missing blob, THEN THE Audio_Serve_Endpoint SHALL return HTTP 404 with detail `audio_file_not_found`.
9. IF an authenticated caller who is neither a participant of the turn's debate_id nor a Teacher_Or_Admin requests the Audio_Serve_Endpoint, THEN THE Audio_Serve_Endpoint SHALL return HTTP 403 with detail `not_authorized`.
10. WHEN the Audio_Serve_Endpoint serves audio from the local disk backend, THE Audio_Serve_Endpoint SHALL stream the blob with the turn's recorded content type.

### Requirement 3: Post-debate playback in the personal panel

**User Story:** As a student, I want to replay each speaker's turn audio from my results screen
and my profile's "My Debates" panel, so that I can review the debate after it ends.

#### Acceptance Criteria

1. WHEN the My_Debates_Endpoint or the Debate_Detail_Endpoint returns a completed debate, THE Debate_System SHALL include per-turn audio references containing the turn_index, participant_id, display_name, audio_url, and is_forfeit flag, and SHALL exclude user email, user uid, and internal WebSocket bookkeeping fields.
2. WHEN a completed debate's per-turn audio references are available, THE Debate_Arena_View SHALL render a per-speaker playback control for each turn on the results screen and in the profile "My Debates" panel.
3. WHERE a turn is a Forfeit_Turn, THE Debate_Arena_View SHALL render no playback control for that turn.
4. WHEN the Debate_Detail_Endpoint is requested for a completed debate, THE Debate_Detail_Endpoint SHALL return the debate_id, code, motion, completed_at, winner_participant_id, and the ordered list of per-turn audio references.
5. WHEN a completed debate's per-turn audio references are ordered, THE Debate_System SHALL order them by ascending turn_index.

### Requirement 4: Protection and retention of student voice data

**User Story:** As a data protection stakeholder, I want student voice recordings treated as
sensitive PII with controlled access and a defined deletion path, so that student privacy is
protected.

#### Acceptance Criteria

1. THE Debate_System SHALL restrict access to stored turn audio to the debate's participants and Teacher_Or_Admin users.
2. THE Audio_Blob_Store SHALL store every debate's audio under a per-debate key prefix `debate-audio/{debate_id}/` so that all of one debate's audio can be enumerated and deleted together.
3. WHERE an object-storage backend is active, THE Audio_Serve_Endpoint SHALL redirect to a short-lived signed URL rather than exposing a durably shareable audio link.
4. THE LiveKit_Token_Endpoint SHALL identify each participant by opaque participant_id and SHALL NOT include user email or user uid in the token response.

### Requirement 5: No new required configuration or external dependencies

**User Story:** As an operator, I want this feature to run with the existing configuration and
dependencies, so that no new setup is required to deploy it.

#### Acceptance Criteria

1. THE Debate_System SHALL reuse the existing `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LIVEKIT_URL` environment variables and SHALL NOT require any new environment variable for live audio.
2. THE Debate_System SHALL use local disk as the default Audio_Blob_Store backend and SHALL NOT require any new external dependency for the initial implementation.
3. WHERE the Cloudflare R2 backend is provided, THE Debate_System SHALL treat it as an additive, optional backend that is disabled by default and out of scope for the initial implementation.

### Requirement 6: Non-modification boundaries

**User Story:** As a maintainer, I want this feature to respect the module boundaries
established by the group-debate spec, so that unrelated subsystems are not disturbed.

#### Acceptance Criteria

1. THE Debate_System SHALL NOT modify `app/pronunciation`, `app/battles`, `app/asr`, `app/audio`, `app/attempts`, `app/auth`, `app/interview`, `app/fluency`, `ss3`, or `app/api/analysis_routes.py`.
2. THE Debate_System SHALL reuse `app/core/livekit_client.py` without modifying it and SHALL enforce microphone publish gating on the client side.
3. THE Debate_System SHALL confine its backend changes to `app/debate/schemas.py`, `app/debate/room_manager.py`, `app/debate/routes.py`, `app/storage/debate_turns.py`, and the new `app/debate/audio_store.py`, with any change to `app/api/profile_routes.py` being additive only.
