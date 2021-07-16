/**
    AUTHOR: Daniel Neumann, Deminder
    GJS SOURCES: https://github.com/GNOME/gnome-shell/
    BUILD: ./scripts/build.sh
    UPDATE TRANSLATIONS: ./scripts/update-pod.sh
**/

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { MenuItem, Textbox, RootMode, Timer, Convenience } = Me.imports.lib;
const logDebug = Convenience.logDebug;

/* IMPORTS */
const { GObject, GLib, Gio } = imports.gi;

// screen and main functionality
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

// translations
const Gettext = imports.gettext.domain("ShutdownTimer");
const _ = Gettext.gettext;
const _n = Gettext.ngettext;

/* GLOBAL VARIABLES */
let shutdownTimerMenu, separator, settings, checkCancel, idleMonitor;

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
var INSTALL_ACTIONS;

function _showTextbox(textmsg) {
  if (settings.get_boolean("show-textboxes-value")) {
    guiIdle(() => {
      Textbox.showTextbox(textmsg);
    });
  }
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
      _showTextbox(_("Root mode protection failed!") + "\n" + err);
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
      _showTextbox(_("Root mode protection failed!") + "\n" + err);
      logErr(err, "EnableRootModeProtection");
    }
  }
}

async function maybeStartWake() {
  if (settings.get_boolean("auto-wake-value")) {
    await RootMode.wake(_getSliderMinutes("wake"));
  }
}

async function maybeStopWake() {
  if (settings.get_boolean("auto-wake-value")) {
    await RootMode.wakeCancel();
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
    });
}

async function maybeDoCheck() {
  if (checkCancel != null) {
    throw new Error(
      "Confirmation canceled: attempted to start a second check command!"
    );
  }

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

  checkCancel = new Gio.Cancellable();
  guiIdle(() => {
    shutdownTimerMenu._updateShutdownInfo(true);
  });
  _showTextbox(_("Waiting for confirmation") + maybeCheckCmdString(true));
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
      _showTextbox(_("Shutdown aborted") + `\n${checkCmd} (Code: ${code})`);
      throw err;
    })
    .finally(() => {
      checkCancel = null;
    });
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

function maybeCheckCmdString(nl = false) {
  const cmd = settings.get_string("check-command-value");
  return settings.get_boolean("enable-check-command-value") && cmd !== ""
    ? (nl ? "\n" : "") + cmd
    : "";
}

/* --- GUI main loop ---- */

/* ACTION FUNCTIONS */
async function wakeAction(mode, minutes) {
  try {
    switch (mode) {
      case "wake":
        return await RootMode.wake(minutes);
      case "no-wake":
        return await RootMode.wakeCancel();
      default:
        logError(new Error("Unknown wake mode: " + mode));
        return false;
    }
  } catch (err) {
    _showTextbox(_("Wake action failed!") + "\n" + err);
  }
}

function stopSchedule() {
  settings.set_int("shutdown-timestamp-value", -1);
  let showText = _("Shutdown Timer stopped");
  if (checkCancel != null) {
    checkCancel.cancel();
    showText = _("Confirmation canceled");
  }
  _showTextbox(showText);
}

function startSchedule(maxTimerMinutes) {
  const seconds = maxTimerMinutes * 60;
  settings.set_int(
    "shutdown-timestamp-value",
    GLib.DateTime.new_now_utc().to_unix() + Math.max(1, seconds)
  );
  _showTextbox(
    `${_("System will shutdown in")} ${maxTimerMinutes} ${_n(
      "minute",
      "minutes",
      maxTimerMinutes
    )}${maybeCheckCmdString(true)}`
  );
}

function guiIdle(func) {
  if (shutdownTimerMenu != null) {
    shutdownTimerMenu.guiIdle(func);
  }
}

/* EXTENSION MAIN FUNCTIONS */
function init() {
  // initialize translations
  ExtensionUtils.initTranslations();
}

function enable() {
  if (!initialized) {
    // initialize settings
    settings = ExtensionUtils.getSettings();
    MenuItem.init(settings, {
      wakeAction,
      startSchedule,
      stopSchedule,
      maybeStopRootModeProtection,
      maybeStartRootModeProtection,
      maybeStartWake,
      maybeStopWake,
    });

    // check for shutdown may run in background and can be canceled by user
    checkCancel = null;
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
    shutdownTimerMenu = new MenuItem.ShutdownTimer();
    statusMenu.menu.addMenuItem(shutdownTimerMenu);
  }
}

function disable() {
  Textbox._hideTextbox();
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
