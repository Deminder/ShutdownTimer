/**
    AUTHOR: Daniel Neumann, Deminder
    GJS SOURCES: https://github.com/GNOME/gnome-shell/
    BUILD: ./scripts/build.sh
    UPDATE TRANSLATIONS: ./scripts/update-pod.sh
**/

const Me = imports.misc.extensionUtils.getCurrentExtension();
const { RootMode, Timer, Convenience } = Me.imports.lib;
const logDebug = Convenience.logDebug;

/* IMPORTS */
const { GLib, St, Gio, Clutter } = imports.gi;

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
  submenu,
  sliders,
  sliderItems,
  switcher,
  switcherSettingsButton,
  separator,
  wakeItems,
  wakeModeItem,
  settings,
  guiReady,
  idleSourceIds,
  checkCancel,
  rootMode,
  internalScheduleInfo,
  externalScheduleInfo,
  externalWakeInfo,
  settingsHandlerIds;
let initialized = false;
const MODE_LABELS = Me.imports.prefs.MODE_LABELS;
const WAKE_MODE_LABELS = {
  wake: _("Wake after"),
  "no-wake": _("No Wake"),
};
const MODE_TEXTS = {
  suspend: _("suspend"),
  poweroff: _("shutdown"),
  reboot: _("reboot"),
};

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

function _onRootModeChanged() {
  if (!settings.get_boolean("root-mode-value")) {
    rootMode.stopRootProc();
  }
  Promise.all([
    maybeStopRootModeProtection(),
    maybeStartRootModeProtection(),
  ]).then(() => {
    if (guiReady) {
      rootMode.updateScheduleInfo();
      _updateSwitchLabel();
    }
  });
}

function _updateCurrentMode() {
  internalScheduleInfo = internalScheduleInfo.copy({
    mode: settings.get_string("shutdown-mode-value"),
  });
  guiIdle(() => {
    _updateShutdownInfo();
  });
}

function _onModeChange() {
  // redo Root-mode protection
  maybeStopRootModeProtection(true)
    .then(() => {
      _updateCurrentMode();
      logDebug("Shutdown mode: " + internalScheduleInfo.mode);
      guiIdle(() => {
        _updateSelectedModeItems();
      });
    })
    .then(() => maybeStartRootModeProtection());
}

