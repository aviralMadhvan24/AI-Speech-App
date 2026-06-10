# Soft Skills Platform Production Roadmap

## 1. Product Goal

Build a production-grade soft-skills platform for colleges where students can practice and be assessed on spoken communication through pronunciation drills, automated debates, 1v1 battles, fluency challenges, and structured speaking tasks.

The platform should eventually measure:

- Pronunciation accuracy
- Fluency and pacing
- Clarity
- Filler-word usage
- Confidence signals
- Argument structure
- Relevance to topic
- Listening and rebuttal quality
- Turn-taking behavior
- Improvement over time

The current project is a useful prototype, but its core pronunciation logic is not production-ready because it relies mainly on speech-to-text matching.

## 2. Current Core Problem

The current pronunciation flow is:

1. User uploads or records audio.
2. Audio is preprocessed with ffmpeg.
3. Whisper transcribes the audio.
4. The transcript is compared with the expected text.
5. MFA tries to align text with audio.
6. Scores are generated from word similarity, Whisper confidence, and forced alignment.

This fails for production pronunciation assessment.

Example:

```text
Expected: The design is very subtle
Student says: The degien is very subtle
Whisper transcript: The design is very subtle
```

Whisper corrects the student's speech into the likely intended word. The system then compares expected text to recognized text and sees no error.

This is the central architectural mistake:

```text
Speech-to-text is being used as pronunciation assessment.
```

Whisper should be used for transcription and content analysis, not as the judge of whether each phoneme was pronounced correctly.

## 3. Target Architecture

The platform should be split into independent engines.

### 3.1 Audio Ingestion Engine

Responsibilities:

- Accept browser recordings and uploaded files.
- Validate file size, duration, format, and MIME type.
- Convert audio to a standard format.
- Store original and processed audio.
- Extract duration, sample rate, loudness, and silence statistics.

Target processed format:

```text
WAV, mono, 16 kHz, PCM
```

### 3.2 ASR Engine

Responsibilities:

- Generate transcript.
- Generate word timestamps.
- Generate word confidence where available.
- Detect language.
- Support future model replacement.

ASR should answer:

```text
What did the student most likely say?
```

ASR should not answer:

```text
Did the student pronounce each sound correctly?
```

### 3.3 Pronunciation Assessment Engine

Responsibilities:

- Compare expected phonemes against actual acoustic evidence.
- Score words and phonemes.
- Detect omitted, inserted, substituted, or distorted sounds.
- Return feedback that is specific enough for a student to improve.

This engine must not rely only on transcript comparison.

Possible approaches:

- Dedicated pronunciation assessment API
- Goodness of Pronunciation scoring
- Phoneme posterior model
- Forced alignment plus acoustic likelihood scoring
- Fine-tuned speech model for pronunciation error detection

### 3.4 Fluency Engine

Responsibilities:

- Words per minute
- Speaking duration
- Silence duration
- Pause count
- Long pause detection
- Filler words
- Repetitions
- Restarts
- Speech rate stability

This engine should work for both prompt-based drills and open-ended speaking.

### 3.5 Communication Rubric Engine

Responsibilities:

- Topic relevance
- Answer structure
- Argument quality
- Evidence usage
- Rebuttal quality
- Persuasiveness
- Conciseness
- Vocabulary range
- Grammar and coherence

This engine can use LLM-based evaluation, but only after the ASR transcript is available.

### 3.6 Session and Game Engine

Responsibilities:

- Practice sessions
- Debate rounds
- 1v1 battles
- Timers
- Matchmaking
- Scoring rules
- Turn-taking
- Leaderboards
- Skill progression

This should be separate from audio analysis.

### 3.7 Data and Analytics Engine

Responsibilities:

- Store students, institutions, classes, assignments, attempts, scores, and feedback.
- Track improvement over time.
- Track rubric versions.
- Store raw model outputs for debugging.
- Support teacher dashboards.
- Support data export.

## 4. Phase 0: Clean Up the Prototype

Goal:

