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
const phonemesList = document.querySelector("#phonemesList");
const waveCanvas = document.querySelector("#waveCanvas");
const modeButtons = document.querySelectorAll(".mode-button");

const backendHost = window.location.hostname || "127.0.0.1";
const API_BASE_URL = window.location.port === "8000"
  ? window.location.origin
  : `http://${backendHost}:8000`;

let prompts = [];
let selectedMode = "battle";
let recordedBlob = null;
let mediaRecorder = null;
let recordedChunks = [];

function apiUrl(path) {
  return new URL(path, `${API_BASE_URL}/`).toString();
}

function setStatus(message) {
  statusText.textContent = message;
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  if (!contentType.includes("application/json")) {
    const summary = body.replace(/\s+/g, " ").trim().slice(0, 160);

    throw new Error(
      `Server returned ${response.status} ${response.statusText}` +
      (summary ? `: ${summary}` : "")
    );
  }

  let data;

  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`Server returned invalid JSON with status ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(data.detail || `Request failed with status ${response.status}`);
  }

  return data;
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
  const response = await fetch(apiUrl("/battle/prompts"));
  prompts = await readJsonResponse(response);

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

  const startedAt = Date.now();
  setStatus("Preparing audio...");
  analyzeButton.disabled = true;
  const progressTimer = window.setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const firstRunHint = elapsedSeconds >= 10
      ? " The first run may take longer while the speech model loads."
      : "";
    setStatus(`Analyzing audio... ${elapsedSeconds}s.${firstRunHint}`);
  }, 1000);

  try {
    const response = await fetch(apiUrl("/analyze"), {
      method: "POST",
      body: formData
    });

    const result = await readJsonResponse(response);
    renderResult(result);
    setStatus("Complete");
  } catch (error) {
    const message = error instanceof TypeError
      ? `Cannot reach the API at ${API_BASE_URL}. Start the FastAPI server first.`
      : error.message;
    setStatus(message);
  } finally {
    window.clearInterval(progressTimer);
    analyzeButton.disabled = false;
  }
}

function renderResult(result) {
  pronunciationScore.textContent = formatScore(result.pronunciation_score, "%");
  clarityScore.textContent = formatScore(result.clarity_score, "%");
  paceScore.textContent = formatScore(result.pace_wpm);
  transcriptText.textContent = result.transcript || "No transcript returned.";

  mistakesList.innerHTML = "";
  wordsList.innerHTML = "";
  phonemesList.innerHTML = "";

  if (!result.mistakes.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No mistakes found.";
    mistakesList.appendChild(empty);
  }

  result.mistakes.forEach((mistake) => {
    const item = document.createElement("div");
    item.className = "mistake-item";
    item.innerHTML = `
      <div>
        <strong>${mistake.expected_word} -> ${mistake.heard_word || "missing"}</strong>
        <p>${mistake.feedback}</p>
      </div>
      <span class="pill">Check</span>
    `;
    mistakesList.appendChild(item);
  });

  const wordScores = result.word_scores && result.word_scores.length
    ? result.word_scores
    : result.words.map((word) => ({
      word: word.word,
      heard_word: word.word,
      score: word.probability * 100,
      confidence_score: word.probability * 100,
      expected_phonemes: [],
      feedback: `${word.start.toFixed(2)}s - ${word.end.toFixed(2)}s`
    }));

  wordScores.forEach((wordScore) => {
    const item = document.createElement("div");
    item.className = "word-item";
    const phonemes = wordScore.expected_phonemes && wordScore.expected_phonemes.length
      ? wordScore.expected_phonemes.join(" ")
      : "No phoneme data";

    item.innerHTML = `
      <div>
        <strong>${wordScore.word} -> ${wordScore.heard_word || "missing"}</strong>
        <span>${phonemes}</span>
        <p>${wordScore.feedback}</p>
      </div>
      <span class="pill">${Math.round(wordScore.score)}%</span>
    `;
    wordsList.appendChild(item);
  });

  if (!result.phoneme_timeline || !result.phoneme_timeline.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = result.mfa_available
      ? "No phoneme timings returned."
      : "MFA not available yet. Install MFA models to enable phoneme timing.";
    phonemesList.appendChild(empty);
    return;
  }

  result.phoneme_timeline.forEach((phoneme) => {
    const item = document.createElement("div");
    item.className = "phoneme-item";
    item.innerHTML = `
      <strong>${phoneme.phoneme}</strong>
      <span>${phoneme.start.toFixed(2)}s - ${phoneme.end.toFixed(2)}s</span>
    `;
    phonemesList.appendChild(item);
  });
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

loadPrompts().catch((error) => {
  const message = error instanceof TypeError
    ? `Cannot reach the API at ${API_BASE_URL}. Start the FastAPI server first.`
    : error.message;
  setStatus(message);
});
drawWave();
