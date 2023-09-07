#!/bin/bash

# SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Adapted from JustPerfection 2021 by Javad Rahmatzadeh

set -e

# cd to the repo root
cd "$( cd "$( dirname "$0" )" && pwd )/.."

xgettext \
    --from-code=UTF-8 \
    --copyright-holder="Shutdown Timer" \
    --package-name="Shutdown Timer" \
    --package-version="r`grep -oP '^ *?\"version\": *?\K(\d+)' src/metadata.json`" \
    --keyword="gtxt" \
    --keyword="_n:1,2" \
    --keyword="C_:1c,2" \
    --output="po/main.pot" \
    src/*.js src/modules/*.js src/**/*.sh src/ui/prefs.ui src/schemas/*.xml

for file in po/*.po
do
    echo -n "Updating $(basename "$file" .po)"
    msgmerge -U "$file" po/main.pot
  
    if grep --silent "#, fuzzy" "$file"; then
        fuzzy+=("$(basename "$file" .po)")
    fi
done

if [[ -v fuzzy ]]; then
    echo "WARNING: Translations have unclear strings and need an update: ${fuzzy[*]}"
fi

