/**
    AUTHOR: Daniel Neumann, Deminder
    GJS SOURCES: https://github.com/GNOME/gnome-shell/
    BUILD: ./scripts/build.sh
    UPDATE TRANSLATIONS: ./scripts/update-pod.sh
**/

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { InfoFetcher, RootMode, Timer, Convenience } = Me.imports.lib;
const logDebug = Convenience.logDebug;

/* IMPORTS */
const { GObject, GLib, St, Gio, Clutter } = imports.gi;

// screen and main functionality
const Main = imports.ui.main;

// menu items
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const Switcher = imports.ui.switcherPopup;
const PadOsd = imports.ui.padOsd;

// translations
const Gettext = imports.gettext.domain("ShutdownTimer");
const _ = Gettext.gettext;

/* GLOBAL VARIABLES */
let textbox,
  shutdownTimerMenu,
  separator,
  settings,
  checkCancel,
  installCancel,
  idleMonitor;

const MutterIdleMonitorInf =
  '<node>\
  <interface name="org.gnome.Mutter.IdleMonitor">\
    <method name="GetIdletime">\
      <arg type="t" name="idletime" direction="out"/>\
    </method>\
  </interface>\
</node>';
const MutterIdleMonitorProxy =
  Gio.DBusProxy.makeProxyWrapper(MutterIdleMonitorInf);

let initialized = false;
var MODE_LABELS;
var WAKE_MODE_LABELS;
var MODE_TEXTS;

class ScheduleInfo {
  constructor({ mode = "?", deadline = -1, external = false }) {
    this._v = { mode, deadline, external };
  }

  copy(vals) {
    return new ScheduleInfo({ ...this._v, ...vals });
  }

  get deadline() {
    return this._v.deadline;
  }

  get external() {
    return this._v.external;
  }

  get mode() {
    return this._v.mode;
  }

  get scheduled() {
    return this.deadline > -1;
  }

  get secondsLeft() {
    return this.deadline - GLib.DateTime.new_now_utc().to_unix();
  }

  get minutes() {
    return Math.floor(this.secondsLeft / 60);
  }

  get modeText() {
    return this.mode in MODE_TEXTS
      ? MODE_TEXTS[this.mode]
      : MODE_TEXTS["poweroff"];
  }

  get label() {
    let label = _("Shutdown Timer");
    if (this.scheduled) {
      label =
        `${durationString(this.secondsLeft)} ${_("until")} ${this.modeText}` +
        (this.external ? " " + _("(sys)") : "");
    }
    return label;
  }

  isMoreUrgendThan(otherInfo) {
    return (
      !otherInfo.scheduled ||
      (this.scheduled && this.deadline < otherInfo.deadline)
    );
  }
}

// show textbox with message
function _showTextbox(textmsg) {
  if (!settings.get_boolean("show-textboxes-value")) {
    return;
  }
  if (!textbox) {
    textbox = new St.Label({
      style_class: "textbox-label",
      text: "Hello, world!",
    });
    Main.uiGroup.add_actor(textbox);
  }
  textbox.text = textmsg;
  textbox.opacity = 255;
  let monitor = Main.layoutManager.primaryMonitor;
  textbox.set_position(
    Math.floor(monitor.width / 2 - textbox.width / 2),
    Math.floor(monitor.height / 2 - textbox.height / 2)
  );
  textbox.ease({
    opacity: 0,
    delay: 3000,
    duration: 1000,
    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    onComplete: _hideTextbox,
  });
}

function _hideTextbox() {
  Main.uiGroup.remove_actor(textbox);
  textbox = null;
}

async function maybeStopRootModeProtection(info, stopScheduled = false) {
  if (
    (stopScheduled || !info.scheduled) &&
    settings.get_boolean("root-mode-value")
  ) {
    logDebug("Stop root mode protection for: " + info.mode);
    try {
      switch (info.mode) {
        case "poweroff":
        case "reboot":
          await RootMode.shutdownCancel();
          break;
        default:
          logDebug("No root mode protection stopped for: " + info.mode);
      }
    } catch (err) {
      guiIdle(() =>
        _showTextbox(_("Root mode protection failed!") + "\n" + err)
      );
      logErr(err, "DisableRootModeProtection");
    }
  }
}

/**
 *
 * Insure that shutdown is executed even if the GLib timer fails by running
 * the `shutdown` command delayed by 1 minute. Suspend is not insured.
 *
 */
