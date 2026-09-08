# Font licences

Every font shipped in `public/fonts/` is a Google Fonts release, redistributed here under its
upstream licence. The full licence text for each family lives in `public/fonts/licenses/`, copied
verbatim from the [google/fonts](https://github.com/google/fonts) repository by
`scripts/fetch-fonts.sh`.

| Family | Files | Licence | Licence text | Source |
| --- | --- | --- | --- | --- |
| Fredoka | `Fredoka-Regular.ttf`, `Fredoka-Bold.ttf` | SIL Open Font License 1.1 | `licenses/Fredoka.txt` | https://github.com/hafontia-zz/Fredoka-One (upstream of https://github.com/google/fonts/tree/main/ofl/fredoka) |
| Baloo 2 | `Baloo2-Regular.ttf`, `Baloo2-Bold.ttf`, `Baloo2-ExtraBold.ttf` | SIL Open Font License 1.1 | `licenses/Baloo2.txt` | https://github.com/yanone/Baloo2-Variable (upstream of https://github.com/google/fonts/tree/main/ofl/baloo2) |
| Bangers | `Bangers.ttf` | SIL Open Font License 1.1 | `licenses/Bangers.txt` | https://github.com/google/fonts/tree/main/ofl/bangers |
| Lilita One | `LilitaOne.ttf` | SIL Open Font License 1.1 | `licenses/LilitaOne.txt` | https://github.com/google/fonts/tree/main/ofl/lilitaone |
| Chewy | `Chewy.ttf` | Apache License 2.0 | `licenses/Chewy.txt` | https://github.com/google/fonts/tree/main/apache/chewy |
| Luckiest Guy | `LuckiestGuy.ttf` | Apache License 2.0 | `licenses/LuckiestGuy.txt` | https://github.com/google/fonts/tree/main/apache/luckiestguy |

google/fonts publishes Fredoka and Baloo 2 as variable fonts only. We need static instances (skia
ignores a variable font's `wght` axis), so those two families are taken from the upstream
repositories google/fonts packages from, at the commit each family's `METADATA.pb` names — the same
designers, the same version, the same OFL text, unmodified.

Both licences permit redistribution and embedding in printed products. The OFL additionally
forbids selling the font files on their own and requires that any modified version be renamed;
we ship the files unmodified.

Re-download everything (fonts and licence texts) with `scripts/fetch-fonts.sh`.
