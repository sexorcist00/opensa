# Cutscene Converter 0.4.0

GTA: San Andreas shows your cars twice — once when you drive them, and once in its cutscenes. Installing a
car mod only changes the first one. The cutscenes keep the 2004 models, so the car you have been driving all
game turns back into a stock one the moment a scene starts.

This app fixes the second half. Pick your game, pick the folder of car mods you already use, pick somewhere
to put the result, and a few seconds later you have the three files that put your cars into the cutscenes.

**It does not touch how you play.** Which cars you install for gameplay is your business and stays exactly as
you set it up — this app never writes into your game folder at all.

- **Download:** <http://gooddev.org/gta/cutscene-converter.zip> — a portable `.exe`, nothing to install, ~85 MB.
- **This page describes version 0.4.0.** Each version has its own page; use the one that matches the app.

## Before you start

| | |
| --- | --- |
| **The game** | GTA: San Andreas **1.0 US** — `gta_sa.exe`, 14 383 616 bytes, sha1 `8c23ceffafa9fd88ea567be7926a33413b8e3c00`. The app checks this and refuses anything else, for a reason worth reading below. |
| **Mods** | A modded game is fine — expected, even. The app reads your game; it does not care what else is installed. |
| **An ASI loader** | The result includes a small plugin (`perfect-cutscene.asi`). It loads through whatever ASI loader your install already has — if you run CLEO, SilentPatch, ModLoader or any `.asi` mod, you have one. A clean install with no `.asi` files at its root does not, and the plugin will simply never load. |
| **Disk space** | About 1 GB free where you put the result. The app warns you if there is less. |
| **Your cars** | A folder with one subfolder per car, each holding that car's `.dff` and `.txd`. |

### Why the exe version is a hard stop

The plugin patches one exact build of the game. On any other one, the conversion still finishes and looks
perfectly fine — and then, in the game, actors sitting behind car windows disappear. That failure arrives
hours later and looks like something else entirely, so the app refuses at the moment you pick the folder
instead of letting you find out the hard way.

## Windows will warn you

The app is not code-signed, so SmartScreen shows **"Windows protected your PC"** the first time you run it.
Click **More info → Run anyway**.

That warning means "this file has no certificate", not "this file is dangerous" — a certificate is a
recurring bill, and this is a free tool. If you would rather not take our word for it, the source is in the
open and you can build the exe yourself.

## The three steps

### 1. Pick your game

The folder with `gta_sa.exe` — **the install you actually play**, not a clean copy kept aside. The cars come
from your mods folder, but the paint colours are read from the game's own `data/carcols.dat`, so pointing at
a stock copy gives you cutscene cars painted differently from the ones you drive. The app reads seven files out of it — `anim/cuts.img`, `data/carcols.dat`,
`data/txdcut.ide`, `data/vehicles.ide`, `models/cutscene.img`, `models/generic/vehicle.txd` and
`models/gta3.img` — and says so if one is missing, naming the file.

### 2. Pick your cars

**One subfolder per car.** That is not a matter of tidiness: the app reads the subfolders of the folder you
pick, so models dropped straight into it are read by nothing at all. If you do that, the app says so rather
than leaving you to wonder.

```
my-cars/
  bobcat - 1988 GMC Sierra 1500/
    bobcat.dff
    bobcat.txd
  taxi - 1992 Chevrolet Caprice/
    taxi.dff
    taxi.txd
```

**Inside a folder, the file names decide the car**: `bobcat.dff` + `bobcat.txd` is what puts a car into the
Bobcat's cutscene slot. Use the game's model name, which is often shorter than the real one — `greenwoo`,
`remingtn`, `washing`, `securica`. A `.dff` with no `.txd` beside it cannot be converted, and is reported.

**The folder name matters too, but for a different reason**: everything before the first ` - ` is the slot
the folder claims, so two folders starting with the same word are refused as a duplicate claim. Name them
the way the example does and this never comes up.

The app then tells you **how many of the 23 cutscene slots your folder covers**. Fewer than all of them is
not an error — the slots you do not cover keep their stock cars. A car with no `.txd` beside its `.dff` is
reported as incomplete, because the conversion has nothing to take its textures from.

### Which cars have cutscene slots

21 folders can matter, and they cover 23 cutscene models (`copcarla` and `zr350` each appear in two scenes):

```
bobcat    bravura   burrito   camper    copcarla  copcarsf  dinghy
firela    glendale  greenwoo  monster   mtbike    remingtn  sabre
sadler    savanna   securica  taxi      voodoo    washing   zr350
```

Anything else in your cars folder is simply ignored — that car has no cutscene to appear in. `camper` is the
one to know: in the cutscenes it is the Truth's Mothership.

### 3. Pick where to put the result

An empty folder of your own. **Nothing is written into your game** — that copy is yours to make, after you
have looked at what came out. The app refuses an output folder that IS the game folder.

Then press **Convert**. It takes a few seconds; the app says when it is finished and how long it took.

## Installing the result

The output folder holds four things:

```
models/cutscene.img     the cutscene vehicle models
data/txdcut.ide         the cutscene texture definitions
anim/cuts.img           the cutscene animations
perfect-cutscene.asi    the plugin
```

**Back up the first three from your game first** — they are complete replacements for the game's own files,
so keep a copy of the originals if you want a way back. Then:

1. Copy `models/cutscene.img`, `data/txdcut.ide` and `anim/cuts.img` into your game, over the files of the
   same name.
2. Copy `perfect-cutscene.asi` into the game's root folder, beside `gta_sa.exe`.

Start the game and watch any cutscene with a car in it.

### What the plugin is for

Cutscene cars in the original game have no glass in their windows at all — that is how R\* avoided the
problem, by authoring it away. A modded car brings its real, tinted glass along, and the game's cutscene
renderer draws it in a way that erases every actor behind it: an empty driver's seat in a scene that clearly
has someone in it.

`perfect-cutscene.asi` gives cutscene cars the same depth-sorted glass the game already gives cars you drive.
**Without it the cars look right and the people vanish**, so it ships with every conversion rather than as an
option.

## When something goes wrong

| What the app says | What it means |
| --- | --- |
| *The game folder is missing `<file>`* | That is not a San Andreas folder, or the install is incomplete. |
| *`gta_sa.exe` is not the version we support* | See above — the plugin patches one build only. The message names the size and sha1 you need. |
| *The cars are loose files, not one folder per car* | The models are sitting in the folder itself. Give each car its own subfolder. |
| *0 of 23 cutscene slots are covered* | The folders are right, but nothing in them matches a cutscene slot — check the `.dff` names against the list above. |
| *`<car>` is incomplete* | A `.dff` with no `.txd` beside it. |
| *The output folder is the game folder* | Pick somewhere else; installing is a step you take by hand. |
| *The output folder cannot be written to* | Choose a folder you own — not one under `Program Files`. |
| *The converter stopped with code N* | The lines above it in the log say where. Send them with a bug report. |

## Reporting a bug

The line at the bottom of the app names everything a report needs: the app version, the exact build it was
made from, and the sha1 of the plugin inside it. Send that line, plus the log if a run failed.