async function maybeStartRootModeProtection(info) {
  if (info.scheduled && settings.get_boolean("root-mode-value")) {
    logDebug("Start root mode protection for: " + info.label);
    try {
      switch (info.mode) {
        case "poweroff":
          await RootMode.shutdown(info.minutes + 1);
          break;
        case "reboot":
          await RootMode.shutdown(info.minutes + 1, true);
          break;
        default:
          logDebug("No root mode protection started for: " + info.mode);
      }
    } catch (err) {
      guiIdle(() =>
        _showTextbox(_("Root mode protection failed!") + "\n" + err)
      );
      logErr(err, "EnableRootModeProtection");
    }
  }
}

// timer action (shutdown/reboot/suspend)
function serveInernalSchedule(mode) {
  maybeDoCheck()
    .then(() => {
      // check succeeded: do shutdown
      shutdown(mode);
    })
    .catch((err) => {
      logError(err, "CheckError");
      // check failed: cancel shutdown
      if (settings.get_boolean("root-mode-value")) {
        RootMode.shutdownCancel();
      }
      if (settings.get_boolean("auto-wake-value")) {
        RootMode.wakeCancel();
      }
    })
    .finally(() => {
      // reset schedule timestamp
      settings.set_int("shutdown-timestamp-value", -1);
      guiIdle(() => {
        shutdownTimerMenu._updateSwitcherState();
      });
    });
}

async function maybeDoCheck() {
  if (checkCancel !== null) {
    throw new Error(
      "Confirmation canceled: attempted to start a second check command!"
    );
  }
  checkCancel = new Gio.Cancellable();

  const checkCmd = maybeCheckCmdString();
  if (checkCmd === "") {
    return;
  }
  if (
    settings.get_boolean("root-mode-value") &&
    settings.get_boolean("enable-root-mode-cancel-value")
  ) {
    // avoid shutting down (with root mode protection) before check command is done
    RootMode.shutdownCancel();
  }
  guiIdle(() => {
    shutdownTimerMenu._updateShutdownInfo();
    _showTextbox(_("Waiting for confirmation") + maybeCheckCmdString(true));
  });
  return RootMode.execCheck(checkCmd, checkCancel)
    .then(() => {
      logDebug(`Check command "${checkCmd}" confirmed shutdown.`);
      return;
    })
    .catch((err) => {
      let code = "?";
      if ("code" in err) {
        code = `${err.code}`;
        logDebug("Check command aborted shutdown. Code: " + code);
      }
      guiIdle(() => {
        _showTextbox(_("Shutdown aborted") + `\n${checkCmd} (Code: ${code})`);
      });
      throw err;
    })
    .finally(() => {
      checkCancel = null;
    });
}

async function wakeAction(mode) {
  switch (mode) {
    case "wake":
      return RootMode.wake(_getSliderMinutes("wake"));
    case "no-wake":
      return RootMode.wakeCancel();
    default:
      logError(new Error("Unknown wake mode: " + mode));
      return false;
  }
}

function shutdown(mode) {
  Main.overview.hide();
  const session = new imports.misc.gnomeSession.SessionManager();
  const LoginManager = imports.misc.loginManager;
  const loginManager = LoginManager.getLoginManager();

  switch (mode) {
    case "reboot":
      session.RebootRemote(0);
      break;
    case "suspend":
      loginManager.suspend();
    default:
      session.ShutdownRemote(0); // shutdown after 60s
      // const Util = imports.misc.util;
      // Util.spawnCommandLine('poweroff');	// shutdown immediately
      break;
  }
}

function logInstallClear() {
  settings.set_string("install-log-text-value", "");
}

function logInstall(message) {
  message = ["[", "#"].includes(message[0]) ? message : " " + message;
  settings.set_string(
    "install-log-text-value",
    settings.get_string("install-log-text-value") + message + "\n"
  );
}

function toggleInstall() {
  const action = settings.get_boolean("install-policy-value")
    ? "install"
    : "uninstall";
  if (installCancel !== null) {
    installCancel.cancel();
  } else {
    installCancel = new Gio.Cancellable();
    installAction(action, installCancel).finally(() => {
      installCancel = null;
      guiIdle(() => {
        shutdownTimerMenu._updateInstalledStatus();
      });
    });
  }
}

