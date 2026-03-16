import os
import re
import json
import time
import tempfile
import threading
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import yt_dlp
from groq import Groq
from deep_translator import GoogleTranslator

app = Flask(__name__)
CORS(app)

groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

# In-memory job store
jobs = {}

LANGUAGE_CODES = {
    "en": "english", "ta": "tamil",  "hi": "hindi",
    "es": "spanish", "fr": "french", "de": "german",
    "ja": "japanese","zh": "chinese","ar": "arabic",
    "pt": "portuguese","ko": "korean","ru": "russian"
}

LANGUAGE_NAMES = {
    "en": "English", "ta": "Tamil",  "hi": "Hindi",
    "es": "Spanish", "fr": "French", "de": "German",
    "ja": "Japanese","zh": "Chinese","ar": "Arabic",
    "pt": "Portuguese","ko": "Korean","ru": "Russian"
}


# ─── Helpers ────────────────────────────────────────────────────────────────

def download_audio(url: str, out_dir: str):
    """Download audio from YouTube using yt-dlp."""
    out_template = os.path.join(out_dir, "audio.%(ext)s")
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": out_template,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "wav",
            "preferredquality": "192",
        }],
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title    = info.get("title", "YouTube Video")
        duration = info.get("duration", 0)

    wav_path = os.path.join(out_dir, "audio.wav")
    return wav_path, title, duration


def transcribe_audio(wav_path: str) -> dict:
    """Transcribe using Groq Whisper API (free)."""
    with open(wav_path, "rb") as f:
        response = groq_client.audio.transcriptions.create(
            model="whisper-large-v3",
            file=f,
            response_format="verbose_json",
        )

    segments = []
    if hasattr(response, "segments") and response.segments:
        for seg in response.segments:
            segments.append({
                "start": seg.get("start", 0),
                "end":   seg.get("end", 0),
                "text":  seg.get("text", "").strip()
            })

    return {
        "text":     response.text.strip(),
        "language": getattr(response, "language", "en"),
        "segments": segments
    }


