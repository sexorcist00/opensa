"""A dispatch console you can drive from Termux and listen to in a browser.

    python console.py                       # http://localhost:8765
    python console.py --once "открыт огонь"  # one line, no browser

Type what an operator would type. The page shows what the pipeline decides — glossary
hit or miss, the English that would be spoken, the urgency and WHY, the speakable form
— and plays the baked clip when the bank has one.

**What it does not do is synthesise.** There is no GPU on a phone and no model here, so
a miss goes out as text with no voice, which is not a limitation of this tool: it is
decision 11, the shipped behaviour. Watching a miss stay silent is the point.

Standard library only. numpy is used only by --apply-chain and is imported there.
"""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import re
import tempfile

import voices as voice_backends
from classify import RepeatFilter, classify, reconcile
from glossary import Glossary, bank_key, match_key
from normalise import normalise_for_speech, strip_shout

DEFAULT_BANK = Path("bank")
RENDER_DIR = Path(tempfile.gettempdir()) / "dispatch-console"
CYRILLIC = re.compile(r"[а-яё]", re.IGNORECASE)
VOICE_ID = "dispatch-1"
MODEL_VERSION = "seed"


def decide(text: str, glossary: Glossary, repeats: RepeatFilter,
           channel: str = "r1", bank: Path = DEFAULT_BANK) -> dict:
    """One transmission through the whole text half of the pipeline.

    Text with no Cyrillic in it is treated as an AUDITION: the console speaks it as
    typed so a voice can be judged, instead of pretending it came off a radio. That
    is a bench affordance and the page says so; it is not how the product behaves.
    """
    audition = bool(text) and not CYRILLIC.search(text)
    if audition:
        return {"text": text, "channel": channel, "audition": True, "hit": False,
                "spoken": text, "level": "routine", "reason": "audition - spoken as typed",
                "signals": [], "shouted": False, "stripped": None, "clip": None,
                "repeat": False, "key": ""}

    verdict = classify(text)
    entry = glossary.lookup(text)

    spoken_en = normalise_for_speech(entry.en) if entry else None
    level = entry.level if entry else reconcile(verdict, None)

    clip = None
    if entry:
        name = bank_key(entry.key, VOICE_ID, MODEL_VERSION) + ".wav"
        if (bank / name).exists():
            clip = name

    return {
        "text": text,
        "channel": channel,
        "audition": False,
        "hit": entry is not None,
        "spoken": spoken_en,
        "level": level,
        "reason": verdict.reason,
        "signals": verdict.signals,
        "shouted": verdict.shouted,
        "stripped": strip_shout(text) if verdict.shouted else None,
        "clip": clip,
        "repeat": not repeats.should_speak(channel, text),
        "key": match_key(text),
    }