async function installAction(action, cancel) {
  logInstall(`[START ${action} "/usr"]`);
  try {
    if (action === "install") {
      await RootMode.installScript(cancel, logInstall);
    } else {
      await RootMode.uninstallScript(cancel, logInstall);
    }
    logInstall(`[DONE ${action} "/usr"]`);
  } catch (err) {
    logInstall(`[FAIL ${action} "/usr"]\n# ${err}`);
    logError(err, "InstallError");
  }
}

// Derived values
function durationString(seconds) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours >= 3) {
    return `${hours} ${_("hour")}`;
  }
  if (minutes === 0) {
    return `${seconds} ${_("sec")}`;
  }
  return `${minutes} ${_("min")}`;
}

function _getSliderMinutes(prefix) {
  let sliderValue = settings.get_int(prefix + "-slider-value") / 100.0;
  return Math.floor(
    sliderValue * settings.get_int(prefix + "-max-timer-value")
  );
}

function maybeCheckCmdString(nl = false) {
  const cmd = settings.get_string("check-command-value");
  return settings.get_boolean("enable-check-command-value") && cmd !== ""
    ? (nl ? "\n" : "") + cmd
    : "";
}

/* --- GUI main loop ---- */

/* ACTION FUNCTIONS */

function stopSchedule() {
  settings.set_int("shutdown-timestamp-value", -1);
  let showText = _("Shutdown Timer stopped");
  if (checkCancel !== null) {
    checkCancel.cancel();
    showText = _("Confirmation canceled");
  }
  _showTextbox(showText);
}

function startSchedule() {
  const maxTimerMinutes = _getSliderMinutes("shutdown");
  const seconds = maxTimerMinutes * 60;
  settings.set_int(
    "shutdown-timestamp-value",
    GLib.DateTime.new_now_utc().to_unix() + Math.max(1, seconds)
  );
  _showTextbox(
    `${_("System will shutdown in")} ${maxTimerMinutes} ${_(
      "minutes"
    )}${maybeCheckCmdString(true)}`
  );
}

function _disconnectOnDestroy(item, connections) {
  const handlerIds = connections.map(([label, func]) =>
    item.connect(label, func)
  );
  const destroyId = item.connect("destroy", () => {
    handlerIds.concat(destroyId).forEach((handlerId) => {
      item.disconnect(handlerId);
    });
  });
}

function guiIdle(func) {
  if (shutdownTimerMenu !== null) {
    shutdownTimerMenu.guiIdle(func);
  }
}

function _createSliderItem(settingsPrefix) {
  const sliderValue =
    settings.get_int(settingsPrefix + "-slider-value") / 100.0;
  const item = new PopupMenu.PopupBaseMenuItem({ activate: false });
  const sliderIcon = new St.Icon({
    icon_name:
      settingsPrefix === "wake"
        ? "alarm-symbolic"
        : "preferences-system-time-symbolic",
    style_class: "popup-menu-icon",
  });
  item.add(sliderIcon);
  const slider = new Slider.Slider(sliderValue);
  _disconnectOnDestroy(slider, [
    [
      "notify::value",
      () => {
        settings.set_int(settingsPrefix + "-slider-value", slider.value * 100);
      },
    ],
  ]);
  item.add_child(slider);
  return [item, slider];
}