Make the current codebase understandable, remove misleading logic, and prepare it for real modules.

### 4.1 Remove Misleading Code

Remove or isolate code that pretends to do pronunciation detection but only compares transcripts.

Candidates:

- Heuristic phoneme timing penalties in `scoring_service.py`
- Unused `heard_phonemes` variables
- Debug `print()` statements in routes
- Hardcoded MFA local paths
- Any dead phoneme-recognition imports or references

### 4.2 Keep Useful Prototype Pieces

Keep:

- File upload flow
- ffmpeg preprocessing
- Whisper transcription
- Prompt list
- Basic frontend recorder
- Basic clarity and pace metrics

### 4.3 Rename Modules Around Actual Responsibility

Current names can mislead future development.

Suggested structure:

```text
app/
  api/
    routes/
      health_routes.py
      analysis_routes.py
      prompt_routes.py
  audio/
    storage.py
    preprocessing.py
    metadata.py
  asr/
    whisper_service.py
    schemas.py
  pronunciation/
    service.py
    providers/
      base.py
      mock.py
  fluency/
    service.py
  rubrics/
    service.py
  sessions/
    service.py
  models/
    database_models.py
  schemas/
    analysis.py
```

### 4.4 Add Clear Result Types

Create separate response sections:

```json
{
  "transcription": {},
  "pronunciation": {},
  "fluency": {},
  "communication": {},
  "debug": {}
}
```

This prevents transcript confidence, pronunciation accuracy, and communication quality from being mixed into one vague score.

## 5. Phase 1: Build a Reliable Analysis Foundation

Goal:

Create a clean, testable audio analysis pipeline without pretending pronunciation is solved.

### 5.1 Audio Input Contract

Every analysis should produce:

```json
{
  "audio_id": "uuid",
  "original_path": "...",
  "processed_path": "...",
  "duration_seconds": 4.2,
  "sample_rate": 16000,
  "channels": 1,
  "format": "wav"
}
```

### 5.2 ASR Contract

Every transcription should produce:

```json
{
  "text": "the design is very subtle",
  "language": "en",
  "words": [
    {
      "word": "the",
      "start": 0.12,
      "end": 0.29,
      "confidence": 0.91
    }
  ],
  "segments": [],
  "provider": "whisper",
  "model": "small"
}
```

### 5.3 Fluency Contract

Initial fluency metrics:

```json
{
  "words_per_minute": 118,
  "speech_duration_seconds": 3.8,
  "total_duration_seconds": 5.1,
  "silence_ratio": 0.25,
  "long_pause_count": 1,
  "filler_word_count": 2,
  "repetition_count": 0
}
```

### 5.4 Pronunciation Contract Placeholder

Until a real pronunciation provider exists, return:

```json
{
  "available": false,
  "provider": null,
  "overall_score": null,
  "message": "Pronunciation assessment provider is not configured."
}
```

This is more honest than returning fake high scores.

### 5.5 Tests for Phase 1

Add tests for:

- Audio normalization path generation
- Transcript normalization
- Word mismatch scoring
- Fluency metrics
- API response shape
- Unsupported file type rejection

## 6. Phase 2: Add Real Pronunciation Assessment

Goal:

Detect pronunciation errors like:

```text
design -> degien
specific -> pacific
thought -> taught
world -> word
debt -> debt with b pronounced
subtle -> subtle with b pronounced
```

### 6.1 Provider Interface

Create an interface:

```python
class PronunciationProvider:
    def assess(self, audio_path: str, expected_text: str) -> PronunciationResult:
        ...
```

The rest of the app should not care whether the provider is Azure, a custom model, GOP, or another engine.

### 6.2 Required Output

A real provider should return:

```json
{
  "overall_score": 76,
  "words": [
    {
      "word": "design",
      "score": 52,
      "expected_phonemes": ["D", "IH", "Z", "AY", "N"],
      "observed_phonemes": ["D", "EH", "JH", "IY", "N"],
      "errors": [
        {
          "type": "substitution",
          "expected": "Z",
          "observed": "JH",
          "message": "The /z/ sound was not clear."
        }
      ]
    }
  ]
}
```

