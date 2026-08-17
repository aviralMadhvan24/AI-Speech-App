"""Regression tests for Interview Studio speech-result handling."""

from __future__ import annotations

from app.interview.routes import _summarize_pronunciation
from app.schemas.pronunciation_schema import PhonemeError
from app.schemas.pronunciation_schema import PronunciationResult
from app.storage.submissions import ContentScoreSnapshot
from app.storage.submissions import SubmissionsStore


def test_pronunciation_summary_exposes_score_and_issue_count():
    result = PronunciationResult(
        available=True,
        provider="hf_phoneme",
        overall_score=78.5,
        phoneme_errors=[PhonemeError(type="substitution", message="practice")],
    )

    summary = _summarize_pronunciation(result)

    assert summary.available is True
    assert summary.score == 78.5
    assert summary.provider == "hf_phoneme"
    assert summary.issue_count == 1


def test_submission_persists_content_and_pronunciation(tmp_path):
    store = SubmissionsStore(tmp_path / "interviews.jsonl")
    content = ContentScoreSnapshot(
        relevance=20,
        total=75,
        available=True,
        transcript="I led a project and improved its delivery time.",
        pronunciation={
            "available": True,
            "score": 82.0,
            "provider": "hf_phoneme",
            "feedback": "Mostly clear pronunciation.",
            "issue_count": 2,
        },
    )

    saved = store.create(
        student_email="student@kiet.edu",
        student_uid="student-1",
        student_name="Student",
        question_id="q-strength",
        question_prompt="Tell me about a project.",
        question_category="behavioural",
        gesture_session_id="gesture-1",
        gesture_score=80,
        gesture_metrics=[],
        content_result=content.model_dump(),
        duration_seconds=42,
    )

    restored = store.get(saved.submission_id)
    assert restored is not None
    assert restored.content_result is not None
    assert restored.content_result.total == 75
    assert restored.content_result.pronunciation.score == 82.0