const ShutdownTimer = GObject.registerClass(
  class ShutdownTimer extends PopupMenu.PopupSubMenuMenuItem {
    _init() {
      super._init("", true);
      // track external schutdown and wake schedule
      this.infoFetcher = new InfoFetcher.InfoFetcher();
      this.idleSourceIds = {};
      this.externalScheduleInfo = new ScheduleInfo({ external: true });
      this.externalWakeInfo = new ScheduleInfo({
        external: false,
        mode: "wake",
      });
      this.internalScheduleInfo = new ScheduleInfo({
        external: false,
        deadline: settings.get_int("shutdown-timestamp-value"),
        mode: settings.get_string("shutdown-mode-value"),
      });

      // submenu in status area menu with slider and toggle button
      this.sliderItems = {};
      this.sliders = {};
      ["shutdown", "wake"].forEach((prefix) => {
        const [item, slider] = _createSliderItem(prefix);
        this.sliderItems[prefix] = item;
        this.sliders[prefix] = slider;
        this._onShowSliderChanged(prefix);
      });
      this.switcher = new PopupMenu.PopupSwitchMenuItem("", false);
      _disconnectOnDestroy(this.switcher, [
        ["toggled", this._onToggle.bind(this)],
      ]);
      this.switcherSettingsButton = new St.Button({
        reactive: true,
        can_focus: true,
        track_hover: true,
        accessible_name: _("Settings"),
        style_class: "system-menu-action settings-button",
      });
      this.switcherSettingsButton.child = new St.Icon({
        icon_name: "emblem-system-symbolic",
        style_class: "popup-menu-icon",
      });
      _disconnectOnDestroy(this.switcherSettingsButton, [
        [
          "clicked",
          () => {
            logInstallClear();
            ExtensionUtils.openPrefs();
          },
        ],
      ]);
      this.switcher.add_child(this.switcherSettingsButton);

      this._onShowSettingsButtonChanged();
      this._updateSwitchLabel();
      this.icon.icon_name = "system-shutdown-symbolic";
      this.menu.addMenuItem(this.switcher);
      // make switcher toggle without popup menu closing
      this.switcher.disconnect(this.switcher._activateId);
      // dummy for clean disconnect
      this.switcher._activateId = this.switcher.connect_after(
        "activate",
        () => {}
      );
      this.menu.addMenuItem(this.sliderItems["shutdown"]);

      this.modeItems = Object.entries(MODE_LABELS).map(([mode, label]) => {
        const modeItem = new PopupMenu.PopupMenuItem(label);
        _disconnectOnDestroy(modeItem, [
          [
            "activate",
            () => {
              this._startMode(mode);
            },
          ],
        ]);
        this.menu.addMenuItem(modeItem);
        return [mode, modeItem];
      });

      this.wakeItems = [
        new PopupMenu.PopupSeparatorMenuItem(),
        this.sliderItems["wake"],
        ...Object.entries(WAKE_MODE_LABELS).map(([mode, label]) => {
          const modeItem = new PopupMenu.PopupMenuItem(label);
          if (mode === "wake") {
            this.wakeModeItem = modeItem;
          }
          _disconnectOnDestroy(modeItem, [
            [
              "activate",
              () => {
                wakeAction(mode)
                  .then(() => {
                    guiIdle(() => {
                      this.infoFetcher.updateScheduleInfo();
                    });
                  })
                  .catch((err) => {
                    guiIdle(() => {
                      _showTextbox(_("Wake action failed!") + "\n" + err);
                    });
                  });
              },
            ],
          ]);
          return modeItem;
        }),
      ];
      this._updateWakeModeItem();
      this.wakeItems.forEach((item) => {
        this.menu.addMenuItem(item);
      });
      this._updateShownWakeItems();
      this._updateShownModeItems();
      this._updateSelectedModeItems();
      timer.setTickCallback(this._updateShutdownInfo.bind(this));
      this._onInternalShutdownTimestampChanged();
      this._updateSwitcherState();

      this._updateInstalledStatus();

      // start root mode update loop
      this.infoFetcher.startScheduleInfoLoop(
        this._externalScheduleInfoTick.bind(this)
      );

      // handlers for changed values in settings
      this.settingsHandlerIds = [
        ["shutdown-max-timer-value", this._updateSwitchLabel.bind(this)],
        ["wake-max-timer-value", this._updateWakeModeItem.bind(this)],
        [
          "shutdown-slider-value",
          () => {
            this._updateSlider("shutdown");
            this._updateSwitchLabel();
          },
        ],
        [
          "wake-slider-value",
          () => {
            this._updateSlider("wake");
            this._updateWakeModeItem();
          },
        ],
        ["root-mode-value", this._onRootModeChanged.bind(this)],
        ["show-settings-value", this._onShowSettingsButtonChanged.bind(this)],
        [
          "show-shutdown-slider-value",
          () => this._onShowSliderChanged("shutdown"),
        ],
        ["show-wake-slider-value", () => this._onShowSliderChanged("wake")],
        ["show-wake-items-value", this._updateShownWakeItems.bind(this)],
        ["show-shutdown-mode-value", this._updateShownModeItems.bind(this)],
        ["shutdown-mode-value", this._onModeChange.bind(this)],
        [
          "shutdown-timestamp-value",
          this._onInternalShutdownTimestampChanged.bind(this),
        ],
        ["install-policy-value", toggleInstall],
      ].map(([label, func]) => settings.connect("changed::" + label, func));
    }

    guiIdle(func) {
      const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        func();
        delete this.idleSourceIds[sourceId];
        return GLib.SOURCE_REMOVE;
      });
      this.idleSourceIds[sourceId] = 1;
    }

    _onRootModeChanged() {
      Promise.all([
        maybeStopRootModeProtection(this.internalScheduleInfo),
        maybeStartRootModeProtection(this.internalScheduleInfo),
      ]).then(() => {
        this.infoFetcher.updateScheduleInfo();
        this._updateSwitchLabel();
      });
    }

    _onModeChange() {
      // redo Root-mode protection
      maybeStopRootModeProtection(this.internalScheduleInfo, true)
        .then(() => {
          this._updateCurrentMode();
          logDebug("Shutdown mode: " + this.internalScheduleInfo.mode);
          this.guiIdle(() => {
            this._updateSelectedModeItems();
            this.infoFetcher.updateScheduleInfo();
          });
        })
        .then(() => maybeStartRootModeProtection(this.internalScheduleInfo));
    }

    _updateCurrentMode() {
      this.internalScheduleInfo = this.internalScheduleInfo.copy({
        mode: settings.get_string("shutdown-mode-value"),
      });
      this._updateShutdownInfo();
    }

    _onInternalShutdownTimestampChanged() {
      this.internalScheduleInfo = this.internalScheduleInfo.copy({
        deadline: settings.get_int("shutdown-timestamp-value"),
      });

      timer.adjustTo(this.internalScheduleInfo);
      this._updateShutdownInfo();
    }

    /* Schedule Info updates */
    _externalScheduleInfoTick(info, wakeInfo) {
      this.externalScheduleInfo = this.externalScheduleInfo.copy({ ...info });
      this.externalWakeInfo = this.externalWakeInfo.copy({ ...wakeInfo });
      this.guiIdle(() => {
        this._updateShutdownInfo();
      });
    }

    _updateSwitcherState() {
      this.switcher.setToggleState(this.internalScheduleInfo.scheduled);
    }

    _updateShownModeItems() {
      const activeModes = settings
        .get_string("show-shutdown-mode-value")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s in MODE_LABELS);
      this.modeItems.forEach(([mode, item]) => {
        const position = activeModes.indexOf(mode);
        if (position > -1) {
          this.menu.moveMenuItem(item, position + 2);
        }
        item.visible = position > -1;
      });
    }

    _updateShutdownInfo() {
      let wakeLabel = this.externalWakeInfo.scheduled
        ? "\n" + this.externalWakeInfo.label
        : "";

      if (checkCancel !== null) {
        this.label.text = _("Waiting for confirmation") + wakeLabel;
        return;
      }
      const info = this.externalScheduleInfo.isMoreUrgendThan(
        this.internalScheduleInfo
      )
        ? this.externalScheduleInfo
        : this.internalScheduleInfo;
      this.label.text = info.label + wakeLabel;
    }

    _updateSelectedModeItems() {
      this.modeItems.forEach(([mode, item]) => {
        item.setOrnament(
          mode === this.internalScheduleInfo.mode
            ? PopupMenu.Ornament.DOT
            : PopupMenu.Ornament.NONE
        );
      });
    }

    // update timer value if slider has changed
    _updateSlider(prefix) {
      this.sliders[prefix].value =
        settings.get_int(prefix + "-slider-value") / 100.0;
    }

    _updateSwitchLabel() {
      let label = `${_getSliderMinutes("shutdown")} ${_("min")}`;
      if (settings.get_boolean("root-mode-value")) {
        label += " " + _("(protect)");
      }
      this.switcher.label.text = label;
    }

    _updateWakeModeItem() {
      const minutes = _getSliderMinutes("wake");
      const hours = Math.floor(minutes / 60);
      const hoursStr = hours !== 0 ? `${hours} ${_("hours")} ` : "";
      this.wakeModeItem.label.text =
        WAKE_MODE_LABELS["wake"] +
        ` ${hoursStr}${minutes % 60} ${_("minutes")}`;
    }

    _onShowSettingsButtonChanged() {
      this.switcherSettingsButton.visible = settings.get_boolean(
        "show-settings-value"
      );
    }

    _updateShownWakeItems() {
      this.wakeItems.forEach((item) => {
        item.visible = settings.get_boolean("show-wake-items-value");
      });
      this._onShowSliderChanged("wake");
    }

    _onShowSliderChanged(settingsPrefix) {
      this.sliderItems[settingsPrefix].visible =
        (settingsPrefix !== "wake" ||
          settings.get_boolean("show-wake-items-value")) &&
        settings.get_boolean(`show-${settingsPrefix}-slider-value`);
    }

    _startMode(mode) {
      startSchedule();
      settings.set_string("shutdown-mode-value", mode);
      this._updateSwitcherState();
    }

    // toggle button starts/stops shutdown timer
    _onToggle() {
      if (this.switcher.state) {
        // start shutdown timer
        startSchedule();
        maybeStartRootModeProtection(this.internalScheduleInfo).then(
          async () => {
            if (settings.get_boolean("auto-wake-value")) {
              await RootMode.wake(_getSliderMinutes("wake"));
            }
            this.infoFetcher.updateScheduleInfo();
          }
        );
      } else {
        // stop shutdown timer
        stopSchedule();
        maybeStopRootModeProtection(this.internalScheduleInfo).then(
          async () => {
            if (settings.get_boolean("auto-wake-value")) {
              await RootMode.wakeCancel();
            }
            this.infoFetcher.updateScheduleInfo();
          }
        );
      }
    }

    _updateInstalledStatus() {
      const scriptPath = RootMode.installedScriptPath();
      const isInstalled = scriptPath !== null;
      if (isInstalled) {
        logDebug("Existing installation at: " + scriptPath);
      }
      if (isInstalled !== settings.get_boolean("install-policy-value")) {
        settings.set_boolean("install-policy-value", isInstalled);
      }
    }

    destroy() {
      if (timer != null) {
        timer.setTickCallback(null);
        timer.stopGLibTimer();
      }
      this.infoFetcher.stopScheduleInfoLoop();
      this.settingsHandlerIds.forEach((handlerId) => {
        settings.disconnect(handlerId);
      });
      Object.keys(this.idleSourceIds).forEach((sourceId) => {
        GLib.Source.remove(sourceId);
      });
      super.destroy();
    }
  }
);

