#!/usr/bin/env python3
"""Recorded voice for BotBox: the announcer, the two commentators and the pit reporter.

Clips are made offline with ElevenLabs (eleven_v3), trimmed, loudness normalized and shipped
dry as MP3 in public/voice/<speaker>/. The game adds reverb at runtime. public/voice/manifest.json
maps each line id to its file, caption text, speaker and length (format in docs/VOICE.md).

The API key comes from ELEVENLABS_API_KEY or ../ChannelKnowledgeBase/.env (it is never printed).
`design`, `verify` and `report` also need numpy and mlx_whisper, so run it with that venv:

  ../ChannelKnowledgeBase/.venv/bin/python scripts/voice/generate.py <command>

Commands:
  check            lines.json covers every id and minimum count in docs/VOICE.md
  design WHO       audition three designed voices for a speaker (scripts/voice/auditions/)
  create WHO N     save preview N as the speaker's voice and record its id in cast.json
  lines [ID...]    render missing or changed clips, process them and rewrite the manifest
  reroll [N] ID... try N more seeds per line, keep the take Whisper hears best (shorter on ties)
  verify [ID...]   transcribe clips with Whisper and compare them with their lines
  report           counts, durations, loudness and size

lines.json entries: {"id", "speaker", "text", "say"?, "tag"?, "seed"?, "tempo"?}. "text" is the caption.
"tempo" (default 1.0) speeds a take up after rendering with ffmpeg atempo, for lines that must fit a beat.
The voice reads "tag" (a v3 audio tag such as [excited]) and then "say" if present, else "text".
Clips are cached by everything that shapes them (voice, model, settings, spoken text, seed), so
`lines` only calls the API for new or changed lines. To re-roll a take, give the line a new seed.
"""
import base64
import concurrent.futures as cf
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CAST = HERE / "cast.json"
LINES = HERE / "lines.json"
STATE = HERE / "state.json"
VERIFY = HERE / "verify.json"
RAW = HERE / "raw"
AUDITIONS = HERE / "auditions"
OUT = ROOT / "public" / "voice"
MANIFEST = OUT / "manifest.json"
ROSTER = ROOT / "src" / "data" / "roster.ts"
API = "https://api.elevenlabs.io"
WHISPER = "mlx-community/whisper-large-v3-turbo"
WORKERS = 3

# Bump when processing changes so every clip is processed again.
FX_VERSION = 5
TARGET_LUFS = -16.0
LIMIT = 0.84  # about -1.5 dBFS, under the MP3 overshoot
# Trim on smoothed envelopes, relative to each clip's own peak: start 30 ms before the first 50 ms
# window within START_DB of the peak, end 80 ms after the last 30 ms window within END_DB. That
# drops the breath before a shout, the room tone after the last word and stray clicks, but keeps
# soft onsets and endings (Whisper re-checks every clip for clipped words).
START_DB, END_DB = 28.0, 35.0
PAD_IN, PAD_OUT = 0.03, 0.08
CLEAN = "aformat=sample_rates=44100:channel_layouts=mono,highpass=f=60"

VOICE_TAG_WORDS = {"shouting", "shouts", "excited", "deadpan", "laughs", "laughing", "sarcastic", "whispers",
                   "dramatically", "sighs", "chuckles", "roaring", "booming", "hoarse", "cheerfully", "warmly"}

# Flags reviewed and accepted: Whisper spells the right sound differently, or the pace is on purpose.
ACCEPT = {
    "vic.name.wreckoning": "Whisper writes the homophone Reckoning",
    "vic.player.torque": "Whisper writes TORQ, the right sound",
    "vic.ready": "the long dramatic pause is the point",
    "vic.name.y2kill": "Whisper writes Why to kill (and adds a question mark after Why) on every seed",
    "chuck.wheel.1": "Knocked runs into the, Whisper writes Knock the",
}

_print = threading.Lock()


