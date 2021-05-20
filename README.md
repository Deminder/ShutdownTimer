# Shutdown Timer

Shutdown your device after a specific time. This extension adds a submenu to the status area. 

![Screenshot](screenshot.png)


There is a settings menu where you can change the following:
* Maximum timer value
* Slider position
* Root mode: Uses "pkexec shutdown" command instead of default GNOME shutdown dialog. If monitor turns off while shutdown timer is running, then default timer in rootless mode gets interrupted.
  With root mode activated this can not happen, but you have to enter the root password.

## Official Installation

Visit [https://extensions.gnome.org/extension/792/shutdowntimer/](https://extensions.gnome.org/extension/792/shutdowntimer/) and follow browser extension install instructions.


## Manual Installation

Copy `ShutdownTimer@neumann` directory to `~/.local/share/gnome-shell/extensions`
```
$ cp -r ShutdownTimer@neumann ~/.local/share/gnome-shell/extensions
```


Install `gnome-shell-extensions`
```
$ sudo apt install gnome-shell-extensions
```

Open GNOME tweak tool and enable `Shutdowntimer` in extensions menu.
```
$ gnome-tweaks
```

### For GNOME 40+
Install `org.gnome.Extensions` via flatpak
```
$ flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
$ flatpak install flathub org.gnome.Extensions
```

Open GNOME shell extension tool
```
$ flatpak run org.gnome.Extensions
```

## Development

### Restart GNOME-Shell (Xorg only)
Press `ALT+F2`, type `r` and press `Enter`

### See Errors and Logs
Press `ALT+F2`, type `lg` and press `Enter`

