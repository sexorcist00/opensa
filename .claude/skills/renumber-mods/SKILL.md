---
name: renumber-mods
description: Close numbering gaps in a game's mods-src/<game>/mods after a mod is deleted — rename "N. Name" folders to a contiguous 0..K sequence preserving install order. Use when the user deleted a mod folder and wants the numbering compacted. Takes the game as an argument (e.g. "gostown"); "all" does every game.
---

# Renumber mod folders

Mod folders under `mods-src/<game>/mods/` are named `<number>. <name>` and the number IS the install order
(the mod-installer applies them ascending). Each game has its OWN independent numbering. Deleting a mod
leaves a gap; this skill compacts one game's sequence to `0..K` while preserving the relative order.
Renumbering never changes the install result — only the labels.

## Which game

The skill operates on ONE game's `mods` folder (numbering is per-game, so never renumber across games).

- If the user named a game (e.g. "gostown", "original", "carcer"), use `mods-src/<game>/mods`.
- If the user said "all", loop the block below over every `mods-src/*/mods` — each game independently.
- If no game was given, list the candidates and ask which one:

  ```bash
  ls -d mods-src/*/mods
  ```

## Steps (per game)

Set `GAME` to the target and run the block. For "all", wrap it in
`for GAME in $(ls -d mods-src/*/mods | sed 's#mods-src/##;s#/mods##'); do ... done`.

1. List the current state and show the gaps:

   ```bash
   GAME=gostown
   ls "mods-src/$GAME/mods/" | sort -n
   ```

2. Compact in ASCENDING order (targets are always below the source number, so no collision is
   possible). Only rename folders whose number differs from their index:

   ```bash
   cd "mods-src/$GAME/mods"
   i=0
   ls | sort -n | while IFS= read -r dir; do
     name="${dir#*. }"
     target="$i. $name"
     if [ "$dir" != "$target" ]; then
       mv "$dir" "$target"
       echo "renamed: $dir -> $target"
     fi
     i=$((i + 1))
   done
   ```

3. Verify: `ls | sort -n` must show a contiguous `0..K` with no duplicates and the same folder count
   as before.

## Notes

- `mods-src/` is NOT under git — plain `mv`, nothing to commit for the rename itself.
- A deleted/renumbered mod set changes that game's build baseline: the next pmb run re-baselines, and any
  perf/size comparison against older runs must say which game AND mod set the pak was built from
  (`docs/benchmarks/` rule).
- Historical docs/memory may reference old numbers (e.g. "39. Green Piece") — those are records of
  past states, do NOT edit them.
- If the user deleted the mod's folder only partially (kept some files), confirm the leftover is
  intentional before renumbering around it.