PAGE = """<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dispatch console</title><style>
:root{--bg:#14171a;--card:#1c2024;--ink:#e8eaec;--dim:#8b9196;--rule:#2b3136;
--routine:#8f979d;--urgent:#d99534;--emergency:#e2685a;--ok:#4fbac4}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:14px}
h1{font-size:17px;margin:0;letter-spacing:.02em}
.sub{color:var(--dim);font-size:13px;margin:0}
textarea{width:100%;min-height:76px;background:#101316;color:var(--ink);border:1px solid var(--rule);
padding:10px;font:inherit;border-radius:0;resize:vertical}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
button,select{min-height:44px;font:inherit;background:var(--card);color:var(--ink);
border:1px solid var(--rule);padding:0 14px;cursor:pointer}
button.go{background:var(--ok);border-color:var(--ok);color:#08222a;font-weight:600;flex:1}
.card{background:var(--card);border:1px solid var(--rule);padding:12px;display:flex;
flex-direction:column;gap:8px}
.chip{display:inline-block;padding:2px 8px;font-size:12px;letter-spacing:.08em;
text-transform:uppercase;border:1px solid currentColor}
.k{color:var(--dim);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.mono{font-family:ui-monospace,monospace;font-size:13px;word-break:break-word}
.en{font-size:16px}
.miss{color:var(--dim);font-style:italic}
audio{width:100%}
.list{display:flex;flex-wrap:wrap;gap:6px}
.list button{min-height:36px;padding:0 10px;font-size:13px;color:var(--dim)}
</style></head><body><div class="wrap">
<h1>Dispatch console</h1>
<p class="sub">Наберите то, что напечатал бы диспетчер. Попадание в словарь играет
испечённый файл; промах уходит текстом и молчит — это поведение, а не заглушка.</p>
<textarea id="t" placeholder="открыт огонь по офицеру"></textarea>
<div class="row">
  <select id="ch"><option>r1</option><option>r2</option><option>r3</option><option>r4</option></select>
  <select id="voice"></select>
  <button class="go" id="go">Передать</button>
</div>
<p class="sub" id="vnote"></p>
<div id="out"></div>
<p class="k">Словарь — нажмите, чтобы подставить</p>
<div class="list" id="seeds"></div>
</div><script>
const LEVEL={routine:'--routine',urgent:'--urgent',emergency:'--emergency'};
let BACKENDS=[];

function speakInBrowser(text){
  if(!('speechSynthesis' in window)){return 'браузер не умеет speechSynthesis';}
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text);
  u.lang=/[а-яё]/i.test(text)?'ru-RU':'en-US';
  speechSynthesis.speak(u);
  return null;
}
async function send(){
  const text=document.getElementById('t').value.trim();
  if(!text)return;
  const r=await fetch('/api/dispatch',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({text,channel:document.getElementById('ch').value,
      voice:document.getElementById('voice').value})});
  const d=await r.json();
  const c=`var(${LEVEL[d.level]||'--routine'})`;
  let browserNote=null;
  if(d.backend==='browser'&&d.spoken&&!d.repeat){browserNote=speakInBrowser(d.spoken);}
  document.getElementById('out').innerHTML=`<div class="card">
    <div class="row"><span class="chip" style="color:${c}">${d.level}</span>
      ${d.repeat?'<span class="chip" style="color:var(--dim)">повтор — не озвучен</span>':''}
      ${d.shouted?'<span class="chip" style="color:var(--emergency)">капс</span>':''}</div>
    <div><span class="k">почему</span><div class="mono">${d.reason}</div></div>
    ${d.hit?`<div><span class="k">в эфир</span><div class="en">${d.spoken}</div></div>`
           :`<div class="miss">Нет в словаре — текст уходит, голоса нет.</div>`}
    ${d.audition?'<div class="k">прослушка: произносится как набрано</div>':''}
    ${d.error?`<div class="miss">${d.error}</div>`:''}
    ${browserNote?`<div class="miss">${browserNote}</div>`:''}
    ${d.backend==='browser'&&d.spoken&&!d.repeat&&!browserNote?'<div class="k">говорит движок телефона — файла нет, канал не наложен</div>':''}
    ${d.clip&&!d.repeat?`<audio controls autoplay src="/audio/${d.clip}?t=${Date.now()}"></audio>`:''}
    ${d.stripped?`<div><span class="k">капс снят до модели</span><div class="mono">${d.stripped}</div></div>`:''}
    <div><span class="k">ключ словаря</span><div class="mono">${d.key}</div></div>
  </div>`;
}
document.getElementById('go').onclick=send;
document.getElementById('t').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))send()});
fetch('/api/voices').then(r=>r.json()).then(rows=>{
  BACKENDS=rows;
  const sel=document.getElementById('voice');
  sel.innerHTML=rows.map(b=>
    `<option value="${b.key}" ${b.available?'':'disabled'}>${b.label}${b.available?'':' — нет'}</option>`).join('');
  const note=()=>{const b=BACKENDS.find(x=>x.key===sel.value);
    document.getElementById('vnote').textContent=b?(b.note+(b.available?'':'  ·  '+b.install)):''};
  sel.onchange=note; note();
});
fetch('/api/seeds').then(r=>r.json()).then(rows=>{
  document.getElementById('seeds').innerHTML=rows.map(r=>
    `<button onclick="document.getElementById('t').value=this.textContent;send()">${r}</button>`).join('');
});
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    glossary: Glossary
    repeats: RepeatFilter
    bank: Path
    models_dir: Path
    tts_url: str | None
    chain: dict | None

    def log_message(self, *args) -> None:  # quiet; the console is the output
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif path == "/api/voices":
            rows = [{"key": b.key, "label": b.label, "kind": b.kind,
                     "available": b.available, "note": b.note, "install": b.install}
                    for b in voice_backends.detect(self.models_dir, self.tts_url)]
            self._send(200, json.dumps(rows, ensure_ascii=False).encode(), "application/json")
        elif path == "/api/seeds":
            rows = [e.ru for e in self.glossary._by_key.values()][:18]
            self._send(200, json.dumps(rows, ensure_ascii=False).encode(), "application/json")
        elif path.startswith("/audio/"):
            # Only ever a plain file name inside the bank - no traversal.
            name = Path(unquote(path[len("/audio/"):])).name
            clip = self.bank / name
            if clip.is_file():
                self._send(200, clip.read_bytes(), "audio/wav")
            else:
                self._send(404, b"no clip", "text/plain")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/dispatch":
            self._send(404, b"not found", "text/plain")
            return
        length = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(length) or b"{}")
        result = decide(payload.get("text", ""), self.glossary, self.repeats,
                        payload.get("channel", "r1"), self.bank)

        backend = payload.get("voice", "bank")
        result["backend"] = backend
        # The bank plays what was baked; the browser speaks client-side; anything else
        # renders now - but only when there is something to say. A glossary miss has no
        # English at all, and staying silent is the product's own behaviour.
        if backend not in ("bank", "browser") and result["spoken"] and not result["repeat"]:
            try:
                RENDER_DIR.mkdir(parents=True, exist_ok=True)
                name = f"{backend}-{abs(hash(result['spoken'])) % 10**10}.wav"
                path = voice_backends.synthesise(
                    backend, result["spoken"], RENDER_DIR / name,
                    models_dir=self.models_dir, voice=payload.get("model_voice", "am_onyx"),
                    tts_url=self.tts_url)
                voice_backends.apply_chain(path, self.chain)
                result["clip"] = name
            except Exception as exc:  # a backend that cannot must say so, not vanish
                result["error"] = f"{backend}: {exc}"
        self._send(200, json.dumps(result, ensure_ascii=False).encode(), "application/json")


def print_once(text: str, glossary: Glossary, bank: Path) -> None:
    d = decide(text, glossary, RepeatFilter(), bank=bank)
    print(f"  level    {d['level']}   ({d['reason']})")
    print(f"  glossary {'hit' if d['hit'] else 'miss - text only, no voice'}")
    if d["hit"]:
        print(f"  spoken   {d['spoken']}")
        print(f"  clip     {d['clip'] or 'not baked yet'}")
    if d["shouted"]:
        print(f"  caps off {d['stripped']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--glossary", type=Path, default=Path("glossary.json"))
    parser.add_argument("--bank", type=Path, default=DEFAULT_BANK)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--models-dir", type=Path, default=Path("."),
                        help="where kokoro-v1.0.onnx and voices-v1.0.bin live")
    parser.add_argument("--tts-url", help="an OpenAI-compatible /v1/audio/speech endpoint")
    parser.add_argument("--chain", type=Path,
                        help="chain.json from chain_fit.py - bakes your measured radio "
                             "channel onto every rendered clip")
    parser.add_argument("--once", metavar="TEXT", help="print one verdict and exit")
    args = parser.parse_args()

    glossary = Glossary.load(args.glossary)

    if args.once:
        print_once(args.once, glossary, args.bank)
        return

    Handler.glossary = glossary
    Handler.repeats = RepeatFilter()
    Handler.bank = args.bank
    Handler.models_dir = args.models_dir
    Handler.tts_url = args.tts_url
    Handler.chain = (json.loads(args.chain.read_text(encoding="utf-8"))["chain"]
                     if args.chain and args.chain.exists() else None)

    baked = len(list(args.bank.glob("*.wav"))) if args.bank.is_dir() else 0
    print(f"{len(glossary)} entries, {baked} baked clips in {args.bank}/")
    for b in voice_backends.detect(args.models_dir, args.tts_url):
        print(f"  {'available' if b.available else '  --     '}  {b.key:8s} {b.label}")
    if Handler.chain:
        print(f"  measured channel from {args.chain} will be baked onto rendered clips")
    print(f"open  http://localhost:{args.port}")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
