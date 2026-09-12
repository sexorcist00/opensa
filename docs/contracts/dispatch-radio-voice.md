# Contract — the spoken radio

What PCAD's backend adds to a radio transmission so that both clients can speak it, and what each side is
required to do when a field is missing. Its neighbour in this folder is [dispatch-map.md](dispatch-map.md);
the design behind it, and the decisions it encodes, are in
[the dispatch-tts concept](../concepts/dispatch-tts/readme.md).

**Why this is a contract rather than an implementation detail.** Three codebases have to agree — the Node
backend that synthesises, the MoonLoader client that plays in game, and the web console that plays in the
browser — and they ship separately. **Every field below is optional by construction**, so a client that
knows nothing about voice keeps working exactly as it does today. That is the property that makes this
shippable without a flag day, and it is also the property that makes a mistake silent: a client that ignores
a field it should have read looks identical to one that was never sent it.

## 1. The payload

Today the backend sends, unchanged since before this feature
(`RadioService.preparePhantomBroadcastPayload`):

```json
{ "type": "radio_broadcast",
  "payload": { "channelId": "r1", "sender": "John Smith", "text": "…", "isPhantom": true } }
```

`text` **stays exactly as it is** — the Russian the operator typed, in UTF-8. Decision 6: the screen keeps
Russian, and English exists only as sound. A client that renders `text` needs no change and must not be
given a translated string in that field.

Voice adds three optional fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `voiceId` | string | which voice spoke it, so a client can label or filter. Stable per user |
| `audio` | object | present only when audio exists for this transmission |
| `spoken` | string | the English that was actually synthesised — **for diagnostics, never for display** |

```json
{ "type": "radio_broadcast",
  "payload": {
    "channelId": "r1", "sender": "John Smith", "text": "…", "isPhantom": true,
    "voiceId": "dispatch-1",
    "spoken": "One Adam Twelve, respond to Grove Street and Main, fight in progress.",
    "audio": { "url": "/radio/audio/9f3c…mp3", "seq": 41827, "durationMs": 4470, "level": "routine",
               "source": "bank" }
  } }
```

| `audio` key | Meaning |
| --- | --- |
| `url` | where to fetch it. Same origin, same auth as the rest of the API |
| `seq` | the transmission this audio belongs to — see §2, this is the whole of the late-arrival story |
| `durationMs` | so a client can size a progress indicator without fetching |
| `level` | `routine` \| `urgent` \| `emergency` — what the classifier decided, or what the operator's caps forced |
| `source` | `bank` (a dictionary hit, pre-baked) or `live` (synthesised for this transmission) |

## 2. Two messages, and `seq` is what joins them

Decision 8: **a dictionary hit is published with the text; a miss publishes the text immediately and the
audio follows.** So a client sees one of two sequences:

- **hit** — one `radio_broadcast` carrying `audio`. Play it.
- **miss** — a `radio_broadcast` with **no** `audio`, then later a `radio_audio` message:

```json
{ "type": "radio_audio",
  "payload": { "channelId": "r1", "seq": 41827,
               "audio": { "url": "…", "durationMs": 3120, "level": "urgent", "source": "live" } } }
```

**`seq` is required on every transmission that may acquire audio later**, including the hit case, and it is
the backend's own counter — not a timestamp and not the message id, because two transmissions can share a
millisecond and a reconnect can renumber messages. A client keeps recent `seq` values and matches; one that
does not is a client where the voice arrives detached from the line that produced it, and nothing reports
it.

**A late `radio_audio` for a transmission the client never saw is dropped.** It is not an error: the client
may have connected in between.

**There is no third message.** If synthesis fails, times out, or the daily budget is spent, **nothing is
sent** (decision 11: silence plus text, never a substitute phrase). A client must therefore never wait on
audio — no spinner that outlives the transmission, no queue that stalls behind a missing clip.

## 3. What a client must do

**Both clients**: play the file the backend sent, and nothing else. Do not synthesise, do not translate, do
not re-order, do not mix by position (decision 16 — on the map the radio is a device on the desk, flat mono,
so no audio graph and no listener pose enters the map component).

