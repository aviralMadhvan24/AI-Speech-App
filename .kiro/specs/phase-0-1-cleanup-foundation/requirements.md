# Requirements Document

## Introduction

This spec covers Phase 0 (cleanup) and Phase 1 (foundation) of the soft-skills speech platform, as defined in `ROADMAP.md` sections 4, 5, and 13, and `TEAM_SPLIT.md` "Shared Interfaces" and "Phase Timeline > Week 1, 2".

The existing prototype works end-to-end (file upload → ffmpeg preprocess → Whisper transcription → pronunciation provider → JSONL-persisted attempts → frontend). However, the codebase carries misleading code paths (heuristic phoneme timing penalties that pretend to do acoustic scoring), a bloated response shape that mixes new sectioned fields with legacy flat fields, hardcoded developer-machine paths, debug print statements, and incomplete contracts for fluency.

The goal of this spec is to:

1. Remove misleading and dead code from the `/analyze` request flow.
2. Replace the bloated `AnalyzeResponse` with a single clean sectioned shape: `{analysis_id, audio, transcription, pronunciation, fluency, communication, debug}`.
3. Lock down the audio, ASR, fluency, and pronunciation contracts so future phases (Phase 2 pronunciation, Phase 3 fluency, Phase 4 sessions) can build without rework.
4. Add tests, audio fixtures, and analysis-id-correlated structured logging at each pipeline stage.
5. Verify attempts persistence and the `/attempts` history endpoint match the new sectioned shape.

Out of scope (handled by later phases): real pronunciation provider integration beyond `hf_phoneme` (Phase 2), fluency scoring algorithm (Phase 3), communication rubric (Phase 3), sessions and battles (Phase 4), full database (Phase 5), auth and roles (Phase 6).

**Hard constraints:**

- The `hf_phoneme` provider currently works against `facebook/wav2vec2-lv-60-espeak-cv-ft` and MUST continue to work after cleanup. It is the only currently usable real pronunciation engine.
- The frontend was recently updated to show Expected/Heard phonemes and MUST continue to render those after cleanup.
- The `local`, `mock`, and `unavailable` providers MUST remain selectable for tests and fallback.
- No new runtime dependencies beyond what is already in `requirements.txt`.

## Glossary

- **Analyze_API**: The `POST /analyze` route in `app/api/analysis_routes.py`. Accepts a multipart upload and returns one sectioned analysis result.
- **Attempts_API**: The `GET /attempts` route in `app/api/attempts_routes.py`. Returns the most recent attempt summaries.
- **Audio_Service**: The audio ingestion module under `app/audio/` (`storage.py` + `preprocessing.py`). Owns upload validation, ffmpeg preprocessing, and `AudioAsset` production.
- **ASR_Service**: The Whisper-based transcription module under `app/asr/` (`whisper_service.py`). Produces a `TranscriptionResult`.
- **Pronunciation_Service**: The provider dispatcher in `app/pronunciation/service.py` plus the providers under `app/pronunciation/providers/` (`base.py`, `local.py`, `mock.py`, `hf_phoneme.py`, `local_acoustic.py`, `unavailable.py`). Produces a `PronunciationResult`.
- **Fluency_Service**: A new module at `app/fluency/service.py` that produces a fluency section conforming to the Fluency Contract. Phase 1 is contract + stubs only; full scoring is deferred to Phase 3.
- **Attempts_Service**: The JSONL-backed persistence module under `app/attempts/` (`storage.py` + `schemas.py`). Appends `AttemptSummary` records.
- **Frontend**: The vanilla JavaScript app under `app/frontend/` (`app.js`, `index.html`, `styles.css`).
- **Repository**: The codebase rooted at the workspace root, primarily under `app/` and `tests/`.
- **Test_Suite**: The pytest-based tests under `tests/` (and `tests/fixtures/` for audio samples).
- **PRONUNCIATION_PROVIDER**: The environment / settings value in `app.core.config.settings.PRONUNCIATION_PROVIDER` that selects a provider class. Recognized values: `local`, `local_acoustic`, `hf_phoneme`, `mock`. Any unrecognized value resolves to the `unavailable` provider.
- **AudioAsset**: The pydantic record defined in `app/audio/schemas.py` describing one ingested audio file.
- **TranscriptionResult**: The pydantic record defined in `app/asr/schemas.py` describing one ASR pass.
- **PronunciationResult**: The pydantic record defined in `app/schemas/pronunciation_schema.py` describing one pronunciation assessment, including the nested `WordPronunciationResult` and `PhonemeError` records.
- **AttemptSummary**: The pydantic record defined in `app/attempts/schemas.py` describing one persisted attempt.

