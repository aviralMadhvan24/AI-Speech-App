# Four-Person Team Split

This document splits the roadmap into four teammate ownership areas. The goal is to let everyone work in parallel without stepping on each other, while keeping the product architecture clean.

## Team Structure

### Teammate 1: Audio, ASR, and Backend Platform

Primary ownership:

- Audio upload pipeline
- Audio preprocessing
- Whisper or ASR integration
- API routing
- Background jobs later
- Storage paths and file lifecycle
- Backend project structure

Core files/modules:

```text
app/api/
app/audio/
app/asr/
app/services/audio_service.py
app/services/storage_service.py
app/pronunciation/whisper_service.py
app/main.py
```

Phase responsibilities:

- Phase 0A: Clean `/analyze` route.
- Phase 0B: Split audio and ASR into separate modules.
- Phase 1A: Build clean audio and ASR contracts.
- Phase 1B: Add attempt IDs and analysis result persistence support with Teammate 4.
- Phase 6: Move heavy analysis to background workers.

Immediate tasks:

1. Create `app/audio/preprocessing.py`.
2. Create `app/audio/storage.py`.
3. Create `app/asr/whisper_service.py`.
4. Make ASR return a clean structured object.
5. Remove direct heavy logic from `routes.py`.
6. Add upload duration and file size validation.

Do not own:

- Pronunciation scoring logic
- Debate scoring logic
- Frontend battle UX
- Database schema design beyond what is needed for audio paths

Success criteria:

- Any audio file becomes a standard processed WAV.
- ASR output is stable and documented.
- API does not mix ASR, pronunciation, fluency, and communication logic in one function.

## Teammate 2: Pronunciation Assessment Engine

Primary ownership:

- Real pronunciation assessment
- Provider interface
- Word-level pronunciation scores
- Phoneme-level feedback
- Evaluation dataset for known pronunciation errors
- Removing misleading MFA/heuristic scoring from production path

Core files/modules:

```text
app/pronunciation/
app/pronunciation/providers/
app/schemas/pronunciation_schema.py
tests/pronunciation/
```

Phase responsibilities:

- Phase 0A: Mark current pronunciation as unavailable unless a real provider exists.
- Phase 0B: Move MFA to debug-only or remove from production scoring.
- Phase 2A: Implement pronunciation provider interface.
- Phase 2B: Build and test against a labeled pronunciation dataset.

Immediate tasks:

1. Create `PronunciationProvider` interface.
2. Create `MockPronunciationProvider` for development.
3. Define `PronunciationResult`, `WordPronunciationResult`, and `PhonemeError` schemas.
4. Remove transcript-match-as-pronunciation-success from production score.
5. Research and choose provider option: API, GOP, or custom model.
6. Create sample dataset cases:
   - `design -> degien`
   - `specific -> pacific`
   - `subtle` with pronounced `b`
   - `debt` with pronounced `b`
   - `thought -> taught`
   - `world -> word`

Do not own:

- Upload handling
- UI layout
- Debate rubric design
- Authentication and institution data model

Success criteria:

- The app does not claim pronunciation is correct just because transcript matches.
- Pronunciation provider can be swapped without changing routes.
- Known bad recordings are tracked in a test dataset.

## Teammate 3: Fluency, Communication Scoring, and Game Logic

Primary ownership:

- Fluency metrics
- Filler word detection
- Pause analysis
- Communication rubric
- Debate scoring rules
- 1v1 battle scoring rules
- AI debate round structure later

Core files/modules:

```text
app/fluency/
app/rubrics/
app/sessions/
app/battles/
app/data/pronunciation_prompts.json
```

Phase responsibilities:

- Phase 1A: Build initial fluency contract.
- Phase 3A: Add fluency scoring.
- Phase 3B: Add communication rubric scoring.
- Phase 4A: Practice session rules.
- Phase 4B: 1v1 battle rules.
- Phase 4C: Automated debate rules.

Immediate tasks:

1. Create `app/fluency/service.py`.
2. Calculate WPM, speech duration, silence ratio, and long pause count.
3. Add filler word detection from transcript.
4. Create rubric definitions for:
   - clarity
   - structure
   - relevance
   - evidence
   - confidence
   - rebuttal
5. Define battle scoring formula.
6. Define debate round flow.

Do not own:

- Audio preprocessing
- Pronunciation provider integration
- Database migrations
- Static frontend implementation details

Success criteria:

- Fluency score works even without pronunciation provider.
- Debate and battle scoring are rubric-based, not random or only pronunciation-based.
- Every score has a reason students can understand.

## Teammate 4: Frontend, Product UX, Data, and Dashboards

Primary ownership:

- Student-facing frontend
- Teacher/admin experience
- Result visualization
- Attempt history
- Database entities with backend teammate coordination
- Dashboards
- Product flows

Core files/modules:

```text
app/frontend/
app/models/
app/database/
app/schemas/
```

Phase responsibilities:

- Phase 0A: Update frontend to new response shape.
- Phase 1B: Persist attempts and show history.
- Phase 4A: Practice mode UX.
- Phase 4B: 1v1 battle UX.
- Phase 4C: Automated debate UX.
- Phase 5: Data model with backend support.
- Phase 6: Privacy, roles, and dashboards.

Immediate tasks:

1. Redesign result display into sections:
   - transcription
   - pronunciation
   - fluency
   - communication
2. Stop showing “No mistakes found” when pronunciation provider is unavailable.
3. Add honest UI states:
   - analyzing
   - transcription complete
   - pronunciation unavailable
   - provider error
