from enum import Enum
from typing import List, Dict, Any, Optional

class DebateRoundType(Enum):
    OPENING = "opening"
    RESPONSE = "response"
    REBUTTAL = "rebuttal"
    CLOSING = "closing"

class DebateFlow:
    """
    Manages the lifecycle and state of a single debate session.
    A debate has defined round flows: Opening, Response, Rebuttal, Closing.
    """
    def __init__(self, topic: str):
        self.topic = topic
        self.rounds = [
            DebateRoundType.OPENING,
            DebateRoundType.RESPONSE,
            DebateRoundType.REBUTTAL,
            DebateRoundType.CLOSING
        ]
        self.current_round_index = 0
        self.transcripts: List[Dict[str, Any]] = []

    def get_current_round(self) -> Optional[DebateRoundType]:
        if self.current_round_index < len(self.rounds):
            return self.rounds[self.current_round_index]
        return None

    def advance_round(self, round_data: Dict[str, Any]):
        """
        Record the round output and advance to the next debate stage.
        `round_data` should include transcripts, scores, and speaker info.
        """
        self.transcripts.append({
            "round_type": self.get_current_round().value if self.get_current_round() else "finished",
            "data": round_data
        })
        self.current_round_index += 1
        
    def is_complete(self) -> bool:
        """
        Check if the debate round has completed all stages.
        """
        return self.current_round_index >= len(self.rounds)

    def get_summary(self) -> Dict[str, Any]:
        """
        Generates a summary of all rounds completed in the debate.
        """
        return {
            "topic": self.topic,
            "is_complete": self.is_complete(),
            "current_round": self.get_current_round().value if self.get_current_round() else "finished",
            "history": self.transcripts
        }
