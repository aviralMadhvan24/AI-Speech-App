const promptSelect = document.querySelector("#promptSelect");
const expectedText = document.querySelector("#expectedText");
const focusWord = document.querySelector("#focusWord");
const difficulty = document.querySelector("#difficulty");
const hint = document.querySelector("#hint");
const audioFile = document.querySelector("#audioFile");
const previewAudio = document.querySelector("#previewAudio");
const recordButton = document.querySelector("#recordButton");
const stopButton = document.querySelector("#stopButton");
const analyzeButton = document.querySelector("#analyzeButton");
const statusText = document.querySelector("#statusText");
const pronunciationScore = document.querySelector("#pronunciationScore");
const clarityScore = document.querySelector("#clarityScore");
const paceScore = document.querySelector("#paceScore");
const transcriptText = document.querySelector("#transcriptText");
const mistakesList = document.querySelector("#mistakesList");
const wordsList = document.querySelector("#wordsList");
const providerInfo = document.querySelector("#providerInfo");
const attemptsList = document.querySelector("#attemptsList");
const refreshAttempts = document.querySelector("#refreshAttempts");
const waveCanvas = document.querySelector("#waveCanvas");
const modeButtons = document.querySelectorAll(".mode-button");

let prompts = [];
let selectedMode = "battle";
let recordedBlob = null;
let mediaRecorder = null;
let recordedChunks = [];

function setStatus(message) {
  statusText.textContent = message;
}

function formatScore(value, suffix = "") {
  if (value === null || value === undefined) {
    return "--";
  }

  return `${Math.round(value)}${suffix}`;
}

function updatePromptMeta(prompt) {
  expectedText.value = prompt.text;
  focusWord.textContent = prompt.focus_word;
  difficulty.textContent = prompt.difficulty;
  hint.textContent = prompt.hint;
}

async function loadPrompts() {
  const response = await fetch("/battle/prompts");
  prompts = await response.json();

  promptSelect.innerHTML = "";

  prompts.forEach((prompt) => {
    const option = document.createElement("option");
    option.value = prompt.id;
    option.textContent = prompt.text;
    promptSelect.appendChild(option);
  });

  if (prompts.length) {
    updatePromptMeta(prompts[0]);
  }
}

function setMode(mode) {
  selectedMode = mode;
  document.body.classList.toggle("live-mode", mode === "live");

  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
}

function getSelectedAudio() {
  if (recordedBlob) {
    return {
      blob: recordedBlob,
      filename: "recording.webm"
    };
  }

  if (audioFile.files.length) {
    return {
      blob: audioFile.files[0],
      filename: audioFile.files[0].name
    };
  }

  return null;
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  });

  mediaRecorder.addEventListener("stop", () => {
    recordedBlob = new Blob(recordedChunks, { type: "audio/webm" });
    previewAudio.src = URL.createObjectURL(recordedBlob);
    stream.getTracks().forEach((track) => track.stop());
    setStatus("Recording ready");
  });

  mediaRecorder.start();
  recordButton.disabled = true;
  stopButton.disabled = false;
  setStatus("Recording");
}

function stopRecording() {
  if (!mediaRecorder) {
    return;
  }

  mediaRecorder.stop();
  recordButton.disabled = false;
  stopButton.disabled = true;
}

async function analyzeAudio() {
  const audio = getSelectedAudio();

  if (!audio) {
    setStatus("Choose or record audio");
    return;
  }

  const formData = new FormData();
  formData.append("file", audio.blob, audio.filename);

  if (selectedMode === "battle" && expectedText.value.trim()) {
    formData.append("expected_text", expectedText.value.trim());
  }

  setStatus("Analyzing");
  analyzeButton.disabled = true;

  try {
    const response = await fetch("/analyze", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Analysis failed");
    }

    const result = await response.json();
    renderResult(result);
    setStatus("Complete");
    loadAttempts().catch(() => {});
  } catch (error) {
    setStatus(error.message);
  } finally {
    analyzeButton.disabled = false;
  }
}