4. Design attempt history page.
5. Define minimum database entities:
   - student
   - prompt
   - attempt
   - analysis result
6. Create teacher dashboard wireframe.

Do not own:

- ASR internals
- Pronunciation model logic
- Fluency algorithm details
- Low-level audio handling

Success criteria:

- Students understand what was and was not assessed.
- Teachers can review attempts and progress.
- The UI does not overclaim model accuracy.

## Shared Interfaces

The team should agree on these contracts before deep implementation.

### Analysis Response Shape

```json
{
  "analysis_id": "uuid",
  "audio": {},
  "transcription": {},
  "pronunciation": {},
  "fluency": {},
  "communication": {},
  "debug": {}
}
```

### Audio Contract

Owned by Teammate 1.

```json
{
  "audio_id": "uuid",
  "original_path": "uploads/file.webm",
  "processed_path": "temp/file.wav",
  "duration_seconds": 4.2,
  "sample_rate": 16000,
  "channels": 1
}
```

### Transcription Contract

Owned by Teammate 1.

```json
{
  "text": "the design is very subtle",
  "language": "en",
  "provider": "whisper",
  "model": "small",
  "words": [
    {
      "word": "design",
      "start": 0.42,
      "end": 0.93,
      "confidence": 0.88
    }
  ]
}
```

### Pronunciation Contract

Owned by Teammate 2.

```json
{
  "available": true,
  "provider": "provider-name",
  "overall_score": 76,
  "words": [],
  "phoneme_errors": []
}
```

When no real provider is configured:

```json
{
  "available": false,
  "provider": null,
  "overall_score": null,
  "words": [],
  "phoneme_errors": [],
  "message": "Pronunciation assessment provider is not configured."
}
```

### Fluency Contract

Owned by Teammate 3.

```json
{
  "words_per_minute": 118,
  "speech_duration_seconds": 3.8,
  "silence_ratio": 0.25,
  "long_pause_count": 1,
  "filler_word_count": 2,
  "repetition_count": 0,
  "score": 72
}
```

### Communication Contract

Owned by Teammate 3.

```json
{
  "available": true,
  "rubric_version": "v1",
  "overall_score": 74,
  "criteria": {
    "structure": {
      "score": 7,
      "feedback": "Clear opening, but the conclusion needs work."
    }
  }
}
```

## Phase Timeline

### Week 1: Reset and Contracts

Teammate 1:

- Refactor `/analyze`.
- Create audio and ASR modules.

Teammate 2:

- Create pronunciation provider interface.
- Remove fake pronunciation success from production response.

Teammate 3:

- Create fluency module.
- Define first rubric draft.

Teammate 4:

- Update frontend to sectioned response.
- Draft attempt history and dashboard UI.

Deliverable:

```text
Clean analysis response with honest pronunciation unavailable state.
```

### Week 2: Foundation

Teammate 1:

- Add file validation and structured logging.
- Add API contract tests.

Teammate 2:

- Research provider and implement mock provider.
- Create initial evaluation dataset.

Teammate 3:

- Implement WPM, pauses, filler words.
- Create scoring formula for fluency.

Teammate 4:

- Implement result UI for transcription and fluency.
- Add attempt display layout.

Deliverable:

```text
Working practice analysis without false pronunciation claims.
```

### Week 3: Pronunciation Provider

Teammate 1:

- Support provider configuration.
- Prepare background-job design.

Teammate 2:

- Integrate real pronunciation provider.
- Return word and phoneme feedback.

Teammate 3:

- Test rubric outputs on sample transcripts.
- Define 1v1 battle scoring rules.

Teammate 4:

- Show pronunciation word-level feedback.
- Improve result visualization.

Deliverable:

```text
First real pronunciation assessment integrated behind provider interface.
```

### Week 4: Persistence and Practice Mode

Teammate 1:

- Add attempt creation endpoint.
- Store audio metadata.

Teammate 2:

- Calibrate provider thresholds with sample dataset.

Teammate 3:

- Add practice mode scoring summary.

Teammate 4:

- Build student attempt history.
- Build teacher review prototype.

Deliverable:

```text
Students can complete practice attempts and review progress.
```

### Week 5: Battles

Teammate 1:

- Add session APIs.

Teammate 2:

- Ensure pronunciation scoring handles battle prompts.

Teammate 3:

- Implement battle round scoring.

Teammate 4:

- Build 1v1 battle UI.

Deliverable:

```text
Basic 1v1 battle mode.
```

### Week 6: Automated Debates

Teammate 1:

- Add debate session APIs.

Teammate 2:

- Add pronunciation summary suitable for debate rounds.

Teammate 3:

- Implement debate rubric and AI opponent flow.

Teammate 4:

- Build automated debate UI.

Deliverable:

```text
First automated debate prototype.
```

## Collaboration Rules

1. Do not change another teammate's module without discussing the interface first.
2. Keep route handlers thin.
3. Put scoring logic in service modules, not frontend code.
4. Store raw provider output for debugging.
5. Do not call transcript match a pronunciation score.
6. Every score shown to students must have feedback text.
7. Every model/provider result should include provider name and version.
8. If a feature is not available, return `available: false` instead of fake results.

## Immediate First Split

Start with these four branches or task tracks:

```text
team-1-audio-asr-cleanup
team-2-pronunciation-provider-interface
team-3-fluency-rubric-engine
team-4-frontend-data-ux
```

First integration milestone:

```text
The /analyze endpoint returns separate audio, transcription, pronunciation, fluency, and communication sections.
```

That milestone must happen before building battles or automated debates.
