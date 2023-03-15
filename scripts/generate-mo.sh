#!/bin/bash

# SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Adapted from JustPerfection 2021 by Javad Rahmatzadeh

set -e

# cd to the repo root
cd "$( cd "$( dirname "$0" )" && pwd )/.."

[ "$#" -ge 1 ] && PO_FILES="$@" || PO_FILES=po/*.po

for filename in $PO_FILES;
do
    lang=$(basename "$filename" .po)
    moPath="src/locale/$lang/LC_MESSAGES/ShutdownTimer.mo"
    mkdir -p "src/locale/$lang/LC_MESSAGES"
    msgfmt "$filename" --output-file="$moPath" && echo "$lang [OK]" || 
    	echo "ERROR: Failed to generate '$lang.po'."
done