function renderResult(result) {
  const pronunciation = result.pronunciation || {};
  const fluency = result.fluency || {};
  const transcription = result.transcription || {};
  const debug = result.debug || {};
  const transcriptMatchScore = debug.transcript_match_score;

  pronunciationScore.textContent = pronunciation.available
    ? formatScore(pronunciation.overall_score, "%")
    : "--";
  clarityScore.textContent = formatScore(fluency.clarity_score, "%");
  paceScore.textContent = formatScore(fluency.words_per_minute);
  transcriptText.textContent = transcription.text || transcription.normalized_text || "";

  mistakesList.innerHTML = "";
  wordsList.innerHTML = "";

  renderProviderInfo(result);

  const transcriptMistakes = debug.transcript_mistakes || [];
  const phonemeErrors = pronunciation.phoneme_errors || [];

  if (!transcriptMistakes.length && !phonemeErrors.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = transcriptMatchScore === null || transcriptMatchScore === undefined
      ? "Add expected text to check transcript mismatch."
      : "Transcript matches expected text.";
    mistakesList.appendChild(empty);
  }

  transcriptMistakes.forEach((mistake) => {
    const item = document.createElement("div");
    item.className = "mistake-item";
    item.innerHTML = `
      <div>
        <strong>${mistake.expected_word} -> ${mistake.heard_word || "missing"}</strong>
        <p>Transcript: ${mistake.feedback}</p>
      </div>
      <span class="pill">Text</span>
    `;
    mistakesList.appendChild(item);
  });

  phonemeErrors.forEach((error) => {
    const item = document.createElement("div");
    item.className = "mistake-item";
    const wordLabel = error.word ? `${error.word}: ` : "";
    const expectedObserved = error.expected || error.observed
      ? `<p>Expected: ${error.expected || "—"} → Heard: ${error.observed || "—"}</p>`
      : "";
    item.innerHTML = `
      <div>
        <strong>${wordLabel}${error.message}</strong>
        ${expectedObserved}
      </div>
      <span class="pill">Phoneme</span>
    `;
    mistakesList.appendChild(item);
  });

  if (pronunciation.available) {
    const words = pronunciation.words || [];
    words.forEach((wordScore) => {
      const item = document.createElement("div");
      item.className = "word-item";

      const expected = wordScore.expected_phonemes && wordScore.expected_phonemes.length
        ? wordScore.expected_phonemes.join(" ")
        : "";
      const heard = wordScore.observed_phonemes && wordScore.observed_phonemes.length
        ? wordScore.observed_phonemes.join(" ")
        : "";

      const phonemeLine = expected || heard
        ? `<span>Expected: ${expected || "—"}</span>
           <span>Heard: ${heard || "—"}</span>`
        : `<span>ASR word</span>`;

      item.innerHTML = `
        <div>
          <strong>${wordScore.word}</strong>
          ${phonemeLine}
          <p>${wordScore.feedback || ""}</p>
        </div>
        <span class="pill">${formatScore(wordScore.score, "%")}</span>
      `;
      wordsList.appendChild(item);
    });
  } else {
    const words = transcription.words || [];
    words.forEach((word) => {
      const item = document.createElement("div");
      item.className = "word-item";
      item.innerHTML = `
        <div>
          <strong>${word.word}</strong>
          <span>ASR word</span>
          <p>${word.start.toFixed(2)}s - ${word.end.toFixed(2)}s</p>
        </div>
        <span class="pill">--</span>
      `;
      wordsList.appendChild(item);
    });
  }
}

function renderProviderInfo(result) {
  const pronunciation = result.pronunciation || {};
  const communication = result.communication || {};
  const transcription = result.transcription || {};
  const audio = result.audio || {};

  providerInfo.innerHTML = "";

  const rows = [
    {
      label: "Pronunciation",
      status: pronunciation.available ? "available" : "unavailable",
      value: pronunciation.available
        ? `${pronunciation.provider || "unknown"} provider`
        : "Not configured",
      detail: pronunciation.message || ""
    },
    {
      label: "Transcription",
      status: "available",
      value: `${transcription.provider || "whisper"} (${transcription.model || "small"})`,
      detail: `Language: ${transcription.language || "en"}`
    },
    {
      label: "Communication",
      status: communication.available ? "available" : "unavailable",
      value: communication.available
        ? `${communication.rubric_version || "rubric"}`
        : "Not configured",
      detail: communication.message || ""
    },
    {
      label: "Audio",
      status: "available",
      value: audio.duration_seconds
        ? `${audio.duration_seconds.toFixed(2)}s @ ${audio.sample_rate || "?"} Hz`
        : "processed",
      detail: audio.processed_path || ""
    }
  ];

  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = `provider-row provider-${row.status}`;
    item.innerHTML = `
      <div>
        <strong>${row.label}</strong>
        <span>${row.value}</span>
        ${row.detail ? `<p>${row.detail}</p>` : ""}
      </div>
      <span class="pill provider-status-pill">${row.status}</span>
    `;
    providerInfo.appendChild(item);
  });
}

