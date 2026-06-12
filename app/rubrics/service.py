from typing import Dict, Any, Optional

class RubricService:
    def __init__(self):
        # We start with version 1 of our communication rubric
        self.rubric_version = "v1"

    def evaluate_communication(self, transcript_text: str, expected_topic: Optional[str] = None) -> Dict[str, Any]:
        """
        Evaluates the communication quality based on transcript content and an expected topic.
        In the future, this should integrate with an LLM to dynamically score content.
        For now, this provides a structured mock response demonstrating the communication contract.
        """
        if not transcript_text or len(transcript_text.strip()) == 0:
            return self._empty_communication_result()

        # Placeholders for LLM rubric evaluation outputs
        # Each criteria handles a specific aspect of the communication standard
        
        return {
            "available": True,
            "rubric_version": self.rubric_version,
            "overall_score": 74,
            "criteria": {
                "clarity": {
                    "score": 8,
                    "feedback": "The points were generally clear, though some phrasing could be sharpened."
                },
                "structure": {
                    "score": 7,
                    "feedback": "Clear opening, but the conclusion needs work."
                },
                "relevance": {
                    "score": 8,
                    "feedback": "Stayed on topic well and addressed the prompt directly."
                },
                "evidence": {
                    "score": 6,
                    "feedback": "The answer used opinions but lacked concrete examples."
                },
                "confidence": {
                    "score": 7,
                    "feedback": "Tone was adequate but could be more decisive."
                },
                "rebuttal": {
                    "score": 0,
                    "feedback": "No rebuttal was present in this response."
                }
            }
        }

    def _empty_communication_result(self) -> Dict[str, Any]:
        return {
            "available": True,
            "rubric_version": self.rubric_version,
            "overall_score": 0,
            "criteria": {
                "clarity": {"score": 0, "feedback": "No speech detected."},
                "structure": {"score": 0, "feedback": "No speech detected."},
                "relevance": {"score": 0, "feedback": "No speech detected."},
                "evidence": {"score": 0, "feedback": "No speech detected."},
                "confidence": {"score": 0, "feedback": "No speech detected."},
                "rebuttal": {"score": 0, "feedback": "No speech detected."}
            }
        }
