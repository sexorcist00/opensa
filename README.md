<p align="center">
  <img src="./assets/logo-repo.png" alt="OpenSA — an open-source game engine compatible with RenderWare, in the browser" width="420" />
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-2a7ae2" alt="License: AGPL-3.0" /></a>
</p>

> **This is a modified fork of [AlexSergey/opensa](https://github.com/AlexSergey/opensa),
> forked 2026-08-04 and modified since.** It is not the upstream project and is not maintained
> by it. Upstream's website, demo, trailer and blog are not this repository's.

An open-source, from-scratch, high-performance **game engine, built compatible with RenderWare** — the engine
behind GTA San Andreas. Bring your own game files (or a total-conversion mod) and it streams the real world,
models and physics straight into the browser, with no install.

**It is not a reimplementation.** Compatibility is how your files get in, not the ceiling for what happens
next. San Andreas shipped in 2004 against a 32 MB console budget; OpenSA reads its data honestly and then does
the job the way modern hardware allows — its own streaming, generated far LODs the original never had, a
WebGPU renderer, and none of the object-count limits that corrupt a large map. Where we can beat the original,
we do; where we keep its behaviour, we say why. The target is an AAA-grade engine and a world worth driving
through — the goals, and the rules that keep them honest, are in
[docs/project-goals.md](./docs/project-goals.md).

> Unofficial, non-commercial fan project. Not affiliated with Rockstar Games or Take-Two.

## Contributing

Contributions are welcome - see **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, the dev workflow, and
conventions. First-time asset setup: [docs/development/getting-started.md](./docs/development/getting-started.md).

## License

Copyright (c) 2026 Aleksandrov Sergey — upstream OpenSA
Copyright (c) 2026 <YOUR NAME> — changes in this fork

The OpenSA source code is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0). You may use, modify and redistribute it under the terms of that license; if
you run a modified version as a network service, you must offer its source to users. See
[LICENSE](./LICENSE) for the full text.

**This license covers only the original OpenSA code.** GTA San Andreas assets, models,
maps, names and trademarks are the property of Rockstar Games / Take-Two Interactive and
are **not** covered by it or distributed with this project. OpenSA is an unofficial,
non-commercial fan project, not affiliated with Rockstar Games or Take-Two.

## Legal & takedowns

OpenSA is an **experiment** and an unofficial, **non-commercial fan project**. It is **not affiliated with,
endorsed by, or sponsored by Rockstar Games or Take-Two Interactive**, and it is **not** a way to obtain,
copy, or redistribute their games — it's an alternative way to run a copy you already own.

- **No game assets are included or distributed in this repository.** To run the engine you must supply files
  from your own legitimate copy of the game (or a community mod you have the right to use).
- "Grand Theft Auto", "GTA", "San Andreas", RenderWare, and related names, logos and trademarks belong to
  their respective owners. They are used here **only descriptively**, to state what the engine is compatible
  with — not as branding.

If you are a rights holder and believe anything in **this repository** infringes your rights, please
contact its maintainer at <YOUR CONTACT — an address you read; issues are disabled here>, and it will
be reviewed in good faith and, where appropriate, the material **removed promptly**. For the upstream
project, see <https://github.com/AlexSergey/opensa>.
