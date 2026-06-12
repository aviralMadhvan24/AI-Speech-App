import pytest
from app.fluency.service import FluencyService
from app.rubrics.service import RubricService
from app.battles.scoring import evaluate_battle_winner, calculate_battle_score
from app.sessions.debate_flow import DebateFlow, DebateRoundType

def test_fluency_service():
    service = FluencyService()
    
    # Mock Whisper transcript output
    mock_transcript = {
        "text": "The design is like very subtle um you know",
        "words": [
            {"word": "The", "start": 0.0, "end": 0.2},
            {"word": "design", "start": 0.2, "end": 0.7},
            {"word": "is", "start": 0.7, "end": 0.9},
            {"word": "like", "start": 0.9, "end": 1.2},  # Filler
            {"word": "very", "start": 3.0, "end": 3.5},  # Long pause before this
            {"word": "subtle", "start": 3.5, "end": 4.0},
            {"word": "um", "start": 4.0, "end": 4.5},    # Filler
            {"word": "subtle", "start": 4.5, "end": 5.0} # Repetition (different context, but simulating matching previous word)
        ]
    }
    
    # Analyze with a total audio duration of 6.0 seconds
    result = service.analyze_fluency(mock_transcript, total_duration_seconds=6.0)
    
    # 8 words in 6 seconds (0.1 minutes) -> 8 / 0.1 = 80 WPM
    assert result["words_per_minute"] == 80
    assert result["filler_word_count"] == 2 # "like", "um"
    assert result["long_pause_count"] == 1  # between "like" and "very"
    assert result["speech_duration_seconds"] == 5.0 # 5.0 - 0.0
    assert "score" in result

def test_rubric_service():
    service = RubricService()
    
    # Test valid transcript
    result = service.evaluate_communication("Fake transcript", "AI in education")
    assert result["available"] is True
    assert result["rubric_version"] == "v1"
    assert "clarity" in result["criteria"]
    
    # Test empty transcript
    empty_result = service.evaluate_communication("", "AI in education")
    assert empty_result["overall_score"] == 0

def test_battle_scoring():
    player_1 = {
        "pronunciation_score": 80,
        "fluency_score": 90,
        "relevance_score": 70,
        "argument_quality": 85,
        "time_discipline": 100,
        "rebuttal_strength": 60
    }
    
    player_2 = {
        "pronunciation_score": 70,
        "fluency_score": 75,
        "relevance_score": 90,
        "argument_quality": 90,
        "time_discipline": 80,
        "rebuttal_strength": 90
    }
    
    result = evaluate_battle_winner(player_1, player_2)
    assert "winner" in result
    assert result["player1_score"] > 0
    assert result["player2_score"] > 0

def test_debate_flow():
    flow = DebateFlow("Is AI good for students?")
    
    assert not flow.is_complete()
    assert flow.get_current_round() == DebateRoundType.OPENING
    
    # Simulate completely running through rounds
    for _ in range(4):
        flow.advance_round({"mock_audio": "audio.wav", "speaker": "student"})
        
    assert flow.is_complete()
    assert flow.get_summary()["is_complete"] is True
    assert len(flow.get_summary()["history"]) == 4
