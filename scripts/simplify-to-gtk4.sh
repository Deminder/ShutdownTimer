#!/bin/sh
# xml created with glade 3.38.2 (does not suppport gtk4)
cd ShutdownTimer@neumann/templates || exit
gtk4-builder-tool simplify --3to4 pref-window.ui > pref-window-gtk4.ui
if [[ "$1" == "show" ]]; then
	gtk4-builder-tool preview pref-window-gtk4.ui
fi
