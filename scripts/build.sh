#!/bin/bash
NAME=ShutdownTimer@neumann
cd "$NAME" || exit
glib-compile-schemas schemas/
gtk4-builder-tool simplify --3to4 ui/pref-window.ui > ui/pref-window-gtk4.ui

gnome-extensions pack \
	--force \
	--extra-source="ui"

# Source: https://gitlab.gnome.org/jrahmatzadeh/just-perfection/-/blob/master/scripts/build.sh
echo "Packing Done!"

while getopts i flag; do
    case $flag in

        i)  gnome-extensions install \
            --force ${NAME}.shell-extension.zip && \
            echo "Extension is installed. Now restart the GNOME Shell." || \
            { echo "ERROR: Could not install the extension!"; exit 1; };;

        *)  echo "ERROR: Invalid flag!"
            echo "Use '-i' to install the extension to your system."
            echo "To just build it, run the script without any flag."
            exit 1;;
    esac
done

