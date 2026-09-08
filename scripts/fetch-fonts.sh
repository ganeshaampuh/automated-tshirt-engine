#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../public/fonts"
base=https://raw.githubusercontent.com/google/fonts/main
curl -sSLo Fredoka.ttf     "$base/ofl/fredoka/Fredoka%5Bwdth%2Cwght%5D.ttf"
curl -sSLo Baloo2.ttf      "$base/ofl/baloo2/Baloo2%5Bwght%5D.ttf"
curl -sSLo Chewy.ttf       "$base/apache/chewy/Chewy-Regular.ttf"
curl -sSLo Bangers.ttf     "$base/ofl/bangers/Bangers-Regular.ttf"
curl -sSLo LilitaOne.ttf   "$base/ofl/lilitaone/LilitaOne-Regular.ttf"
curl -sSLo LuckiestGuy.ttf "$base/apache/luckiestguy/LuckiestGuy-Regular.ttf"
ls -la
