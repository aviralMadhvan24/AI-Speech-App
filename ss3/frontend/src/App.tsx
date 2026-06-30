import { useState } from 'react';
import type { ViewName } from './types';
import Header from './components/Header';
import HomeView from './components/HomeView';
import RecordingView from './components/RecordingView';
import ProcessingView from './components/ProcessingView';
import ReportView from './components/ReportView';

export default function App() {
  const [view, setView] = useState<ViewName>('home');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  function goHome() {
    setActiveSessionId(null);
    setView('home');
  }

  function goRecord() {
    setView('recording');
  }

  function goProcessing(sessionId: string) {
    setActiveSessionId(sessionId);
    setView('processing');
  }

  function goReport(sessionId: string) {
    setActiveSessionId(sessionId);
    setView('report');
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header onHome={goHome} />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        <div key={view}>
          {view === 'home' && (
            <HomeView onNewRecording={goRecord} onSelectSession={goReport} />
          )}
          {view === 'recording' && (
            <RecordingView onUploaded={goProcessing} onCancel={goHome} />
          )}
          {view === 'processing' && activeSessionId && (
            <ProcessingView
              sessionId={activeSessionId}
              onCompleted={goReport}
              onFailed={goHome}
            />
          )}
          {view === 'report' && activeSessionId && (
            <ReportView
              sessionId={activeSessionId}
              onNewRecording={goRecord}
              onHome={goHome}
            />
          )}
        </div>
      </main>
      <footer className="text-center text-xs text-zinc-600 py-6 border-t border-zinc-900/60">
        Local-only · Phase 1 · Body Language Analyzer
      </footer>
    </div>
  );
}