## Requirements

### Requirement 1: Sectioned analyze response shape

**User Story:** As an API consumer, I want the `/analyze` response to use a single sectioned shape, so that section semantics are clear and downstream code does not have to reconcile sectioned and legacy flat fields.

#### Acceptance Criteria

1. WHEN the Analyze_API returns a successful result, THE Analyze_API SHALL return a JSON body whose top-level keys are exactly `analysis_id`, `audio`, `transcription`, `pronunciation`, `fluency`, `communication`, and `debug`.
2. WHEN the Analyze_API returns a successful result, THE Analyze_API SHALL set `analysis_id` to a newly generated UUID string for that request.
3. WHEN the Analyze_API returns a successful result, THE Analyze_API SHALL populate `audio` with an `AudioAsset` record, `transcription` with a `TranscriptionResult` record, `pronunciation` with a `PronunciationResult` record, and `fluency` with a Fluency Contract record.
4. WHEN the Analyze_API returns a successful result and no real communication rubric provider is configured, THE Analyze_API SHALL set `communication` to `{available: false, provider: null, overall_score: null, message: <reason>}`.
5. WHERE `expected_text` was provided with the upload, THE Analyze_API SHALL include the transcript-vs-expected match score under `debug.transcript_match_score`.
6. WHERE `expected_text` was not provided with the upload, THE Analyze_API SHALL set `debug.expected_text_provided` to `false` and SHALL set `debug.transcript_match_score` to `null`.

### Requirement 2: Honest pronunciation availability

**User Story:** As a student, I want pronunciation results to clearly state whether real assessment was performed, so that I do not trust a score that came only from transcript matching.

#### Acceptance Criteria

1. WHEN PRONUNCIATION_PROVIDER does not resolve to a real provider, THE Pronunciation_Service SHALL return a `PronunciationResult` with `available = false`, `overall_score = null`, `words = []`, and `phoneme_errors = []`.
2. WHEN PRONUNCIATION_PROVIDER resolves to a real provider that completes assessment successfully, THE Pronunciation_Service SHALL return a `PronunciationResult` with `available = true` and `provider` equal to that provider's `provider_name`.
3. IF a configured real provider raises an exception during assessment, THEN THE Pronunciation_Service SHALL return a `PronunciationResult` with `available = false`, `overall_score = null`, and a `message` describing the failure reason.
4. THE Pronunciation_Service SHALL derive `overall_score` only from a provider that implements acoustic or phoneme-level assessment, and SHALL NOT derive `overall_score` from transcript-vs-expected text matching alone.

### Requirement 3: hf_phoneme provider preserved

**User Story:** As a teammate working on Phase 2, I want the `hf_phoneme` provider to keep working through cleanup, so that the only currently usable real pronunciation engine is not lost.

#### Acceptance Criteria

1. WHEN PRONUNCIATION_PROVIDER is set to `hf_phoneme` and the configured HF model and `transformers`+`torch` dependencies are available, THE Pronunciation_Service SHALL invoke `HFPhonemePronunciationProvider.assess` and return its `PronunciationResult` to the Analyze_API unchanged.
2. THE Pronunciation_Service SHALL keep `local`, `local_acoustic`, `mock`, `hf_phoneme`, and `unavailable` selectable by name through `PRONUNCIATION_PROVIDER`.
3. THE `HFPhonemePronunciationProvider` SHALL continue to use `app.pronunciation.phoneme_normalize` for phoneme normalization and `app.pronunciation.phoneme_service` for CMU dict lookups.
4. THE pronunciation providers SHALL conform to the `PronunciationProvider` protocol defined in `app/pronunciation/providers/base.py` and SHALL be loadable without import-time side effects on unrelated providers.

### Requirement 4: Misleading and dead code removed from request flow