async function maybeStopRootModeProtection(stopScheduled = false) {
  if (
    (stopScheduled || !internalScheduleInfo.scheduled) &&
    settings.get_boolean("root-mode-value")
  ) {
    logDebug("Stop root mode protection for: " + internalScheduleInfo.mode);
    try {
      switch (internalScheduleInfo.mode) {
        case "poweroff":
        case "reboot":
          await rootMode.cancelShutdown();
          if (guiReady) {
            rootMode.updateScheduleInfo();
          }
          break;
        default:
          logDebug(
            "No root mode protection stopped for: " + internalScheduleInfo.mode
          );
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
 * shutdown in rootMode delayed by 1 minute. Suspend is not insured.
 *
 */
async function maybeStartRootModeProtection() {
  if (
    internalScheduleInfo.scheduled &&
    settings.get_boolean("root-mode-value")
  ) {
    logDebug("Start root mode protection for: " + internalScheduleInfo.label);
    try {
      switch (internalScheduleInfo.mode) {
        case "poweroff":
          await rootMode.shutdown(internalScheduleInfo.minutes + 1);
          break;
        case "reboot":
          await rootMode.shutdown(internalScheduleInfo.minutes + 1, true);
          break;
        default:
          logDebug(
            "No root mode protection started for: " + internalScheduleInfo.mode
          );
      }
    } catch (err) {
      guiIdle(() =>
        _showTextbox(_("Root mode protection failed!") + "\n" + err)
      );
      logErr(err, "EnableRootModeProtection");
    }
  }
}

function _onInternalShutdownTimestampChanged() {
  internalScheduleInfo = internalScheduleInfo.copy({
    deadline: settings.get_int("shutdown-timestamp-value"),
  });

  timer.adjustTo(internalScheduleInfo, guiReady);
  guiIdle(() => {
    _updateShutdownInfo();
  });
}

// timer action (shutdown/reboot/suspend)
function serveInernalSchedule() {
  maybeDoCheck()
    .then(() => {
      // check succeeded: do shutdown
      shutdown();
    })
    .catch((err) => {
      // check failed: cancel shutdown
      if (settings.get_boolean("root-mode-value")) {
        rootMode.cancelShutdown();
      }
      logError(err, "CheckError");
    })
    .finally(() => {
      // reset schedule timestamp
      settings.set_int("shutdown-timestamp-value", -1);
      guiIdle(() => {
        _updateSwitcherState();
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
    rootMode.cancelShutdown();
  }
  guiIdle(() => {
    _updateShutdownInfo();
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

function shutdown() {
  Main.overview.hide();
  const session = new imports.misc.gnomeSession.SessionManager();
  const LoginManager = imports.misc.loginManager;
  const loginManager = LoginManager.getLoginManager();

  switch (internalScheduleInfo.mode) {
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

/* Schedule Info updates */
function externalScheduleInfoTick(info, wakeInfo) {
  externalScheduleInfo = externalScheduleInfo.copy({ ...info });
  externalWakeInfo = { ...externalWakeInfo, ...wakeInfo };
  guiIdle(() => {
    _updateShutdownInfo();
  });
}

function rootModeToggle() {
  _updateSwitchLabel();
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

// update timer value if slider has changed
function _updateSlider(prefix) {
  sliders[prefix].value = settings.get_int(prefix + "-slider-value") / 100.0;
}

function _updateSwitchLabel() {
  let label = `${_getSliderMinutes("shutdown")} ${_("min")}`;
  if (rootMode.isActive()) {
    label += " " + _("(root)");
  }
  switcher.label.text = label;
}

function _updateWakeModeItem() {
  wakeModeItem.label.text =
    WAKE_MODE_LABELS["wake"] + ` ${_getSliderMinutes("wake")} ${_("min")}`;
}

function _onShowSettingsButtonChanged() {
  switcherSettingsButton.visible = settings.get_boolean("show-settings-value");
}

function _updateShownWakeItems() {
  wakeItems.forEach((item) => {
    item.visible = settings.get_boolean("show-wake-items-value");
  });
  _onShowSliderChanged("wake");
}

function _onShowSliderChanged(settingsPrefix) {
  sliderItems[settingsPrefix].visible =
    (settingsPrefix !== "wake" ||
      settings.get_boolean("show-wake-items-value")) &&
    settings.get_boolean(`show-${settingsPrefix}-slider-value`);
}

function _startMode(mode) {
  startSchedule();
  settings.set_string("shutdown-mode-value", mode);
  _updateSwitcherState();
}

// toggle button starts/stops shutdown timer
function _onToggle() {
  if (switcher.state) {
    // start shutdown timer
    startSchedule();
    maybeStartRootModeProtection().then(() => {
      if (settings.get_string("auto-wake-value")) {
        rootMode.wake(_getSliderMinutes("wake"));
      }
    });
  } else {
    // stop shutdown timer
    stopSchedule();
    maybeStopRootModeProtection().then(() => {
      if (settings.get_string("auto-wake-value")) {
        rootMode.wakeCancel();
      }
    });
  }
}

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
  settings.set_int(
    "shutdown-timestamp-value",
    GLib.DateTime.new_now_utc().to_unix() + maxTimerMinutes * 60
  );
  _showTextbox(
    `${_("System will shutdown in")} ${maxTimerMinutes} ${_(
      "minutes"
    )}${maybeCheckCmdString(true)}`
  );
}

function guiIdle(func) {
  if (guiReady) {
    const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      func();
      delete idleSourceIds[sourceId];
      return GLib.SOURCE_REMOVE;
    });
    idleSourceIds[sourceId] = 1;
  }
}

function _updateSwitcherState() {
  guiIdle(() => {
    switcher.setToggleState(internalScheduleInfo.scheduled);
  });
}

function _updateShownModeItems() {
  const activeModes = settings
    .get_string("show-shutdown-mode-value")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s in MODE_LABELS);
  modeItems.forEach(([mode, item]) => {
    const position = activeModes.indexOf(mode);
    if (position > -1) {
      submenu.menu.moveMenuItem(item, position + 2);
    }
    item.visible = position > -1;
  });
}

function _updateShutdownInfo() {
  let wakeLabel = externalWakeInfo.scheduled
    ? "\n" + externalWakeInfo.label
    : "";

  if (checkCancel !== null) {
    submenu.label.text = _("Waiting for confirmation") + wakeLabel;
    return;
  }
  const info = externalScheduleInfo.isMoreUrgendThan(internalScheduleInfo)
    ? externalScheduleInfo
    : internalScheduleInfo;
  submenu.label.text = info.label + wakeLabel;
}
function _updateSelectedModeItems() {
  modeItems.forEach(([mode, item]) => {
    item.setOrnament(
      mode === internalScheduleInfo.mode
        ? PopupMenu.Ornament.DOT
        : PopupMenu.Ornament.NONE
    );
  });
}

// menu items switcher and slider
function _createSwitcherItem() {
  let switchMenuItem = new PopupMenu.PopupSwitchMenuItem(
    "",
    internalScheduleInfo.scheduled
  );

  _disconnectOnDestroy(switchMenuItem, [["toggled", _onToggle]]);

  switcherSettingsButton = new St.Button({
    reactive: true,
    can_focus: true,
    track_hover: true,
    accessible_name: _("Settings"),
    style_class: "system-menu-action settings-button",
  });
  switcherSettingsButton.child = new St.Icon({
    icon_name: "emblem-system-symbolic",
    style_class: "popup-menu-icon",
  });
  _disconnectOnDestroy(switcherSettingsButton, [
    [
      "clicked",
      () => {
        imports.misc.extensionUtils.openPrefs();
      },
    ],
  ]);
  switchMenuItem.add_child(switcherSettingsButton);

  return switchMenuItem;
}

function _createSliderItem(settingsPrefix) {
  const sliderValue =
    settings.get_int(settingsPrefix + "-slider-value") / 100.0;
  const item = new PopupMenu.PopupBaseMenuItem({ activate: false });
  const sliderIcon = new St.Icon({
    icon_name: settingsPrefix === 'wake' ? "alarm-symbolic" : "preferences-system-time-symbolic",
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

function render() {
  // submenu in status area menu with slider and toggle button
  sliderItems = {};
  sliders = {};
  ["shutdown", "wake"].forEach((prefix) => {
    const [item, slider] = _createSliderItem(prefix);
    sliderItems[prefix] = item;
    sliders[prefix] = slider;
    _onShowSliderChanged(prefix);
  });
  switcher = _createSwitcherItem();
  _onShowSettingsButtonChanged();
  _updateSwitchLabel();

  submenu = new PopupMenu.PopupSubMenuMenuItem("", true);
  submenu.icon.icon_name = "system-shutdown-symbolic";
  submenu.menu.addMenuItem(switcher);
  // make switcher toggle without popup menu closing
  switcher.disconnect(switcher._activateId);
  // dummy for clean disconnect
  switcher._activateId = switcher.connect_after("activate", () => {});
  submenu.menu.addMenuItem(sliderItems["shutdown"]);

  modeItems = Object.entries(MODE_LABELS).map(([mode, label]) => {
    const modeItem = new PopupMenu.PopupMenuItem(label);
    _disconnectOnDestroy(modeItem, [
      [
        "activate",
        () => {
          _startMode(mode);
        },
      ],
    ]);
    submenu.menu.addMenuItem(modeItem);
    return [mode, modeItem];
  });

  wakeItems = [
    new PopupMenu.PopupSeparatorMenuItem(),
    sliderItems["wake"],
    ...Object.entries(WAKE_MODE_LABELS).map(([mode, label]) => {
      const modeItem = new PopupMenu.PopupMenuItem(label);
      if (mode === "wake") {
        wakeModeItem = modeItem;
      }
      _disconnectOnDestroy(modeItem, [
        [
          "activate",
          () => {
            switch (mode) {
              case "wake":
                rootMode.wake(_getSliderMinutes("wake"));
                break;
              case "no-wake":
                rootMode.wakeCancel();
                break;
              default:
                logError(new Error("Unknown wake mode: " + mode));
            }
          },
        ],
      ]);
      return modeItem;
    }),
  ];
  wakeItems.forEach((item) => {
    submenu.menu.addMenuItem(item);
  });
  _updateShownWakeItems();
  _updateShownModeItems();
  _updateSelectedModeItems();

  // add separator line and submenu in status area menu
  separator = new PopupMenu.PopupSeparatorMenuItem();
  const statusMenu = Main.panel.statusArea["aggregateMenu"];
  statusMenu.menu.addMenuItem(separator);
  statusMenu.menu.addMenuItem(submenu);
}

function _disconnectOnDestroy(item, connections) {
  const handlerIds = connections.map(([label, func]) =>
    item.connect(label, func)
  );
  const destoryId = item.connect("destroy", () => {
    handlerIds.concat(destoryId).forEach((handlerId) => {
      item.disconnect(handlerId);
    });
  });
}

/* EXTENSION MAIN FUNCTIONS */
function init() {
  // initialize translations
  Convenience.initTranslations();
}

function enable() {
  if (!initialized) {
    // initialize settings
    settings = Convenience.getSettings();

    // check for shutdown may run in background and can be canceled by user
    checkCancel = null;
    // track external schutdown and wake schedule
    // keeps track of priviledged process (for root mode)
    rootMode = new RootMode.RootMode(externalScheduleInfoTick, rootModeToggle);
    // starts internal shutdown schedule if ready
    timer = new Timer.Timer(serveInernalSchedule, _updateShutdownInfo);
    initialized = true;
  }

  idleSourceIds = {};
  externalScheduleInfo = new ScheduleInfo({ external: true });
  externalWakeInfo = new ScheduleInfo({ external: true, mode: "wake" });
  internalScheduleInfo = new ScheduleInfo({
    external: false,
    deadline: settings.get_int("shutdown-timestamp-value"),
    mode: settings.get_string("shutdown-mode-value"),
  });

  // render menu widget
  render();
  guiReady = true;

  // handlers for changed values in settings
  settingsHandlerIds = [
    ["shutdown-max-timer-value", _updateSwitchLabel],
    ["wake-max-timer-value", _updateWakeModeItem],
    [
      "shutdown-slider-value",
      () => {
        _updateSlider("shutdown");
        _updateSwitchLabel();
      },
    ],
    [
      "wake-slider-value",
      () => {
        _updateSlider("wake");
        _updateWakeModeItem();
      },
    ],
    ["root-mode-value", _onRootModeChanged],
    ["show-settings-value", _onShowSettingsButtonChanged],
    ["show-shutdown-slider-value", () => _onShowSliderChanged("shutdown")],
    ["show-wake-slider-value", () => _onShowSliderChanged("wake")],
    ["show-wake-items-value", _updateShownWakeItems],
    ["show-shutdown-mode-value", _updateShownModeItems],
    ["shutdown-mode-value", _onModeChange],
    ["shutdown-timestamp-value", _onInternalShutdownTimestampChanged],
  ].map(([label, func]) => settings.connect("changed::" + label, func));

  // restart root mode update loop
  rootMode.updateScheduleInfo();
  _onInternalShutdownTimestampChanged();
}

function disable() {
  guiReady = false;
  timer.stopGLibTimer();
  settingsHandlerIds.forEach((handlerId) => {
    settings.disconnect(handlerId);
  });
  Object.keys(idleSourceIds).forEach((sourceId) => {
    GLib.Source.remove(sourceId);
  });
  idleSourceIds = {};
  submenu.destroy(); // destroys switcher and sliderItem as children too
  separator.destroy();
  modeItems = [];
  wakeItems = [];
  // root mode protection will NOT be canceled (otherwise new password would be required after ScreenSaver was active)
  rootMode.stopScheduleInfoLoop();
}
