#!/bin/bash

set -e

if [ ! -z "$1" ]; then
    SSHADDR="$1"
fi
SSHCMD=ssh
# maybe source env file
[ ! -f guest-ssh.env ] || . guest-ssh.env

if [ -z "$SSHADDR" ]; then
    echo Missing guest ssh address >&2
    exit 1
fi

# build with debugMode enabled
./scripts/build.sh -d
UUID=$(grep uuid metadata.json | cut -d\" -f 4)
ZIPFILE="$UUID".shell-extension.zip
rsync -e "$SSHCMD" "$ZIPFILE" "${SSHADDR}:~/Downloads/"
$SSHCMD "$SSHADDR" "gnome-extensions install --force ~/Downloads/$ZIPFILE && killall -SIGQUIT gnome-shell"
