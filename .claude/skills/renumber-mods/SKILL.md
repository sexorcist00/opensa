---
name: renumber-mods
description: Close numbering gaps in mods-src/original/mods after a mod is deleted — rename "N. Name" folders to a contiguous 0..K sequence preserving install order. Use when the user deleted a mod folder and wants the numbering compacted.
---

# Renumber mod folders

Mod folders under `mods-src/original/mods/` are named `<number>. <name>` and the number IS the install order
(the mod-installer applies them ascending). Deleting a mod leaves a gap; this skill compacts the
sequence to `0..K` while preserving the relative order. Renumbering never changes the install result —
only the labels.

## Steps

1. List the current state and show the gaps:

   ```bash
   ls "mods-src/original/mods/" | sort -n
   ```

2. Compact in ASCENDING order (targets are always below the source number, so no collision is
   possible). Only rename folders whose number differs from their index:

   ```bash
   cd mods-src/original/mods
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
- A deleted/renumbered mod set changes the build baseline: the next pmb run re-baselines, and any
  perf/size comparison against older runs must say which mod set the pak was built from
  (`docs/benchmarks/` rule).
- Historical docs/memory may reference old numbers (e.g. "39. Green Piece") — those are records of
  past states, do NOT edit them.
- If the user deleted the mod's folder only partially (kept some files), confirm the leftover is
  intentional before renumbering around it.