function renderAttempts(attempts) {
  attemptsList.innerHTML = "";

  if (!attempts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No attempts yet. Record or upload audio to start.";
    attemptsList.appendChild(empty);
    return;
  }

  attempts.forEach((attempt) => {
    const item = document.createElement("div");
    item.className = "attempt-item";

    const created = new Date(attempt.created_at);
    const timeLabel = isNaN(created.getTime())
      ? attempt.created_at
      : created.toLocaleString();

    const pronScore = attempt.pronunciation_available && attempt.pronunciation_score !== null
      ? `${Math.round(attempt.pronunciation_score)}%`
      : "—";
    const clarity = attempt.clarity_score !== null && attempt.clarity_score !== undefined
      ? `${Math.round(attempt.clarity_score)}%`
      : "—";
    const pace = attempt.pace_wpm
      ? `${Math.round(attempt.pace_wpm)} wpm`
      : "—";

    item.innerHTML = `
      <div class="attempt-main">
        <strong>${attempt.expected_text || "(no prompt)"}</strong>
        <p class="attempt-heard">Heard: ${attempt.transcript || "—"}</p>
        <p class="attempt-meta">${timeLabel} · ${attempt.pronunciation_provider || "no provider"} · ${attempt.mistakes_count} mismatch${attempt.mistakes_count === 1 ? "" : "es"}</p>
      </div>
      <div class="attempt-scores">
        <span class="pill">Pron ${pronScore}</span>
        <span class="pill">Clarity ${clarity}</span>
        <span class="pill">${pace}</span>
      </div>
    `;
    attemptsList.appendChild(item);
  });
}

async function loadAttempts() {
  try {
    const response = await fetch("/attempts?limit=10");

    if (!response.ok) {
      throw new Error(`Failed to load attempts (${response.status})`);
    }

    const data = await response.json();
    renderAttempts(data.attempts || []);
  } catch (error) {
    attemptsList.innerHTML = "";
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = error.message;
    attemptsList.appendChild(message);
  }
}

function drawWave() {
  const context = waveCanvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = waveCanvas.clientWidth;
  const height = waveCanvas.clientHeight;

  waveCanvas.width = width * ratio;
  waveCanvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const bars = 82;
  const gap = 5;
  const barWidth = Math.max(3, (width - bars * gap) / bars);
  const time = Date.now() / 420;

  for (let index = 0; index < bars; index += 1) {
    const wave = Math.sin(index * 0.34 + time) * 0.5 + 0.5;
    const pulse = Math.sin(index * 0.11 - time * 0.75) * 0.5 + 0.5;
    const barHeight = 18 + wave * 74 + pulse * 34;
    const x = index * (barWidth + gap);
    const y = (height - barHeight) / 2;

    context.fillStyle = index % 3 === 0 ? "#37c5a0" : index % 3 === 1 ? "#f1b44b" : "#e7685d";
    context.fillRect(x, y, barWidth, barHeight);
  }

  requestAnimationFrame(drawWave);
}

promptSelect.addEventListener("change", () => {
  const prompt = prompts.find((item) => item.id === promptSelect.value);

  if (prompt) {
    updatePromptMeta(prompt);
  }
});

audioFile.addEventListener("change", () => {
  recordedBlob = null;

  if (audioFile.files.length) {
    previewAudio.src = URL.createObjectURL(audioFile.files[0]);
    setStatus("File ready");
  }
});

recordButton.addEventListener("click", startRecording);
stopButton.addEventListener("click", stopRecording);
analyzeButton.addEventListener("click", analyzeAudio);

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

if (refreshAttempts) {
  refreshAttempts.addEventListener("click", () => loadAttempts());
}

loadPrompts().catch((error) => setStatus(error.message));
loadAttempts().catch(() => {});
drawWave();
