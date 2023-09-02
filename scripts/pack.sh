#!/bin/bash

# SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Adapted from JustPerfection 2021 by Javad Rahmatzadeh

set -e

targetdir="."
while getopts "dt:" flag; do
    case $flag in
        d)
            DEBUG=1
            ;;
        t)
            targetdir=${OPTARG}
            ;;
        h|*)  
            echo "ERROR: Invalid flag!"
            echo "Use '-d' to pack with debug enabled."
            echo "Use '-t <path>' to change target dir. (default: .)"
            exit 1
            ;;
    esac
done

# cd to the repo root
cd "$( cd "$( dirname "$0" )" && pwd )/.."

function setDebugMode() {
    [[ "$1" = "true" ]] && local negation="false" || local negation="true"
    local file=src/modules/util.js
    local mtime=$(stat -c %y "$file")
    sed -i "s/const debugMode = $negation;/const debugMode = $1;/g" "$file"
    touch -d "$mtime" "$file"
}

if [ ! -z "$DEBUG" ]; then
    echo "Enabling debugMode..."
    trap "setDebugMode false" EXIT
    setDebugMode "true"
fi

echo "Packing extension..."
gnome-extensions pack src \
    --force \
    --podir="../po" \
    --extra-source="bin" \
    --extra-source="modules" \
    --extra-source="icons" \
    --extra-source="ui" \
    --extra-source="tool" \
    --extra-source="polkit" \
    --extra-source="../LICENSES" \
    --extra-source="../CHANGELOG.md" \
    --out-dir="$targetdir"

uuid=$(grep uuid src/metadata.json | cut -d\" -f 4)
zipfile="${targetdir}/${uuid}.shell-extension.zip"
zip -d "$zipfile" ui/#prefs.ui# ui/prefs.ui~ || true
echo "Packing Done!"