class Stop(Exception):
    """Quota, auth or other errors that retrying will not fix."""


def log(*a):
    with _print:
        print(*a, flush=True)


def load(path, default=None):
    if default is not None and not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def api_key():
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    env = ROOT.parent / "ChannelKnowledgeBase" / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ELEVENLABS_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("\"'")
    if not key:
        sys.exit("ELEVENLABS_API_KEY is not set")
    return key


def post(path, body, accept="application/json", tries=5):
    for attempt in range(tries):
        req = urllib.request.Request(
            API + path,
            data=json.dumps(body).encode(),
            method="POST",
            headers={"xi-api-key": api_key(), "content-type": "application/json", "accept": accept},
        )
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:600]
            if e.code == 429 and "quota" not in msg.lower() and attempt < tries - 1:
                time.sleep(4 * (attempt + 1))
                continue
            if e.code >= 500 and attempt < tries - 1:
                time.sleep(4 * (attempt + 1))
                continue
            raise Stop(f"POST {path}: HTTP {e.code} {msg}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < tries - 1:
                time.sleep(4 * (attempt + 1))
                continue
            raise Stop(f"POST {path}: {e}")


# ---------------------------------------------------------------- spec

def roster():
    """Rival ids and voiced player names, read straight from src/data/roster.ts."""
    src = ROSTER.read_text(encoding="utf-8")
    rivals = re.findall(r"rival\(\s*'([a-z0-9-]+)'", src)
    block = src[src.index("VOICED_NAMES"):]
    names = re.findall(r"^\s*'([^']+)',", block, re.M)
    return rivals, [(re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-"), n) for n in names]


VIC_FIXED = (
    ["vic.class." + c for c in ("light", "middle", "heavy", "super")]
    + ["vic.round." + r for r in ("quarter", "semi", "final", "exhibition", "rumble")]
    + ["vic." + c for c in ("red", "blue", "green", "yellow")]
    + ["vic.player.rookie", "vic.ready", "vic.time", "vic.decision", "vic.byscore", "vic.to", "vic.release",
       "vic.tapout", "vic.lastbot", "vic.champion"]
    + [f"vic.count.{n}" for n in range(1, 11)]
    + [f"vic.num.{n}" for n in range(0, 46)]
)
VIC_VARIANTS = {"vic.open": 3, "vic.tonight": 2, "vic.player.intro": 3, "vic.go": 3, "vic.ko": 3, "vic.winner": 2}
COMMENTARY = ("start hit huge flip airborne saw pulverizer ramrod spikes wall panel wheel fire smoke weapondown "
              "drivedown count ko righted pin spinup whiff chase timelow decision upset idle intro rookie desk").split()
JENNA_VARIANTS = {"jenna.pits": 3, "jenna.win": 3, "jenna.lose": 3, "jenna.final": 2, "jenna.champ": 2}


def required():
    """(fixed ids, {variant prefix: minimum count}) from docs/VOICE.md."""
    rivals, players = roster()
    fixed = set(VIC_FIXED)
    fixed |= {f"vic.bot.{r}" for r in rivals} | {f"vic.name.{r}" for r in rivals}
    fixed |= {f"vic.player.{s}" for s, _ in players}
    variants = dict(VIC_VARIANTS)
    for who in ("dale", "chuck"):
        for cat in COMMENTARY:
            variants[f"{who}.{cat}"] = 6 if cat == "idle" else 3
    variants["dale.bumper"] = 3
    variants.update(JENNA_VARIANTS)
    return fixed, variants


def check(quiet=False):
    ok = True
    ln = load(LINES)
    ids = [x["id"] for x in ln]
    dupes = {i for i in ids if ids.count(i) > 1}
    for d in sorted(dupes):
        print(f"duplicate id: {d}")
        ok = False
    have = set(ids)
    fixed, variants = required()
    for f in sorted(fixed - have):
        print(f"missing: {f}")
        ok = False
    for prefix, need in sorted(variants.items()):
        n = sum(1 for i in have if re.fullmatch(re.escape(prefix) + r"\.\d+", i))
        nums = sorted(int(i.rsplit(".", 1)[1]) for i in have if re.fullmatch(re.escape(prefix) + r"\.\d+", i))
        if n < need:
            print(f"too few: {prefix} has {n}, needs {need}")
            ok = False
        if nums and nums != list(range(1, len(nums) + 1)):
            print(f"variants of {prefix} are not numbered 1..{len(nums)}: {nums}")
            ok = False
    known = set(fixed) | set(variants)
    for i in sorted(have):
        if i not in fixed and i.rsplit(".", 1)[0] not in variants:
            print(f"not in docs/VOICE.md: {i}")
            ok = False
    cast = load(CAST)
    for x in ln:
        if x["speaker"] not in cast["speakers"]:
            print(f"{x['id']}: unknown speaker {x['speaker']}")
            ok = False
        if not x["id"].startswith(x["speaker"].lower() + "."):
            print(f"{x['id']}: speaker {x['speaker']} does not match the id")
            ok = False
        for field in ("text", "say", "tag"):
            if re.search("[\u2013\u2014]", x.get(field, "")):
                print(f"{x['id']}: em or en dash in {field}")
                ok = False
        if "[" in x["text"]:
            print(f"{x['id']}: audio tag in the caption text")
            ok = False
    if not quiet:
        by = {}
        for x in ln:
            by[x["speaker"]] = by.get(x["speaker"], 0) + 1
        print(f"{len(ln)} lines: " + ", ".join(f"{k} {v}" for k, v in by.items()) + (", all ids present" if ok else ""))
    return ok


# ---------------------------------------------------------------- analysis

def pcm(path, sr=16000):
    import numpy as np
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def yin(path):
    """YIN pitch over 40 ms frames: (f0 list for voiced frames, median aperiodicity of those frames).
    Aperiodicity is the YIN dip depth, 0 for a pure tone; rough, breathy or gravelly voices read higher."""
    import numpy as np
    sr, n, hop = 16000, 640, 160
    x = pcm(path, sr)
    gate = 0.3 * float(np.sqrt(np.mean(x ** 2)))
    lo, hi = sr // 500, sr // 60
    f0, ap = [], []
    for i in range(0, len(x) - n - hi, hop):
        fr = x[i:i + n + hi]
        if float(np.sqrt(np.mean(fr[:n] ** 2))) < gate:
            continue
        d = np.array([np.sum((fr[:n] - fr[t:t + n]) ** 2) for t in range(hi)])
        cmnd = d[1:] * np.arange(1, hi) / np.maximum(np.cumsum(d[1:]), 1e-12)
        cmnd = np.concatenate([[1.0], cmnd])
        below = np.where(cmnd[lo:] < 0.2)[0]
        if len(below):
            t = lo + below[0]
            while t + 1 < hi and cmnd[t + 1] < cmnd[t]:
                t += 1
        else:
            t = lo + int(np.argmin(cmnd[lo:]))
        if cmnd[t] < 0.35:
            f0.append(sr / t)
            ap.append(float(cmnd[t]))
    return f0, (float(np.median(ap)) if ap else 1.0)


def voice_stats(path):
    """Median pitch, pitch range (10th to 90th percentile, in semitones), energy variation,
    aperiodicity (gravel) and spectral centroid (brightness)."""
    import numpy as np
    f0, aper = yin(path)
    x = pcm(path)
    frames = x[: len(x) // 800 * 800].reshape(-1, 800)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    loud = rms[rms > 0.02 * rms.max()]
    db = 20 * np.log10(loud + 1e-9)
    spec = np.abs(np.fft.rfft(frames * np.hanning(800), axis=1))
    freqs = np.fft.rfftfreq(800, 1 / 16000)
    voiced = rms > 0.1 * rms.max()
    centroid = float(np.median((spec[voiced] * freqs).sum(1) / (spec[voiced].sum(1) + 1e-9)))
    if not f0:
        return {"pitch_hz": 0, "range_st": 0, "energy_db_sd": 0}
    p10, p50, p90 = np.percentile(f0, [10, 50, 90])
    return {"pitch_hz": round(float(p50)), "range_st": round(float(12 * np.log2(p90 / p10)), 1),
            "energy_db_sd": round(float(db.std()), 1), "aperiodicity": round(aper, 3),
            "centroid_hz": round(centroid)}


ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen " \
       "seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def say_number(n):
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000:
        return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + say_number(n % 100))
    if n < 10000 and n % 1000 == 0:
        return ONES[n // 1000] + " thousand"
    return " ".join(ONES[int(c)] for c in str(n))


def words(s):
    s = s.lower().replace("-", " ").replace("’", "'")
    for a, b in (("gonna", "going to"), ("gotta", "got to"), ("wanna", "want to"), ("'em", "them")):
        s = re.sub(rf"(?<![a-z]){a}(?![a-z])", b, s)
    s = re.sub(r"\[[^\]]*\]", " ", s)
    s = re.sub(r"(\d),(\d)", r"\1\2", s)
    s = re.sub(r"(\d+)\s*(?:lb|lbs)\b", r"\1 pound", s)
    out = []
    for w in re.sub(r"[^a-z0-9' ]+", " ", s).split():
        w = w.strip("'")
        if not w:
            continue
        if w.isdigit():
            out.extend(say_number(int(w)).split())
        else:
            # Split letter-digit mixes like y2kill
            out.extend(p if not p.isdigit() else say_number(int(p)) for p in re.findall(r"[a-z']+|\d+", w))
    return [w for w in out if w]


def transcribe(path):
    import mlx_whisper
    return mlx_whisper.transcribe(str(path), path_or_hf_repo=WHISPER, language="en")["text"].strip()


def match(heard, text):
    a, b = " ".join(words(heard)), " ".join(words(text))
    spaced = difflib.SequenceMatcher(None, a, b).ratio()
    joined = difflib.SequenceMatcher(None, a.replace(" ", ""), b.replace(" ", "")).ratio()
    return max(spaced, joined)


def sha(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()[:12]


# ---------------------------------------------------------------- voices

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def design(who):
    cast = load(CAST)
    sp = cast["speakers"][who]
    res = json.loads(post("/v1/text-to-voice/design", {
        "voice_description": sp["description"],
        "model_id": cast["design_model"],
        "text": sp["sample"],
    }))
    AUDITIONS.mkdir(exist_ok=True)
    previews = []
    for i, p in enumerate(res["previews"], 1):
        f = AUDITIONS / f"{slug(who)}-{i}.mp3"
        f.write_bytes(base64.b64decode(p["audio_base_64"]))
        heard = transcribe(f)
        previews.append({"n": i, "generated_voice_id": p["generated_voice_id"], "file": f.name,
                         **voice_stats(f), "dur": round(duration(f), 1),
                         "match": round(match(heard, sp["sample"]), 3), "heard": heard})
        pv = previews[-1]
        log(f"{who} preview {i}: pitch {pv['pitch_hz']} Hz, range {pv['range_st']} st, "
            f"energy sd {pv['energy_db_sd']} dB, {pv['dur']} s, match {pv['match']}")
    save(AUDITIONS / f"{slug(who)}.json", {"who": who, "chars": len(sp["sample"]), "previews": previews})


def create(who, n):
    cast = load(CAST)
    sp = cast["speakers"][who]
    aud = load(AUDITIONS / f"{slug(who)}.json")
    pick = aud["previews"][n - 1]["generated_voice_id"]
    res = json.loads(post("/v1/text-to-voice", {
        "voice_name": sp["name"],
        "voice_description": sp["description"],
        "generated_voice_id": pick,
        "played_not_selected_voice_ids": [p["generated_voice_id"] for p in aud["previews"] if p["generated_voice_id"] != pick],
    }))
    sp["voice_id"] = res["voice_id"]
    sp["audition_pick"] = n
    save(CAST, cast)
    log(f"{who}: voice {res['voice_id']}")


# ---------------------------------------------------------------- clips

def spoken(ln):
    text = ln.get("say", ln["text"])
    return f"{ln['tag']} {text}" if ln.get("tag") else text


def out_path(ln):
    who, rest = ln["id"].split(".", 1)
    return OUT / who / (rest.replace(".", "-") + ".mp3")


def spec_of(ln, cast):
    sp = cast["speakers"][ln["speaker"]]
    settings = {**cast["voice_settings"], **sp.get("settings", {})}
    return {"voice": sp["voice_id"], "model": cast["model"], "settings": settings,
            "text": spoken(ln), "seed": ln.get("seed", 1)}


def raw_path(ln, spec):
    key = hashlib.sha1(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:12]
    return RAW / f"{ln['id']}-{key}.mp3", key


def ebur(path):
    """(integrated LUFS, true peak dBTP) via ffmpeg ebur128."""
    err = subprocess.run(["ffmpeg", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    summary = err[err.rfind("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", summary).group(1).replace("-inf", "-70"))
    p = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summary)
    return i, float(p.group(1).replace("-inf", "-70")) if p else 0.0


def trim_points(wav):
    import numpy as np
    sr, hop = 44100, 441
    x = pcm(wav, sr)
    n = len(x) // hop
    power = (x[: n * hop].reshape(n, hop) ** 2).mean(axis=1)
    env = lambda w: 10 * np.log10(np.convolve(power, np.ones(w) / w, mode="same") + 1e-12)
    head, tail = env(5), env(3)
    first = np.where(head > head.max() - START_DB)[0][0]
    start = max(0.0, (first - 2) * hop / sr - PAD_IN)  # the 50 ms window is centered, so back up 20 ms
    end = min(len(x) / sr, (np.where(tail > tail.max() - END_DB)[0][-1] + 1) * hop / sr + PAD_OUT)
    return start, end


def process(raw, out, target, tempo=1.0):
    with tempfile.TemporaryDirectory() as tmp:
        wav, cut = Path(tmp) / "clean.wav", Path(tmp) / "cut.wav"
        fx = CLEAN + (f",atempo={tempo}" if tempo != 1.0 else "")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", fx, str(wav)], check=True)
        start, end = trim_points(wav)
        fade_out = min(0.05, PAD_OUT)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-af",
                        f"atrim=start={start:.3f}:end={end:.3f},asetpts=N/SR/TB,afade=t=in:d=0.008,"
                        f"afade=t=out:st={end - start - fade_out:.3f}:d={fade_out}", str(cut)], check=True)
        lufs, _ = ebur(cut)
        if lufs <= -60:  # too short for a gated reading: fall back to RMS
            import numpy as np
            x = pcm(cut, 44100)
            lufs = 20 * np.log10(float(np.sqrt(np.mean(x ** 2))) + 1e-9) - 0.7
        gain = max(-20.0, min(24.0, target - lufs))
        out.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(3):  # the limiter and encoder shave a little, so measure and correct
            subprocess.run([
                "ffmpeg", "-v", "error", "-y", "-i", str(cut),
                "-af", f"volume={gain:.2f}dB,alimiter=limit={LIMIT}:attack=1:release=40:level=disabled",
                "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", str(out),
            ], check=True)
            got, _ = ebur(out)
            if got <= -60 or abs(got - target) < 0.25:
                break
            gain += target - got


def duration(path):
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout)


def render(ln, spec, raw):
    data = post(
        f"/v1/text-to-speech/{spec['voice']}?output_format=mp3_44100_128",
        {"text": spec["text"], "model_id": spec["model"], "voice_settings": spec["settings"], "seed": spec["seed"]},
        accept="audio/mpeg",
    )
    raw.write_bytes(data)
    return len(spec["text"])


def lines(only=()):
    if not check(quiet=True):
        sys.exit("lines.json does not cover docs/VOICE.md yet (run `check`)")
    cast = load(CAST)
    state = load(STATE, {"chars_sent": 0, "renders": 0, "clips": {}})
    RAW.mkdir(exist_ok=True)
    all_lines = load(LINES)
    todo = [x for x in all_lines if not only or x["id"] in only or any(x["id"].startswith(o + ".") for o in only)]
    jobs = []
    for ln in todo:
        if not cast["speakers"][ln["speaker"]]["voice_id"]:
            sys.exit(f"{ln['speaker']} has no voice yet: run `design` and `create` first")
        spec = spec_of(ln, cast)
        raw, _ = raw_path(ln, spec)
        if not raw.exists():
            jobs.append((ln, spec, raw))
    stopped = None
    if jobs:
        log(f"rendering {len(jobs)} clip(s), {sum(len(s['text']) for _, s, _ in jobs)} characters")
        with cf.ThreadPoolExecutor(WORKERS) as pool:
            futs = {pool.submit(render, *j): j for j in jobs}
            for f in cf.as_completed(futs):
                ln = futs[f][0]
                try:
                    n = f.result()
                    state["chars_sent"] += n
                    state["renders"] += 1
                    log(f"  {ln['id']}: {spoken(ln)}")
                except Stop as e:
                    stopped = stopped or str(e)
                    for g in futs:
                        g.cancel()
        save(STATE, state)
    if stopped:
        log(f"STOPPED: {stopped}")
    # Process every line whose raw take exists, and rebuild the manifest.
    manifest = {"version": 1, "lines": {}}
    old = load(MANIFEST, {"version": 1, "lines": {}})["lines"]
    keep_raw = set()
    for ln in all_lines:
        spec = spec_of(ln, cast)
        raw, key = raw_path(ln, spec)
        out = out_path(ln)
        target = cast["speakers"][ln["speaker"]].get("lufs", TARGET_LUFS)
        tempo = ln.get("tempo", cast["speakers"][ln["speaker"]].get("tempo", 1.0))
        stamp = f"{key}:{FX_VERSION}:{target}:{tempo}"
        if not raw.exists():
            if ln["id"] in old and out.exists():
                manifest["lines"][ln["id"]] = old[ln["id"]]  # keep the last good take for now
            continue
        keep_raw.add(raw.name)
        if state["clips"].get(ln["id"], {}).get("stamp") != stamp or not out.exists():
            process(raw, out, target, tempo)
            state["clips"][ln["id"]] = {"stamp": stamp, "sha": sha(out)}
        manifest["lines"][ln["id"]] = {
            "file": str(out.relative_to(OUT)), "text": ln["text"], "speaker": ln["speaker"],
            "dur": round(duration(out), 2),
        }
    ids = {x["id"] for x in all_lines}
    state["clips"] = {k: v for k, v in state["clips"].items() if k in ids}
    for f in RAW.glob("*.mp3"):
        if f.name not in keep_raw:
            f.unlink()
    for f in OUT.glob("*/*.mp3"):
        if str(f.relative_to(OUT)) not in {v["file"] for v in manifest["lines"].values()}:
            f.unlink()
    manifest["lines"] = dict(sorted(manifest["lines"].items()))
    save(MANIFEST, manifest)
    save(STATE, state)
    total = sum(v["dur"] for v in manifest["lines"].values())
    log(f"{len(manifest['lines'])}/{len(all_lines)} clips, {total:.1f} s, {state['chars_sent']} characters sent in total")
    if stopped:
        sys.exit(1)


def reroll(ids, tries=3):
    """Render other seeds for these lines, score every take with Whisper and keep the best seed.
    Ties go to the shorter take. Writes the winning seed back to lines.json."""
    cast = load(CAST)
    state = load(STATE, {"chars_sent": 0, "renders": 0, "clips": {}})
    all_lines = load(LINES)
    by = {x["id"]: x for x in all_lines}
    RAW.mkdir(exist_ok=True)
    for i in ids:
        ln = by[i]
        base = ln.get("seed", 1)
        seeds = [base] + [base + 100 * k for k in range(1, tries + 1)]
        jobs = []
        for sd in seeds:
            trial = {**ln, "seed": sd}
            spec = spec_of(trial, cast)
            raw, _ = raw_path(trial, spec)
            if not raw.exists():
                jobs.append((trial, spec, raw))
        with cf.ThreadPoolExecutor(WORKERS) as pool:
            for n in pool.map(lambda j: render(*j), jobs):
                state["chars_sent"] += n
                state["renders"] += 1
        save(STATE, state)
        best = None
        with tempfile.TemporaryDirectory() as tmp:
            for sd in seeds:
                trial = {**ln, "seed": sd}
                raw, _ = raw_path(trial, spec_of(trial, cast))
                out = Path(tmp) / f"{sd}.mp3"
                tempo = ln.get("tempo", cast["speakers"][ln["speaker"]].get("tempo", 1.0))
                process(raw, out, TARGET_LUFS, tempo)
                heard = transcribe(out)
                score = max(match(heard, ln["text"]), match(heard, ln.get("say", ln["text"])))
                d = duration(out)
                log(f"  {i} seed {sd}: {score:.2f} {d:.2f}s heard: {heard}")
                if best is None or (score, -d) > (best[0] + 0.02, -best[1]) or (abs(score - best[0]) <= 0.02 and d < best[1]):
                    best = (score, d, sd)
        if best[2] != 1:
            ln["seed"] = best[2]
        else:
            ln.pop("seed", None)
        log(f"{i}: keep seed {best[2]} ({best[0]:.2f}, {best[1]:.2f}s)")
        save_lines(all_lines)


def save_lines(all_lines):
    order = ["id", "speaker", "text", "say", "tag", "seed", "tempo"]
    rows = [{k: x[k] for k in order if k in x} for x in all_lines]
    LINES.write_text("[\n" + ",\n".join("  " + json.dumps(x, ensure_ascii=False) for x in rows) + "\n]\n", encoding="utf-8")


# ---------------------------------------------------------------- verify

STRICT = ("vic.name.", "vic.player.", "vic.num.", "vic.count.", "vic.bot.")


def verify(only=(), threshold=0.92, strict=0.97):
    """Whisper each clip, compare, and flag mismatches, read-aloud tags, cut-offs and odd pacing."""
    lines_by = {x["id"]: x for x in load(LINES)}
    man = load(MANIFEST)["lines"]
    ver = load(VERIFY, {})
    bad = []
    for i, clip in man.items():
        if only and i not in only and not any(i.startswith(o + ".") for o in only):
            continue
        path = OUT / clip["file"]
        h = sha(path)
        rec = ver.get(i)
        if not rec or rec.get("sha") != h:
            heard = transcribe(path)
            rec = {"sha": h, "heard": heard}
        ln = lines_by[i]
        text = ln["text"]
        score = match(rec["heard"], text)
        alt = match(rec["heard"], ln.get("say", text))
        score = max(score, alt)
        issues = []
        hw, tw = words(rec["heard"]), words(ln.get("say", text))
        if score < (strict if i.startswith(STRICT) else threshold):
            issues.append("mismatch")
        tagged = [w for w in hw if w in VOICE_TAG_WORDS and w not in tw]
        if tagged:
            issues.append("tag read aloud? " + " ".join(tagged))
        if tw and hw and difflib.SequenceMatcher(None, "".join(hw)[-8:], "".join(tw)[-8:]).ratio() < 0.6:
            issues.append("ending differs")
        wps = len(tw) / max(clip["dur"], 0.1)
        if clip["dur"] > 1.2 and wps < 0.7 and len(tw) > 1:
            issues.append(f"slow ({wps:.1f} words/s)")
        if len(tw) >= 4 and clip["dur"] > 0 and wps > 5.5:
            issues.append(f"rushed ({wps:.1f} words/s)")
        if issues and i in ACCEPT:
            issues = [f"accepted: {ACCEPT[i]}"]
        rec.update({"score": round(score, 3), "issues": issues})
        ver[i] = rec
        if issues and not issues[0].startswith("accepted"):
            bad.append(i)
            log(f"{score:.2f} {clip['dur']:5.2f}s {i}: {text}\n      heard: {rec['heard']}  <-- {'; '.join(issues)}")
    ver = {k: v for k, v in sorted(ver.items()) if k in man}
    save(VERIFY, ver)
    checked = [k for k in man if not only or k in only or any(k.startswith(o + ".") for o in only)]
    log(f"{len(checked) - len(bad)}/{len(checked)} clips pass, {len(bad)} to check")
    return bad


def report():
    man = load(MANIFEST)["lines"]
    ver = load(VERIFY, {})
    state = load(STATE, {})
    by = {}
    for i, c in man.items():
        who = c["speaker"]
        cat = ".".join(i.split(".")[1:2])
        by.setdefault(who, {}).setdefault(cat, []).append(c["dur"])
    for who, cats in by.items():
        n = sum(len(v) for v in cats.values())
        print(f"{who}: {n} lines, {sum(sum(v) for v in cats.values()):.0f} s")
        print("   " + ", ".join(f"{k} {len(v)}" for k, v in sorted(cats.items())))
        long = [i for i, c in man.items() if c["speaker"] == who and c["dur"] > 3.0 and
                i.split(".")[0] in ("dale", "chuck") and i.split(".")[1] not in ("idle", "intro", "desk", "rookie", "bumper", "decision")]
        if long:
            print("   reaction lines over 3 s: " + ", ".join(f"{i} {man[i]['dur']}" for i in long))
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    fails = [k for k, v in ver.items() if v.get("issues") and not v["issues"][0].startswith("accepted")]
    accepted = [k for k, v in ver.items() if v.get("issues") and v["issues"][0].startswith("accepted")]
    print(f"total {len(man)} clips, {sum(c['dur'] for c in man.values()):.0f} s, {size / 1e6:.1f} MB in public/voice")
    print(f"characters sent: {state.get('chars_sent', 0)} in {state.get('renders', 0)} renders")
    print(f"verify: {len(man) - len(fails)}/{len(man)} pass ({len(accepted)} accepted by review: {', '.join(accepted)}); "
          f"flagged: {', '.join(fails) or 'none'}")


if __name__ == "__main__":
    cmd, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ("", [])
    try:
        if cmd == "check":
            sys.exit(0 if check() else 1)
        elif cmd == "design" and args:
            design(args[0])
        elif cmd == "restat" and args:
            aud = load(AUDITIONS / f"{slug(args[0])}.json")
            for pv in aud["previews"]:
                pv.update(voice_stats(AUDITIONS / pv["file"]))
                print(args[0], pv["n"], {k: pv[k] for k in ("pitch_hz", "range_st", "energy_db_sd", "aperiodicity", "centroid_hz", "dur", "match")})
            save(AUDITIONS / f"{slug(args[0])}.json", aud)
        elif cmd == "create" and len(args) == 2:
            create(args[0], int(args[1]))
        elif cmd == "lines":
            lines(tuple(args))
        elif cmd == "reroll" and args:
            tries = int(args[0]) if args[0].isdigit() else 3
            reroll([a for a in args if not a.isdigit()], tries)
        elif cmd == "verify":
            sys.exit(0 if not verify(tuple(args)) else 1)
        elif cmd == "report":
            report()
        else:
            sys.exit(__doc__)
    except Stop as e:
        sys.exit(f"STOPPED: {e}")