### 6.3 Provider Options

#### Option A: Pronunciation Assessment API

Best for fastest production path.

Pros:

- Quickest to ship
- Better word and phoneme scoring
- Less ML infrastructure
- Easier to explain to stakeholders

Cons:

- Paid
- Vendor dependency
- Data privacy review required
- Internet dependency unless using enterprise/on-prem options

#### Option B: GOP-Based Scoring

Good middle path if you want control.

Pros:

- Can be self-hosted
- More transparent
- Works with expected text

Cons:

- Requires acoustic model knowledge
- Needs calibration
- More engineering effort
- Harder to make robust across accents

#### Option C: Custom Model

Best long-term differentiation.

Pros:

- Own scoring logic
- Can adapt to Indian college learners
- Strong product moat

Cons:

- Needs dataset
- Needs ML expertise
- Longer timeline
- Requires evaluation pipeline

### 6.4 Recommendation

For the first production version:

1. Use a pronunciation assessment API behind a provider interface.
2. Store all provider raw outputs.
3. Build your own evaluation dataset.
4. Later replace or supplement the provider with a custom model.

## 7. Phase 3: Build Soft-Skills Scoring

Goal:

Move beyond word pronunciation into communication coaching.

### 7.1 Fluency Metrics

Implement:

- WPM
- Pause frequency
- Long pauses
- Silence ratio
- Filler words
- Repeated starts
- Sentence length
- Speaking consistency

### 7.2 Content Metrics

For prompt answers:

- Relevance
- Completeness
- Structure
- Examples
- Clarity
- Conciseness

For debates:

- Claim clarity
- Evidence quality
- Counterargument handling
- Logical consistency
- Respectful disagreement
- Time usage

### 7.3 LLM Rubric Evaluation

Use an LLM to evaluate transcripts against rubric criteria.

Important:

- Keep rubric versions in the database.
- Store prompts and outputs.
- Do not use a single vague score.
- Return category scores with explanations.

Example:

```json
{
  "structure": {
    "score": 7,
    "feedback": "Clear opening claim, but conclusion was weak."
  },
  "evidence": {
    "score": 5,
    "feedback": "The answer used opinions but no concrete examples."
  }
}
```

## 8. Phase 4: Sessions, Battles, and Debates

Goal:

Build the actual college-facing experience.

### 8.1 Practice Mode

Student practices one prompt at a time.

Flow:

1. Select skill.
2. Receive prompt.
3. Record answer.
4. Get analysis.
5. Retry.
6. Compare attempts.

### 8.2 1v1 Battle Mode

Two students answer the same or opposing prompts.

Battle scoring:

- Pronunciation
- Fluency
- Relevance
- Argument quality
- Time discipline
- Rebuttal strength

Avoid making pronunciation the only battle score.

### 8.3 Automated Debate Mode

Student debates against AI or another student.

Round structure:

1. Opening statement
2. Response
3. Rebuttal
4. Closing

Each round should have:

- Timer
- Prompt
- Transcript
- Audio
- Rubric score
- Feedback

### 8.4 Teacher Assignment Mode

Teachers create assignments:

- Topic
- Skill focus
- Time limit
- Rubric
- Due date
- Attempts allowed

Students submit recordings. Teachers view dashboards.

## 9. Phase 5: Data Model

Core entities:

```text
Institution
Classroom
Teacher
Student
Prompt
Assignment
Session
Attempt
AudioAsset
Transcript
PronunciationResult
FluencyResult
RubricResult
Battle
BattleRound
LeaderboardEntry
```

Minimum production tables:

- users
- institutions
- classrooms
- prompts
- assignments
- attempts
- audio_assets
- analysis_results
- rubric_versions

Each attempt should store:

- user id
- prompt id
- expected text
- audio path
- processed audio path
- transcript
- analysis JSON
- model/provider versions
- created timestamp

## 10. Phase 6: Production Readiness

### 10.1 Security

