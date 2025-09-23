// ===================== 配置 =====================
const API_BASE = "https://timeout-checklist-server.onrender.com"; // ← 換成你的後端網址
const CHUNK_MS = 2250;                                           // 與後端邏輯一致
const TIMEOUT_SENTENCE = "Timeout completed.";

// ===================== Checklist（視覺資料）=====================
const groups = [
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

// ===================== 畫面渲染 =====================
const checklistDiv = document.getElementById('checklist');
function renderChecklist() {
  checklistDiv.innerHTML = "";
  groups.forEach(g => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'group';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'group-title';
    titleDiv.textContent = g.title;
    groupDiv.appendChild(titleDiv);

    const list = document.createElement('div');
    list.className = 'item-list';

    g.items.forEach(txt => {
      const row = document.createElement('div');
      row.className = 'item-row';
      row.dataset.key = txt;

      const span = document.createElement('span');
      span.className = 'item-text';
      span.textContent = txt;

      const dot = document.createElement('span');
      dot.className = 'red-dot';

      row.appendChild(span);
      row.appendChild(dot);
      list.appendChild(row);
    });

    groupDiv.appendChild(list);
    checklistDiv.appendChild(groupDiv);
  });
}
renderChecklist();

// ===================== 錄音與上傳 =====================
const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const downloadLink = document.getElementById('downloadLink');

let mediaRecorder;
let audioChunks = [];
let listening = false;
const greened = new Set();

// 智慧選擇 mimeType：Chrome/Edge 用 webm；Safari 用 mp4
function chooseMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',              // Safari 常用
    'audio/mp4;codecs=aac'
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return ''; // 讓瀏覽器自行決定
}

async function postChunk(blob, filename) {
  // 確保一定帶副檔名 → 後端能把檔名傳給 OpenAI，避免 "unsupported"
  const fd = new FormData();
  fd.append("audio", blob, filename);

  try {
    const res = await fetch(`${API_BASE}/transcribe-chunk`, {
      method: "POST",
      body: fd,
      // 防止部分 proxy 快取（通常不需要，但保險）
      headers: { "x-request-id": String(Date.now()) }
    });
    if (!res.ok) {
      console.warn("Chunk request failed:", res.status, await res.text());
      return;
    }
    const data = await res.json(); // {hits:[], raw:[], suggestions:[]}

    (data.hits || []).forEach(sentence => {
      if (greened.has(sentence)) return;
      const row = document.querySelector(`.item-row[data-key="${CSS.escape(sentence)}"]`);
      if (row) {
        row.querySelector('.red-dot').classList.add('green-dot');
        greened.add(sentence);
        if (sentence === TIMEOUT_SENTENCE) stopFlow(); // 命中終止句 → 自動停
      }
    });
  } catch (err) {
    console.error("postChunk error:", err);
  }
}

async function startFlow() {
  // Reset UI
  greened.clear();
  document.querySelectorAll('.red-dot').forEach(d => d.classList.remove('green-dot'));
  downloadLink.style.display = "none";
  audioChunks = [];

  // 先 ping /health，喚醒免費方案（避免第一包被冷啟延遲拖垮）
  try { await fetch(`${API_BASE}/health`, { cache: "no-store" }); } catch {}

  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Your browser does not support audio recording.");
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = chooseMimeType();
  mediaRecorder = type ? new MediaRecorder(stream, { mimeType: type })
                       : new MediaRecorder(stream);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      audioChunks.push(e.data); // 用來做整段下載
      // 根據 MIME 決定副檔名（一定要帶副檔名）
      const ext = (mediaRecorder.mimeType || type || 'audio/webm').includes('mp4') ? 'mp4' : 'webm';
      const fname = `chunk_${Date.now()}.${ext}`;
      postChunk(e.data, fname).catch(()=>{});
    }
  };

  mediaRecorder.onstop = () => {
    // 生成整段錄音讓使用者下載
    const ext = (mediaRecorder.mimeType || type || 'audio/webm').includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || `audio/${ext}` });
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.download = `timeout-audio.${ext}`;
    downloadLink.style.display = "inline-block";
  };

  listening = true;
  startBtn.disabled = true;
  stopBtn.style.display = "";
  startBtn.textContent = "🎙️ Recognizing...";

  // 每 CHUNK_MS 觸發 ondataavailable
  mediaRecorder.start(CHUNK_MS);
}

function stopFlow() {
  if (!listening) return;
  listening = false;
  try { mediaRecorder && mediaRecorder.stop(); } catch {}
  startBtn.disabled = false;
  stopBtn.style.display = "none";
  startBtn.textContent = "🎤 Start Recognition";
}

startBtn.onclick = startFlow;
stopBtn.onclick  = stopFlow;