def call_groq_llm(prompt: str, system: str = "") -> str:
    """Call Groq LLaMA 3 (free) for text tasks."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    response = groq_client.chat.completions.create(
        model="llama3-8b-8192",
        messages=messages,
        max_tokens=1024,
        temperature=0.3,
    )
    return response.choices[0].message.content.strip()


def summarize_text(text: str) -> str:
    # Groq has an 8192 token context — trim if too long
    trimmed = text[:6000] if len(text) > 6000 else text
    return call_groq_llm(
        f"Summarize this video transcript in 2-3 concise sentences:\n\n{trimmed}",
        system="You are a helpful assistant. Return only the summary, no preamble."
    )


def extract_keypoints(text: str) -> list:
    trimmed = text[:6000] if len(text) > 6000 else text
    raw = call_groq_llm(
        f"Extract 5 key takeaways from this transcript. Return ONLY a JSON array of 5 strings, no markdown, no explanation:\n\n{trimmed}",
        system="Return only a valid JSON array of 5 strings. No markdown. No explanation."
    )
    try:
        clean = re.sub(r"```json|```", "", raw).strip()
        return json.loads(clean)
    except Exception:
        lines = [l.strip().lstrip("-•0123456789. ") for l in raw.split("\n") if l.strip()]
        return lines[:5]


def translate_text(text: str, target_lang: str) -> str:
    """Translate using deep-translator (Google Translate, free, no key needed)."""
    try:
        # deep_translator handles long text automatically
        # Split into chunks of 4500 chars (Google limit is 5000)
        chunks = [text[i:i+4500] for i in range(0, len(text), 4500)]
        translated_chunks = []
        for chunk in chunks:
            translated = GoogleTranslator(source="auto", target=target_lang).translate(chunk)
            translated_chunks.append(translated)
        return " ".join(translated_chunks)
    except Exception as e:
        raise Exception(f"Translation failed: {str(e)}")


def format_timestamp(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def build_timestamped_notes(segments: list) -> str:
    return "\n".join(
        f"[{format_timestamp(seg['start'])}] {seg['text']}"
        for seg in segments
    )


# ─── Background worker ───────────────────────────────────────────────────────

def process_job(job_id: str, url: str, options: dict):
    job = jobs[job_id]

    def update(step, msg, progress):
        job.update({"step": step, "msg": msg, "progress": progress})

    try:
        with tempfile.TemporaryDirectory() as tmpdir:

            # 1. Download
            update("Downloading", "Fetching audio from YouTube…", 10)
            wav_path, title, duration = download_audio(url, tmpdir)

            if not os.path.exists(wav_path):
                raise FileNotFoundError("Audio file not found. Is ffmpeg installed?")

            # 2. Transcribe
            update("Transcribing", "Running Whisper on Groq (free)…", 35)
            result    = transcribe_audio(wav_path)
            transcript     = result["text"]
            detected_lang  = result["language"]
            segments       = result["segments"]

            # 3. Timestamps
            timestamped = build_timestamped_notes(segments) if (options.get("timestamps") and segments) else None

            # 4. Summarize
            summary = None
            if options.get("summarize") and transcript:
                update("Summarizing", "Generating summary with LLaMA 3…", 62)
                summary = summarize_text(transcript)

            # 5. Key points
            keypoints = []
            if options.get("keypoints") and transcript:
                update("Key points", "Extracting takeaways with LLaMA 3…", 80)
                keypoints = extract_keypoints(transcript)

            update("Done", "Your notes are ready!", 100)

            job.update({
                "status": "done",
                "data": {
                    "title":         title,
                    "duration":      duration,
                    "transcript":    transcript,
                    "timestamped":   timestamped,
                    "detected_lang": detected_lang,
                    "summary":       summary,
                    "keypoints":     keypoints,
                    # Translation cache
                    "translations":        {},
                    "summary_translations":{},
                    "kp_translations":     {},
                }
            })

    except Exception as e:
        job.update({"status": "error", "msg": str(e), "progress": 0, "step": "Error"})


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/process", methods=["POST"])
def start_process():
    body = request.json or {}
    url  = body.get("url", "").strip()

    if not url:
        return jsonify({"error": "URL is required"}), 400
    if "youtube.com" not in url and "youtu.be" not in url:
        return jsonify({"error": "Please enter a valid YouTube URL"}), 400

    job_id = f"job_{int(time.time() * 1000)}"
    jobs[job_id] = {
        "status": "running",
        "step":   "Starting…",
        "msg":    "Initializing pipeline",
        "progress": 0
    }

    options = {
        "summarize":  body.get("summarize",  True),
        "keypoints":  body.get("keypoints",  True),
        "timestamps": body.get("timestamps", False),
    }

    thread = threading.Thread(target=process_job, args=(job_id, url, options), daemon=True)
    thread.start()
    return jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def job_status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@app.route("/api/translate", methods=["POST"])
def translate():
    body       = request.json or {}
    job_id     = body.get("job_id")
    target_lang = body.get("lang")

    if not job_id or not target_lang:
        return jsonify({"error": "job_id and lang required"}), 400

    job = jobs.get(job_id)
    if not job or job.get("status") != "done":
        return jsonify({"error": "Job not ready"}), 400

    data = job["data"]

    # Return English originals directly — no translation needed
    if target_lang == "en":
        return jsonify({
            "transcript": data["transcript"],
            "summary":    data.get("summary"),
            "keypoints":  data.get("keypoints", []),
        })

    translations = data.setdefault("translations",         {})
    sum_trans    = data.setdefault("summary_translations", {})
    kp_trans     = data.setdefault("kp_translations",      {})

    # Translate with cache
    if target_lang not in translations:
        translations[target_lang] = translate_text(data["transcript"], target_lang)

    if data.get("summary") and target_lang not in sum_trans:
        sum_trans[target_lang] = translate_text(data["summary"], target_lang)

    if data.get("keypoints") and target_lang not in kp_trans:
        kp_trans[target_lang] = [translate_text(kp, target_lang) for kp in data["keypoints"]]

    return jsonify({
        "transcript": translations[target_lang],
        "summary":    sum_trans.get(target_lang),
        "keypoints":  kp_trans.get(target_lang, data.get("keypoints", [])),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🎬  TubeNotes (100% free) running → http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
