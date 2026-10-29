# 🎬 TubeNotes — 100% Free

YouTube → Transcription → AI Notes → Translation → PDF

**Cost: $0. Forever.**

## How it works

```
yt-dlp              → downloads YouTube audio         (free)
Groq Whisper API    → transcribes audio               (free)
Groq LLaMA 3 API    → summary + key points            (free)
Google Translate    → 12-language translation         (free)
jsPDF               → PDF export in browser           (free)
```

**Only 1 account needed → Groq (free, no credit card)**

---

## Run locally

### 1. Install ffmpeg

```bash
# macOS
brew install ffmpeg

# Ubuntu
sudo apt install ffmpeg

# Windows → https://ffmpeg.org/download.html
```

### 2. Get your free Groq API key

1. Go to https://console.groq.com
2. Sign up (free, no credit card)
3. Go to **API Keys** → **Create API Key**
4. Copy it

### 3. Install & run

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# Install packages
pip install -r requirements.txt

# Set your Groq key
export GROQ_API_KEY=gsk_xxxxxxxxxxxx     # Mac/Linux
set GROQ_API_KEY=gsk_xxxxxxxxxxxx        # Windows CMD

# Run
python app.py
```

Open **http://localhost:5000**

---
# not able to push on render because of cross unverified request

---

## File structure

```
tubenotes/
├── app.py              ← Flask backend (yt-dlp + Groq + Google Translate)
├── requirements.txt
├── render.yaml         ← Render deploy config
├── .env.example
├── templates/
│   └── index.html
└── static/
    ├── css/style.css
    └── js/app.js
```

---

## Groq free limits

| What | Limit |
|------|-------|
| Whisper transcription | 7,200 min/day |
| LLaMA 3 (summary/keypoints) | 14,400 requests/day |

More than enough for personal or small-scale use.
