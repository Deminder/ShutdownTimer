#!/bin/bash

# SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later

set -e

# release should be on master branch
[[ `git branch --show-current` == 'master' ]] || ( echo "Expected branch: master" >&2 && exit 1 )

# cd to the repo root
cd "$( cd "$( dirname "$0" )" && pwd )/.."

reuse lint
npm run format

VPATTERN='^ *?\"version\": *?'
METADATA_FILE=src/metadata.json
VERSION=$(( 1 + `grep -oP "$VPATTERN"'\K(\d+)' "$METADATA_FILE"` ))
echo "New version: $VERSION"
sed -Ei "s/($VPATTERN)([0-9]+)(.*)/\1$VERSION\3/" "$METADATA_FILE"
git add "$METADATA_FILE"

# update translations
./scripts/update-pod.sh
git add po

git commit -am "Bump version to $VERSION"
git tag -a "r$VERSION" -m "Release version $VERSION"
