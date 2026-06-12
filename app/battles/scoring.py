from typing import Dict, Any

def calculate_battle_score(player_data: Dict[str, Any]) -> int:
    """
    Calculates a 1v1 battle score based on pronunciation, fluency, relevance, 
    argument quality, time discipline, and rebuttal strength.
    
    According to the TEAM_SPLIT.md Phase 4B rules, we avoid making pronunciation 
    the only battle score.
    """
    
    # Extract sub-scores (assuming out of 100 for each)
    pronunciation = player_data.get("pronunciation_score", 0)
    fluency = player_data.get("fluency_score", 0)
    relevance = player_data.get("relevance_score", 0)
    argument = player_data.get("argument_quality", 0)
    time_discipline = player_data.get("time_discipline", 0)
    rebuttal = player_data.get("rebuttal_strength", 0)
    
    # Weighted Scoring Formula (Sum of weights = 1.0)
    weighted_score = (
        (pronunciation * 0.20) +
        (fluency * 0.20) +
        (relevance * 0.15) +
        (argument * 0.20) +
        (time_discipline * 0.10) +
        (rebuttal * 0.15)
    )
    
    return int(weighted_score)

def evaluate_battle_winner(player1_data: Dict[str, Any], player2_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Evaluates the complete state of a 1v1 battle and determines the winner.
    """
    p1_score = calculate_battle_score(player1_data)
    p2_score = calculate_battle_score(player2_data)
    
    winner = "tie"
    if p1_score > p2_score:
        winner = "player1"
    elif p2_score > p1_score:
        winner = "player2"
        
    return {
        "player1_score": p1_score,
        "player2_score": p2_score,
        "winner": winner,
        "margin": abs(p1_score - p2_score)
    }
