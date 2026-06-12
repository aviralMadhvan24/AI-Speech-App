from typing import Dict, Any, List

class FluencyService:
    # Common filler words
    FILLER_WORDS = {"um", "uh", "like", "you know", "actually", "basically", "so", "well"}

    def __init__(self):
        pass

    def analyze_fluency(self, transcript_data: Dict[str, Any], total_duration_seconds: float) -> Dict[str, Any]:
        """
        Analyzes a Whisper-style transcript with word timestamps and calculates fluency metrics.
        """
        words = transcript_data.get("words", [])
        
        if not words:
            return self._empty_fluency_result(total_duration_seconds)
            
        word_count = len(words)
        # Calculate speech duration as the time from the start of the first word to the end of the last word
        speech_duration_seconds = words[-1]["end"] - words[0]["start"] if words else 0.0
        
        # Calculate WPM
        minutes = total_duration_seconds / 60.0
        wpm = int(word_count / minutes) if minutes > 0 else 0
        
        # Pauses & Silence
        long_pause_count = 0
        filler_word_count = 0
        repetition_count = 0
        
        last_end = 0.0
        for i, w in enumerate(words):
            word_text = w.get("word", "").lower().strip()
            # Remove basic punctuation for matching
            for p in [",", ".", "!", "?", ";"]:
                word_text = word_text.replace(p, "")

            start = w.get("start", 0.0)
            end = w.get("end", 0.0)
            
            # Check pause
            if i > 0:
                pause = start - last_end
                if pause > 1.0: # 1 second is arbitrary long pause threshold
                    long_pause_count += 1
            
            # Check filler
            if word_text in self.FILLER_WORDS:
                filler_word_count += 1
                
            # Check repetition
            if i > 0:
                prev_word_text = words[i-1].get("word", "").lower().strip()
                for p in [",", ".", "!", "?", ";"]:
                    prev_word_text = prev_word_text.replace(p, "")
                    
                if word_text == prev_word_text and word_text != "":
                    repetition_count += 1
                
            last_end = end
            
        silence_ratio = (total_duration_seconds - speech_duration_seconds) / total_duration_seconds if total_duration_seconds > 0 else 0.0
        
        # Basic score heuristic (out of 100)
        score = 100
        score -= (long_pause_count * 5)
        score -= (filler_word_count * 2)
        score -= (repetition_count * 3)
        # Penalize too fast or too slow (ideal 130-160 WPM)
        if wpm < 110:
            score -= min(20, (110 - wpm))
        elif wpm > 180:
            score -= min(20, (wpm - 180))
            
        score = max(0, min(100, int(score)))

        return {
            "words_per_minute": wpm,
            "speech_duration_seconds": round(speech_duration_seconds, 2),
            "total_duration_seconds": round(total_duration_seconds, 2),
            "silence_ratio": round(silence_ratio, 2),
            "long_pause_count": long_pause_count,
            "filler_word_count": filler_word_count,
            "repetition_count": repetition_count,
            "score": score
        }
        
    def _empty_fluency_result(self, total_duration_seconds: float) -> Dict[str, Any]:
        return {
            "words_per_minute": 0,
            "speech_duration_seconds": 0.0,
            "total_duration_seconds": round(total_duration_seconds, 2),
            "silence_ratio": 1.0,
            "long_pause_count": 0,
            "filler_word_count": 0,
            "repetition_count": 0,
            "score": 0
        }