**User Story:** As a maintainer, I want misleading pronunciation heuristics and dead phoneme code removed from the `/analyze` request flow, so that new contributors do not extend logic that pretends to do acoustic scoring.

#### Acceptance Criteria

1. THE Pronunciation_Service SHALL compute pronunciation scores exclusively through classes that implement the `PronunciationProvider` protocol.
2. THE Repository SHALL limit `app/pronunciation/scoring_service.py` to the helpers used by the Analyze_API (the transcript-vs-expected comparator and the `calculate_clarity_score` and `calculate_pace_wpm` helpers), and SHALL remove the heuristic phoneme timing helpers `calculate_phoneme_score`, `find_short_phonemes`, `apply_phoneme_timing_penalty`, and `build_word_scores`.
3. THE Repository SHALL use `app.core.logger.logger` for all diagnostic output in modules under `app/api/` and `app/pronunciation/`, and SHALL NOT call the built-in `print` function from those modules.
4. THE Repository SHALL load filesystem paths for external tools and model assets from `app.core.config.settings`, and SHALL NOT hardcode developer-machine paths (paths containing `C:\Users\` or `/home/<user>/`) in modules that are imported by the `/analyze` request flow.
5. IF MFA-based phoneme alignment code (currently in `app/pronunciation/mfa_service.py`) is retained in the Repository, THEN THE Repository SHALL keep that code outside the `/analyze` request flow and SHALL document it as debug-only in the module docstring.
6. THE `app/pronunciation/whisper_service.py` re-export shim SHALL be removed, and remaining ASR consumers SHALL import `transcribe_audio` from `app.asr.whisper_service`.

### Requirement 5: Audio ingestion contract

**User Story:** As a downstream consumer, I want every analysis to carry a complete audio asset record, so that audio metadata is uniformly available for storage, debugging, and future replay.

#### Acceptance Criteria

1. WHEN the Analyze_API accepts an upload, THE Audio_Service SHALL produce an `AudioAsset` record containing `audio_id`, `original_path`, `processed_path`, `duration_seconds`, `sample_rate`, `channels`, and `format`.
2. WHEN preprocessing completes successfully, THE Audio_Service SHALL write `processed_path` as a WAV file with `sample_rate = 16000` and `channels = 1`.
3. IF the uploaded file's `content_type` is not in the supported audio types set, THEN THE Audio_Service SHALL reject the request with HTTP status `415` and a message identifying the unsupported content type.
4. IF the uploaded file's total byte size exceeds `MAX_UPLOAD_BYTES`, THEN THE Audio_Service SHALL reject the request with HTTP status `413`.
5. IF the processed audio duration exceeds `MAX_DURATION_SECONDS`, THEN THE Audio_Service SHALL reject the request with HTTP status `413`.
6. WHEN the Audio_Service produces an `AudioAsset`, THE Audio_Service SHALL set `audio_id` to a newly generated UUID string distinct from the analysis_id.

### Requirement 6: ASR contract

**User Story:** As a downstream consumer, I want every transcription result to follow one stable shape, so that fluency, pronunciation, and persistence modules can rely on it.

#### Acceptance Criteria

1. WHEN the ASR_Service transcribes audio, THE ASR_Service SHALL return a `TranscriptionResult` containing `text`, `normalized_text`, `language`, `provider`, `model`, `words`, and `segments`.
2. WHEN the ASR_Service transcribes audio, THE ASR_Service SHALL populate each entry in `words` with `word`, `start`, `end`, and `confidence`.
3. WHEN the ASR_Service transcribes audio, THE ASR_Service SHALL set `provider` to `"whisper"` and `model` to the active Whisper model name.
4. WHEN the ASR_Service computes `normalized_text`, THE ASR_Service SHALL produce a lowercase string containing only the characters `[a-z0-9 ]` with single-space separation and no leading or trailing whitespace.
5. WHEN the Analyze_API returns a successful result, THE Analyze_API SHALL include the `TranscriptionResult` under the `transcription` section of the response.

### Requirement 7: Fluency contract

**User Story:** As a downstream consumer, I want every analysis to include a fluency section with a fixed shape, so that future fluency scoring can plug in without breaking the contract or the frontend.

#### Acceptance Criteria

1. WHEN the Analyze_API returns a successful result, THE Fluency_Service SHALL produce a fluency section containing `words_per_minute`, `speech_duration_seconds`, `total_duration_seconds`, `silence_ratio`, `long_pause_count`, `filler_word_count`, and `repetition_count`.
2. WHEN the `TranscriptionResult.words` list is non-empty, THE Fluency_Service SHALL compute `words_per_minute` as `len(words) / ((max(word.end) - min(word.start)) / 60.0)`, rounded to two decimal places.
3. WHEN the `TranscriptionResult.words` list is empty, THE Fluency_Service SHALL set `words_per_minute` to `0` and `speech_duration_seconds` to `0`.
4. WHEN the `AudioAsset.duration_seconds` is defined, THE Fluency_Service SHALL set `total_duration_seconds` to that value.
5. THE Fluency_Service SHALL set `silence_ratio` to `null`, and SHALL set `long_pause_count`, `filler_word_count`, and `repetition_count` each to `0` as the Phase 1 stub values, with full computation deferred to Phase 3.
6. WHEN the Fluency_Service produces a fluency section, THE Fluency_Service SHALL include a `clarity_score` field computed by the existing `calculate_clarity_score` helper, until clarity is moved to its own engine in a later phase.

### Requirement 8: Pronunciation contract

**User Story:** As a downstream consumer, I want one pronunciation contract that every provider follows, so that the frontend and persistence handle all providers uniformly.

#### Acceptance Criteria

1. WHEN any pronunciation provider returns a result, THE Pronunciation_Service SHALL deliver a `PronunciationResult` containing `available`, `provider`, `overall_score`, `words`, `phoneme_errors`, and `message`.
2. WHEN `PronunciationResult.available` is `true`, THE Pronunciation_Service SHALL populate `words` with `WordPronunciationResult` entries that each contain `word`, `score`, `expected_phonemes`, `observed_phonemes`, `errors`, and `feedback`.
3. WHEN `PronunciationResult.available` is `false`, THE Pronunciation_Service SHALL set `words` to `[]`, `phoneme_errors` to `[]`, and `overall_score` to `null`.
4. WHEN a `PronunciationResult` contains a non-empty `phoneme_errors` list, THE Pronunciation_Service SHALL set each entry's `type`, `message`, and (where applicable) `word`, `expected`, and `observed` fields.

### Requirement 9: Attempts persistence and history

**User Story:** As a student, I want every analysis to be saved to history, so that I can revisit my recent attempts and providers can see trend data.

#### Acceptance Criteria

1. WHEN the Analyze_API returns a successful result, THE Attempts_Service SHALL append an `AttemptSummary` record to `outputs/attempts.jsonl` (one JSON object per line).
2. WHEN the Attempts_Service builds an `AttemptSummary`, THE Attempts_Service SHALL include `analysis_id`, `created_at` (UTC ISO-8601 string), `expected_text`, `transcript`, `language`, `duration_seconds`, `pronunciation_provider`, `pronunciation_available`, `pronunciation_score`, `clarity_score`, `pace_wpm`, and `mistakes_count`.
3. WHEN the Attempts_Service builds an `AttemptSummary`, THE Attempts_Service SHALL source `pronunciation_provider`, `pronunciation_available`, and `pronunciation_score` from the `pronunciation` section, and SHALL source `clarity_score` and `pace_wpm` from the `fluency` section.
4. WHEN the Attempts_API receives a request with a `limit` query parameter `n` where `1 <= n <= 50`, THE Attempts_API SHALL return at most `n` `AttemptSummary` records ordered newest first.
5. WHEN the Attempts_API receives a request without a `limit`, THE Attempts_API SHALL use a default limit of `20`.
6. IF `limit` is outside the range `[1, 50]`, THEN THE Attempts_API SHALL reject the request with HTTP status `422`.
7. IF persisting an attempt fails due to an I/O error, THEN THE Attempts_Service SHALL log the error at `WARNING` level and the Analyze_API SHALL still return its analysis response with HTTP status `200`.

### Requirement 10: Frontend reads the sectioned response

**User Story:** As a student, I want the existing frontend to keep working after the response shape is cleaned up, so that I do not lose the Expected/Heard phoneme display or the recent-attempts list.

#### Acceptance Criteria

1. WHEN the Frontend receives an Analyze_API response, THE Frontend SHALL read the pronunciation overall score from `pronunciation.overall_score`, the clarity score from `fluency.clarity_score`, and the pace from `fluency.words_per_minute`.
2. WHEN the Frontend renders the per-word panel, THE Frontend SHALL read each word's expected and observed phonemes from `pronunciation.words[*].expected_phonemes` and `pronunciation.words[*].observed_phonemes`, and the per-word feedback from `pronunciation.words[*].feedback`.
3. WHEN the Frontend renders the mismatch panel, THE Frontend SHALL read transcript mismatches from `debug.transcript_mistakes` (a list of `{expected_word, heard_word, feedback}` records produced by the transcript-vs-expected comparator) and phoneme errors from `pronunciation.phoneme_errors`.
4. WHEN the Frontend renders the provider info panel, THE Frontend SHALL read `pronunciation.available`, `pronunciation.provider`, and `pronunciation.message`, and SHALL display "Not configured" when `pronunciation.available` is `false`.
5. WHEN the Frontend renders the attempts panel from `GET /attempts?limit=10`, THE Frontend SHALL read each attempt's fields from the `AttemptSummary` shape defined in Requirement 9.

### Requirement 11: Structured logging with analysis_id correlation

**User Story:** As an operator, I want every pipeline stage to log with the analysis_id, so that I can trace one request across audio, ASR, pronunciation, fluency, and attempts.

#### Acceptance Criteria

1. WHEN the Analyze_API receives a request, THE Analyze_API SHALL log one `INFO`-level record containing `analysis_id`, `audio_id`, the upload `content_type`, and `size_bytes`.
2. WHEN audio preprocessing completes successfully, THE Audio_Service SHALL log one `INFO`-level record containing `analysis_id`, `audio_id`, `processed_path`, `duration_seconds`, `sample_rate`, and `channels`.
3. WHEN the ASR_Service completes transcription, THE ASR_Service SHALL log one `INFO`-level record containing `analysis_id`, `provider`, `model`, and `word_count`.
4. WHEN the Pronunciation_Service completes assessment, THE Pronunciation_Service SHALL log one `INFO`-level record containing `analysis_id`, `provider`, `available`, and `overall_score`.
5. WHEN the Attempts_Service persists an attempt, THE Attempts_Service SHALL log one `INFO`-level record containing `analysis_id`.
6. IF any pipeline stage raises an exception, THEN that stage SHALL log one `ERROR`-level record containing `analysis_id` and the exception class name before the exception propagates.

### Requirement 12: Phase 1 test coverage

**User Story:** As a maintainer, I want automated tests covering each contract, so that future refactors do not silently break the foundation.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a test that verifies the Analyze_API response top-level key set is exactly `{analysis_id, audio, transcription, pronunciation, fluency, communication, debug}`.
2. THE Test_Suite SHALL include tests that verify the Audio_Service rejects unsupported content types with HTTP `415` and oversized uploads with HTTP `413`.
3. THE Test_Suite SHALL include a test that verifies `normalize_transcript` lowercases input, strips punctuation, and collapses whitespace.
4. THE Test_Suite SHALL include a test that verifies the transcript-vs-expected comparator produces a numeric score and a list of mistakes when transcripts diverge.
5. THE Test_Suite SHALL include a test that verifies `Fluency_Service` computes `words_per_minute` from a multi-word `TranscriptionResult` using the formula in Requirement 7.2.
6. THE Test_Suite SHALL include a test that verifies `Attempts_Service.save_attempt` writes one JSON line and `load_recent_attempts(limit=n)` returns the last `n` records newest-first.
7. THE Test_Suite SHALL include a test that verifies `get_pronunciation_provider` returns `LocalPronunciationProvider`, `MockPronunciationProvider`, `LocalAcousticPronunciationProvider`, `HFPhonemePronunciationProvider`, and `UnavailablePronunciationProvider` for the corresponding `PRONUNCIATION_PROVIDER` settings.
8. WHERE small WAV audio fixtures are placed under `tests/fixtures/`, THE Test_Suite SHALL include at least one fixture-backed test that exercises the audio preprocessing path end-to-end (real ffmpeg call).
9. THE Test_Suite SHALL be runnable with `pytest` from the repository root with no additional environment variables.
