import { useCallback, useRef, useState } from 'react';
import { PASSAGES } from './data/passages.js';
import { useSpeechRecognition } from './hooks/useSpeechRecognition.js';
import { useWpm } from './hooks/useWpm.js';
import { usePassageMatch } from './hooks/usePassageMatch.js';
import PassagePicker from './components/PassagePicker.jsx';
import ReadingPanel from './components/ReadingPanel.jsx';
import Speedometer from './components/Speedometer.jsx';
import ZoneIndicator from './components/ZoneIndicator.jsx';
import Controls from './components/Controls.jsx';
import Stats from './components/Stats.jsx';

export default function App() {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');

  const passageText = selectedIndex !== null ? PASSAGES[selectedIndex].text : '';
  const { tokens, statuses, matchedCount, progressPct, accuracyPct, wrongCount, advance, reset: resetMatch } =
    usePassageMatch(passageText);

  // addWords/advance are accessed through refs so the speech callback never
  // goes stale even though it is created before the hooks below.
  const addWordsRef = useRef(null);
  const advanceRef = useRef(null);
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;
  advanceRef.current = advance;

  const handleResult = useCallback(({ newWords, interim: interimText }) => {
    if (newWords.length > 0) {
      addWordsRef.current?.(newWords);
      if (selectedRef.current !== null) advanceRef.current?.(newWords);
      setTranscript((prev) => `${prev}${newWords.join(' ')} `);
    }
    setInterim(interimText);
  }, []);

  const { isSupported, isListening, error, start, stop } = useSpeechRecognition({ onResult: handleResult });
  const { currentWpm, totalWords, elapsedSecs, avgWpm, addWords, reset: resetWpm } = useWpm(isListening);
  addWordsRef.current = addWords;

  // While speaking, the needle tracks live pace. When stopped, it rests on the
  // session average so you can see your overall words-per-minute.
  const displayWpm = isListening ? currentWpm : avgWpm;

  const clearSession = useCallback(() => {
    resetWpm();
    resetMatch();
    setTranscript('');
    setInterim('');
  }, [resetWpm, resetMatch]);

  const handleSelect = (idx) => {
    if (isListening) stop();
    setSelectedIndex(idx);
    clearSession();
  };

  const handleToggle = () => {
    if (isListening) stop();
    else start();
  };

  const handleReset = () => {
    if (isListening) stop();
    clearSession();
  };

  return (
    <div className="app">
      <h1>Voice CruiseControl</h1>
      <p className="subtitle">Pick a paragraph, read it aloud, watch your pace come alive</p>

      <div className="card">
        <div className="panel-title">Choose a paragraph</div>
        <PassagePicker passages={PASSAGES} selectedIndex={selectedIndex} onSelect={handleSelect} />
      </div>

      <div className="main-row">
        <div className="card reading-card">
          <div className="panel-title">Read aloud</div>
          <ReadingPanel
            tokens={tokens}
            statuses={statuses}
            matchedCount={matchedCount}
            progressPct={progressPct}
            passageKey={selectedIndex}
          />
        </div>

        <div className="card hero">
          <Speedometer wpm={displayWpm} isAverage={!isListening && avgWpm > 0} />
          <ZoneIndicator wpm={displayWpm} />
          <Controls
            isListening={isListening}
            canStart={isSupported && selectedIndex !== null}
            onToggle={handleToggle}
            onReset={handleReset}
          />
        </div>
      </div>

      <Stats totalWords={totalWords} elapsedSecs={elapsedSecs} avgWpm={avgWpm} accuracyPct={accuracyPct} />

      <div className="transcript" aria-live="polite">
        {transcript || interim ? (
          <>
            {transcript}
            <span className="interim">{interim}</span>
          </>
        ) : (
          <span className="transcript-placeholder">Your speech will appear here...</span>
        )}
      </div>

      {error && <div className="no-support">{error}</div>}

      {!isSupported && (
        <div className="no-support">
          Your browser does not support the Web Speech API. Please use Chrome, Edge, or Safari.
        </div>
      )}
    </div>
  );
}