/* EXTENSION MAIN FUNCTIONS */
function init() {
  // initialize translations
  ExtensionUtils.initTranslations();
}

function enable() {
  MODE_LABELS = Me.imports.prefs.init_mode_labels();
  WAKE_MODE_LABELS = {
    wake: _("Wake after"),
    "no-wake": _("No Wake"),
  };
  MODE_TEXTS = {
    suspend: _("suspend"),
    poweroff: _("shutdown"),
    reboot: _("reboot"),
    wake: _("wakeup"),
  };
  if (!initialized) {
    // initialize settings
    settings = ExtensionUtils.getSettings();

    // check for shutdown may run in background and can be canceled by user
    checkCancel = null;
    installCancel = null;
    // starts internal shutdown schedule if ready
    timer = new Timer.Timer(serveInernalSchedule);

    idleMonitor = new Promise((resolve, reject) => {
      new MutterIdleMonitorProxy(
        Gio.DBus.session,
        "org.gnome.Mutter.IdleMonitor",
        "/org/gnome/Mutter/IdleMonitor/Core",
        (proxy, error) => {
          if (error) {
            reject(error);
          } else {
            resolve(proxy);
          }
        }
      );
    });

    initialized = true;
  }

  // add separator line and submenu in status area menu
  const statusMenu = Main.panel.statusArea["aggregateMenu"];
  if (separator == null) {
    separator = new PopupMenu.PopupSeparatorMenuItem();
    statusMenu.menu.addMenuItem(separator);
  }
  if (shutdownTimerMenu == null) {
    shutdownTimerMenu = new ShutdownTimer();
    statusMenu.menu.addMenuItem(shutdownTimerMenu);
  }
}

function disable() {
  if (shutdownTimerMenu != null) {
    shutdownTimerMenu.destroy();
  }
  shutdownTimerMenu = undefined;
  if (separator != null) {
    separator.destroy();
  }
  separator = undefined;

  if (idleMonitor != null) {
    idleMonitor
      .then((proxy) =>
        proxy.GetIdletimeRemote(([userIdle], error) => {
          if (error || userIdle > 1000) {
            logDebug(
              `Partially disabled. User idled for ${userIdle} ms or Error: ${error}.`
            );
          } else {
            // user active in last 10 sec => probably the user disabled the extension
            if (shutdownTimerMenu != null) {
              logDebug("Abort complete disable. Leave extension enabled.");
              return;
            }

            if (timer != null) {
              timer.stopTimer();
              timer = undefined;
            }
            if (checkCancel != null) {
              checkCancel.cancel();
              checkCancel = undefined;
            }
            idleMonitor = undefined;
            initialized = false;
            logDebug(`Completly disabled. User idled for ${userIdle} ms.`);
          }
        })
      )
      .catch((err) => {
        logError(err, "MissingIdleMonitor");
      });
  }
}
