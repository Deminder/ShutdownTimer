# Shutdown Timer

Shutdown/reboot/suspend your device after a specific time. This extension adds a submenu to the status area. 

![Screenshot](screenshot.png)

## Features
- Poweroff, Reboot, Suspend (options can reordered and disabled)
- Show scheduled shutdown info as *(sys)* (fetched from `/run/systemd/shutdown/scheduled`)

- Root mode (this *may* trigger a password prompt with `pkexec`)
  - Protection against gnome-shell failing by scheduling `shutdown ${REQUESTED_MINUTES + 1}`
  - Only requires root password once (keep `pkexec` process open as long as extension is enabled)

- Check command
  - Runs a shell command and will only continue shutdown if command succeeds
  - Check command can be canceled

## Official Installation

Visit [https://extensions.gnome.org/extension/792/shutdowntimer/](https://extensions.gnome.org/extension/792/shutdowntimer/) and follow browser extension install instructions.


## Manual Installation

Requires `gnome-shell-extensions` and `gtk4-builder-tool`:
```(shell)
./scripts/build.sh -i
```
Then a new login is required.

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

### Start nested GNOME-Shell (Wayland)
`dbus-run-session -- gnome-shell --nested --wayland`

### See Errors and Logs
* Press `ALT+F2`, type `lg` and press `Enter`
* Run `journalctl -f` in terminal

