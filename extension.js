/**
    AUTHOR: Daniel Neumann, Deminder
    GJS SOURCES: https://github.com/GNOME/gnome-shell/
    BUILD: ./scripts/build.sh
    UPDATE TRANSLATIONS: ./scripts/update-pod.sh
**/

const Me = imports.misc.extensionUtils.getCurrentExtension();
const { RootMode, Timer, Convenience } = Me.imports.lib;

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
  slider,
  switcher,
  switcherSettingsButton,
  separator,
  settings,
  guiReady,
  idleSourceIds,
  checkCancel,
  rootMode,
  displayedInfo,
  internalScheduleInfo,
  externalScheduleInfo,
  settingsHandlerIds;
const MODE_LABELS = Me.imports.prefs.MODE_LABELS;
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
        `${this.minutes} ${_("min until")} ${this.modeText}` +
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
  _updateSwitchLabel();
  Promise.all([
    maybeStopRootModeProtection(),
    maybeStartRootModeProtection(),
  ]).then(() => {
    if (guiReady) {
      rootMode.updateScheduleInfo();
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
      log("Shutdown mode: " + internalScheduleInfo.mode);
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
    log("Stop root mode protection for: " + internalScheduleInfo.mode);
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
          log(
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
    log("Start root mode protection for: " + internalScheduleInfo.label);
    try {
      switch (internalScheduleInfo.mode) {
        case "poweroff":
          await rootMode.shutdown(internalScheduleInfo.minutes + 1);
          break;
        case "reboot":
          await rootMode.shutdown(internalScheduleInfo.minutes + 1, true);
          break;
        default:
          log(
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
      log(`Check command "${checkCmd}" confirmed shutdown.`);
      return;
    })
    .catch((err) => {
      let code = "?";
      if ("code" in err) {
        code = `${err.code}`;
        log("Check command aborted shutdown. Code: " + code);
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

// Values derived from Config

function _getTimerStartValue() {
  let sliderValue = settings.get_int("slider-value") / 100.0;
  return Math.floor(sliderValue * settings.get_int("max-timer-value"));
}

function maybeCheckCmdString(nl = false) {
  const cmd = settings.get_string("check-command-value");
  return settings.get_boolean("enable-check-command-value") && cmd !== ""
    ? (nl ? "\n" : "") + cmd
    : "";
}

/* --- GUI main loop ---- */

/* Schedule Info updates */
function externalScheduleInfoTick(info) {
  externalScheduleInfo = externalScheduleInfo.copy({ ...info });
  _updateShutdownInfo();
}

/* ACTION FUNCTIONS */
// show textbox with message
function _showTextbox(textmsg) {
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
function _updateSlider() {
  slider.value = settings.get_int("slider-value") / 100.0;
  _updateSwitchLabel();
}

function _updateSwitchLabel() {
  let label = `${_getTimerStartValue()} ${_("min")}`;
  if (settings.get_boolean("root-mode-value")) {
    label += " " + _("(root)");
  }
  switcher.label.text = label;
}

function _onShowSettingsButtonChanged() {
  switcherSettingsButton.visible = settings.get_boolean("show-settings-value");
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
    maybeStartRootModeProtection();
  } else {
    // stop shutdown timer
    stopSchedule();
    maybeStopRootModeProtection();
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
  const maxTimerMinutes = _getTimerStartValue();
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
  if (checkCancel !== null) {
    submenu.label.text = _("Waiting for confirmation");
    return;
  }
  displayedInfo = externalScheduleInfo.isMoreUrgendThan(internalScheduleInfo)
    ? externalScheduleInfo
    : internalScheduleInfo;
  submenu.label.text = displayedInfo.label;
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
  switchMenuItem.add_actor(switcherSettingsButton);
  _onShowSettingsButtonChanged();

  return switchMenuItem;
}

function _createSliderItem() {
  let sliderValue = settings.get_int("slider-value") / 100.0;
  let sliderItem = new PopupMenu.PopupMenuItem("");
  let sliderIcon = new St.Icon({
    icon_name: "preferences-system-time-symbolic",
    style_class: "popup-menu-icon",
  });
  sliderItem.actor.add(sliderIcon);
  slider = new Slider.Slider(sliderValue);
  _disconnectOnDestroy(slider, [
    [
      "notify::value",
      () => {
        settings.set_int("slider-value", slider.value * 100);
      },
    ],
  ]);
  sliderItem.add_actor(slider);
  return sliderItem;
}

function render() {
  // submenu in status area menu with slider and toggle button
  let sliderItem = _createSliderItem();
  switcher = _createSwitcherItem();
  _updateSwitchLabel();

  submenu = new PopupMenu.PopupSubMenuMenuItem(displayedInfo.label, true);
  submenu.icon.icon_name = "system-shutdown-symbolic";
  submenu.menu.addMenuItem(switcher);
  // make switcher toggle without popup menu closing
  switcher.disconnect(switcher._activateId);
  // dummy for clean disconnect
  switcher._activateId = switcher.connect_after("activate", () => {});
  submenu.menu.addMenuItem(sliderItem);

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
  _updateShownModeItems();
  _updateSelectedModeItems();

  // add separator line and submenu in status area menu
  separator = new PopupMenu.PopupSeparatorMenuItem();
  let statusMenu = Main.panel.statusArea["aggregateMenu"];
  statusMenu.menu.addMenuItem(separator);
  statusMenu.menu.addMenuItem(submenu);
}

function _disconnectOnDestroy(item, connections) {
  const handlerIds = connections.map(([label, func]) =>
    item.connect(label, func)
  );
  const destoryId = item.connect("destroy", () => {
    handlerIds.concat(destoryId).forEach((handlerId) => {
      item.connect(handlerId);
    });
  });
}

/* EXTENSION MAIN FUNCTIONS */
function init() {
  // initialize translations
  Convenience.initTranslations();

  // initialize settings
  settings = Convenience.getSettings();

  // check for shutdown may run in background and can be canceled by user
  checkCancel = null;
  // track external schutdown schedule
  // keeps track of priviledged process (for root mode)
  rootMode = new RootMode.RootMode(externalScheduleInfoTick);
  // starts internal shutdown schedule if ready
  timer = new Timer.Timer(serveInernalSchedule, _updateShutdownInfo);
}

function enable() {
  idleSourceIds = {};
  externalScheduleInfo = new ScheduleInfo({ external: true });
  internalScheduleInfo = new ScheduleInfo({
    external: false,
    deadline: settings.get_int("shutdown-timestamp-value"),
    mode: settings.get_string("shutdown-mode-value"),
  });
  displayedInfo = internalScheduleInfo;

  // render menu widget
  render();
  guiReady = true;

  // handlers for changed values in settings
  settingsHandlerIds = [
    ["max-timer-value", _updateSwitchLabel],
    ["slider-value", _updateSlider],
    ["root-mode-value", _onRootModeChanged],
    ["show-settings-value", _onShowSettingsButtonChanged],
    ["show-shutdown-mode-value", _updateShownModeItems],
    ["shutdown-mode-value", _onModeChange],
    ["shutdown-timestamp-value", _onInternalShutdownTimestampChanged],
  ].map(([label, func]) => settings.connect("changed::" + label, func));

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
  // root mode protection will NOT be canceled (otherwise new password would be required after ScreenSaver was active)
  rootMode.stopScheduleInfoLoop();
}
