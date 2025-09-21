// ================== 基本設定 ==================
const API_BASE = "https://timeout-checklist-server.onrender.com"; // 你的 Render 後端

// 狀態列（若 index.html 沒有 #status，就動態建立一個）
const statusEl = document.getElementById('status') || (() => {
  const d = document.createElement('div');
  d.id = 'status';
  d.style.maxWidth = '950px';
  d.style.margin = '12px auto';
  d.style.color = '#666';
  d.style.fontSize = '0.95rem';
  document.body.appendChild(d);
  return d;
})();
function setStatus(msg) { statusEl.textContent = msg; }

// ================== Checklist（前端顯示需與後端一致） ==================
const checklist = [
  { title: "Timeout Initiation", items: [
    "Is everyone ready to begin the timeout?",
    "Do we have the consent form in front of us?"
  ]},
  { title: "Team Introduction", items: [
    "Please introduce yourselves.",
    "Is the attending physician present?",
    "Who is the anesthesia attending?",
    "What are the names and roles of the other team members?"
  ]},
  { title: "Patient Identification", items: [
    "What is your full name?",
    "What is your date of birth?",
    "What is your Medical Record Number?"
  ]},
  { title: "Surgical Consent Verification", items: [
    "Is the consent form signed?",
    "What surgery and/or block is being performed?",
    "Which side?",
    "Is it marked?"
  ]},
  { title: "Local Anesthetic Plan", items: [
    "Which local anesthetic will be used?",
    "What is the intended concentration?",
    "What is the intended volume?"
  ]},
  { title: "Patient Medical Considerations", items: [
    "Are you currently taking any anticoagulants?",
    "Do you have any clotting disorders?",
    "Do you have any known drug allergies?",
    "Do you have a history of systemic neuropathy and/or neuropathy at the surgical site?"
  ]},
  { title: "Monitoring System Check", items: [
    "Is NIBP monitoring ready?",
    "Is ECG monitoring ready?",
    "Is SpO₂ ready?",
    "Is EtCO₂ monitoring ready?"
  ]},
  { title: "Additional Concerns", items: [
    "Does anyone have any other question or concern?"
  ]},
  { title: "Timeout Completion", items: [
    "Timeout completed."
  ]}
];

// ================== 渲染 UI ==================
const checklistDiv = document.getElementById('checklist');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const exportLink = document.getElementById('exportLink');

const allSentences = checklist.flatMap(g => g.items);
const sentenceToIndex = new Map(allSentences.map((s, i) => [s, i]));

const itemRows = [];
checklist.forEach(group => {
  const groupDiv = document.createElement('div');
  groupDiv.className = 'group';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'group-title';
  titleDiv.textContent = group.title;
  groupDiv.appendChild(titleDiv);

  const ul = document.createElement('div');
  ul.className = 'item-list';

  group.items.forEach(text => {
    const row = document.createElement('div');
    row.className = 'item-row';

    const span = document.createElement('span');
    span.className = 'item-text';
    span.textContent = text;

    const dot = document.createElement('span');
    dot.className = 'red-dot';

    row.appendChild(span);
    row.appendChild(dot);
    ul.appendChild(row);

    itemRows.push(row);
  });

  groupDiv.appendChild(ul);
  checklistDiv.appendChild(groupDiv);
});

function setGreen(sentence){
  const idx = sentenceToIndex.get(sentence);
  if (idx == null) return;
  const dot = itemRows[idx].querySelector('.red-dot');
  dot.classList.add('green-dot');
}

// ================== Session & 錄音 ==================
let sessionId = null;
let mediaRecorder = null;
let listening = false;
let streamRef = null; // 保存 MediaStream 以便停止時關閉

async function newSession(){
  const res = await fetch(`${API_BASE}/start`, { method: "POST" });
  if (!res.ok) throw new Error(`Server /start failed: ${res.status}`);
  const data = await res.json();
  sessionId = data.session_id;
  exportLink.href = `${API_BASE}/export/${sessionId}`;
  exportLink.style.display = "none";
}

async function requestMicOnce() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const msg = "This browser does not support getUserMedia. Use Chrome or Edge.";
    setStatus("❌ " + msg);
    throw new Error(msg);
  }
  try {
    setStatus("Requesting microphone permission…");
    const constraints = {
      audio: {
        channelCount: 1,
        sampleRate: 48000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    setStatus("Microphone permission granted.");
    return stream;
  } catch (err) {
    console.error("getUserMedia error:", err);
    let reason = "";
    if (err.name === "NotAllowedError") {
      reason = "Permission blocked. Click the lock icon → Site settings → Allow Microphone, then reload.";
    } else if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
      reason = "No microphone found, or the selected device is unavailable.";
    } else if (err.name === "SecurityError") {
      reason = "Must be served over HTTPS or http://localhost.";
    } else {
      reason = err.message || String(err);
    }
    setStatus("❌ Failed to access microphone: " + reason);
    throw err;
  }
}

async function startRecording(){
  if (!('MediaRecorder' in window)) {
    const msg = "MediaRecorder not supported. Please use Chrome/Edge.";
    setStatus("❌ " + msg);
    alert(msg);
    return;
  }
  try {
    const stream = streamRef;
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    mediaRecorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0 || !listening) return;
      const fd = new FormData();
      fd.append("session_id", sessionId);
      fd.append("audio", e.data, "chunk.webm");
      try {
        const res = await fetch(`${API_BASE}/chunk`, { method: "POST", body: fd });
        const data = await res.json();
        if (data.error){
          console.error("Server error:", data.error);
          setStatus("Server error: " + data.error);
          return;
        }
        (data.hits || []).forEach(h => setGreen(h.sentence));
        if (data.terminate){
          setStatus("Detected: Timeout completed. Stopping…");
          stopFlow();
        }
      } catch(err) {
        console.error(err);
        setStatus("❌ Upload failed: " + err);
      }
    };

    // 每 2500ms 切一塊並觸發 ondataavailable
    mediaRecorder.start(2250);
    setStatus("Recording… sending 2.25s chunks to server.");
  } catch (e) {
    console.error("startRecording error:", e);
    setStatus("❌ startRecording error: " + (e.message || e));
  }
}

function stopFlow(){
  listening = false;
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive"){
      mediaRecorder.stop();
    }
    if (streamRef) {
      streamRef.getTracks().forEach(t => t.stop());
      streamRef = null;
    }
  } catch {}
  startBtn.disabled = false;
  stopBtn.style.display = "none";
  startBtn.textContent = "🎤 Start Recognition";
  exportLink.style.display = "inline-block";
  setStatus("Stopped. You can export the text or start again.");
}

// ================== 按鈕事件 ==================
startBtn.onclick = async ()=>{
  // 重置 UI
  itemRows.forEach(r => r.querySelector('.red-dot').classList.remove('green-dot'));
  exportLink.style.display = "none";

  startBtn.disabled = true;
  stopBtn.style.display = "";
  startBtn.textContent = "🎙️ Recognizing...";

  try {
    await newSession();                 // 建立後端 session
    streamRef = await requestMicOnce(); // 在點擊事件中請求麥克風（確保會跳授權）
    listening = true;
    await startRecording();             // 開始上傳 chunks
  } catch (e) {
    // 若授權或 /start 失敗，恢復按鈕
    startBtn.disabled = false;
    stopBtn.style.display = "none";
    startBtn.textContent = "🎤 Start Recognition";
  }
};

stopBtn.onclick = ()=>{
  const fd = new FormData();
  fd.append("session_id", sessionId || "");
  fetch(`${API_BASE}/reset`, { method: "POST", body: fd }).catch(()=>{});
  stopFlow();
};