**Playback is serialised per channel.** Two transmissions that overlap in wall time are played one after the
other, because a radio channel is half duplex and two voices at once is the one artefact that makes an
otherwise good rendering sound fake. A clip that would start more than `staleAfterMs` (default 15 000) after
its transmission is dropped rather than played late.

**In game** (`_cadparserradio.lua`): fetch with `downloadUrlToFile` and play from disk with
`loadAudioStream`. **Never pass a URL to `loadAudioStream`** — it blocks the game thread while it fetches,
which is a freeze the player will blame on the radio. Volume comes from the existing `radioVolume` in
`lspdradio_settings.txt`, so the canned bank and the spoken line stay balanced.

**In the browser**: an `<audio>` element is enough. The console reads the same fields.

## 4. The dictionary

A dictionary entry is what makes a transmission free and instant, and it is the only path that reaches audio
without a model.

```json
{ "ru": "принял, буду через две минуты",
  "en": "Ten four, en route, two minutes out.",
  "level": "routine",
  "match": "exact" }
```

| Key | Rule |
| --- | --- |
| `ru` | matched **lowercased, trimmed, with runs of whitespace collapsed and trailing punctuation dropped**. Nothing else is normalised — a match must stay something a human can predict by looking |
| `en` | what is spoken. Written by a person, not generated |
| `level` | pins the urgency, overriding the classifier |
| `match` | `exact` today. Any other value is ignored, so an entry using a future mode is inert rather than wrong |

**The bank is keyed by `(entry, voiceId, modelVersion)`.** Dropping `modelVersion` is the silent failure the
concept names: the first use of a phrase in a voice is synthesised live and kept forever, so when the model
changes underneath, some phrases come from the old bank and some from the new one, and it presents as the
radio being inconsistent rather than as a cache being stale.

**Auto-suggested entries are not entries.** A phrase repeated N times is written to a review queue and does
nothing until a person approves it (decision 14). An unreviewed suggestion that could speak would let any
player put words in the dictionary by repeating them.

## 5. What the translator is required not to do

The register is **literal translation plus speech normalisation** (decision 4). Stated as rules because
"literal" is not self-enforcing:

- **No fact may be added.** Not an address, not a code, not a unit, not a reason. If the operator did not
  say it, it is not spoken. This is the rule with no automatic guard — the audio is English, the screen is
  Russian, and nobody will notice the voice sending a unit to a street the operator never named.
- **Names, callsigns and vehicle models pass through untranslated.** `Sultan` stays `Sultan`.
- **Numbers are spoken, not read.** `1-Адам-12` → `One Adam Twelve`; `код 4` → `code four`. A callsign is
  digit-by-digit; a code keeps its number as a word.
- **ALL CAPS is the operator speaking, not shouting text.** Caps set `level` to `emergency` and are stripped
  before synthesis, so the model is never handed uppercase to interpret.
- **An empty or unintelligible result is silence**, per §2. It is never passed through as the Russian
  original in a Latin transliteration.

## 6. When a field is spelled wrong

The table this contract exists for. Every row is silent unless marked.

| Mistake | What happens |
| --- | --- |
| `audio.url` present, file 404s | client plays nothing. **Silent** — indistinguishable from a transmission that had no audio |
| `seq` omitted on a miss | the later `radio_audio` matches nothing and is dropped. **Silent**, and it looks like synthesis being slow |
| `seq` reused across channels | audio plays on the wrong channel. **Silent**, and it reads as the dispatcher talking on a frequency they did not use |
| `spoken` rendered on screen | the operator sees English where decision 6 says Russian. Caught by eye, immediately |
| `level` omitted | treat as `routine`. Never guess from the text — the classifier already ran, and a second opinion in the client is a second answer nobody compares |
| `text` replaced by the translation | every Russian-speaking player loses the content of the order. Caught by eye, immediately |
| `voiceId` unknown to the client | play the audio anyway. The field labels; it never gates |