Add:

- Authentication
- Role-based access
- Teacher/student separation
- File upload limits
- MIME validation
- Virus scanning if needed
- Signed URLs for audio access
- Data retention policy

### 10.2 Privacy

Because this is for colleges, audio data is sensitive.

Define:

- Who can access student audio
- How long audio is retained
- Whether audio can be used for model improvement
- How deletion requests work
- Whether data leaves India or institution-approved regions

### 10.3 Scalability

Do not run heavy audio analysis directly inside API requests forever.

Target architecture:

```text
FastAPI API
Queue
Worker service
Model/provider services
Postgres
Object storage
Frontend
```

Use background jobs for:

- Transcription
- Pronunciation assessment
- Rubric evaluation
- Report generation

### 10.4 Observability

Add:

- Structured logs
- Request ids
- Analysis ids
- Error tracking
- Model latency metrics
- Provider failure metrics
- Score distribution dashboards

## 11. Phase 7: Evaluation Dataset

This is essential.

Create a test dataset before trusting scores.

Include recordings for:

- Correct pronunciation
- Common Indian English variations
- Known wrong pronunciations
- Background noise
- Different microphones
- Male and female voices
- Fast speech
- Slow speech
- Short answers
- Debate answers

For each audio sample, store:

```json
{
  "expected_text": "The design is very subtle",
  "known_errors": [
    {
      "word": "design",
      "error": "pronounced like degien"
    }
  ],
  "human_score": 55,
  "notes": "Z sound missing or distorted"
}
```

No pronunciation system should be considered production-ready until it performs well on this dataset.

## 12. What To Do Next

Recommended immediate sequence:

1. Stop treating transcript match as pronunciation success.
2. Refactor response shape into transcription, fluency, pronunciation, and communication sections.
3. Remove prototype MFA scoring from the main result or mark it debug-only.
4. Add a pronunciation provider interface.
5. Integrate one real pronunciation provider.
6. Build an evaluation dataset with 30-50 known recordings.
7. Add student/session persistence.
8. Build practice mode cleanly.
9. Then build 1v1 battles.
10. Then build automated debates.

## 13. Phase-by-Phase Working Plan For This Repo

### Next Work Session: Phase 0A

Tasks:

- Clean `routes.py`.
- Remove misleading phoneme heuristics from production response.
- Keep transcript, words, clarity, and pace.
- Add honest `pronunciation.available = false` when no real provider exists.
- Create clean schemas for analysis response.

### Phase 0B

Tasks:

- Split audio preprocessing, ASR, fluency, and pronunciation into separate modules.
- Move frontend calls to the new response shape.
- Remove hardcoded MFA paths from normal flow.
- Keep MFA only as an optional debug experiment.

### Phase 1A

Tasks:

- Add tests.
- Add sample audio fixtures if possible.
- Add API contract tests.
- Add logging around each stage.

### Phase 1B

Tasks:

- Persist attempts and analysis results.
- Add attempt ids.
- Add a simple history endpoint.

### Phase 2A

Tasks:

- Choose pronunciation provider.
- Implement provider interface.
- Return word-level and phoneme-level feedback.

### Phase 2B

Tasks:

- Build evaluation dataset.
- Compare provider output against human-labeled examples.
- Calibrate thresholds.

### Phase 3A

Tasks:

- Add fluency scoring.
- Add filler-word detection.
- Add pause analysis.

### Phase 3B

Tasks:

- Add communication rubric scoring.
- Add prompt-specific feedback.

### Phase 4A

Tasks:

- Build practice sessions.
- Save attempts.
- Show improvement over time.

### Phase 4B

Tasks:

- Build 1v1 battle sessions.
- Add round state and scoring rules.

### Phase 4C

Tasks:

- Build automated debate mode.
- Add AI opponent and rubric-based round feedback.

## 14. Guiding Rule

Do not let the transcript become the source of truth for pronunciation.

The transcript says what the model thinks the student meant.

Pronunciation assessment must evaluate what the student actually sounded like.
