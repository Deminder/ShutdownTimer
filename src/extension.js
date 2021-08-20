/**
    AUTHOR: Daniel Neumann, Deminder
    GJS SOURCES: https://github.com/GNOME/gnome-shell/
    BUILD: ./scripts/build.sh
    UPDATE TRANSLATIONS: ./scripts/update-pod.sh
**/
/* exported INSTALL_ACTIONS, init, enable, disable */

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const {
  ScheduleInfo,
  MenuItem,
  Textbox,
  RootMode,
  Timer,
  Convenience,
  ScreenSaverAware,
  EndSessionDialogAware,
} = Me.imports.lib;
const modeLabel = Me.imports.prefs.modeLabel;
const { logDebug } = Convenience;

/* IMPORTS */
const { GLib, Gio } = imports.gi;
const LoginManager = imports.misc.loginManager;

// screen and main functionality
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

// translations
const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;
const C_ = Gettext.pgettext;
const _n = Gettext.ngettext;

/* GLOBAL VARIABLES */
let shutdownTimerMenu, timer, separator, settings, checkCancel, checkSuccess;

let initialized = false;
var INSTALL_ACTIONS;

function _showTextbox(textmsg) {
  if (settings.get_boolean('show-textboxes-value')) {
    guiIdle(() => {
      Textbox.showTextbox(textmsg);
    });
  }
}

async function maybeStopRootModeProtection(info, stopScheduled = false) {
  if (
    (stopScheduled || !info.scheduled) &&
    settings.get_boolean('root-mode-value')
  ) {
    logDebug('Stop root mode protection for: ' + info.mode);
    try {
      switch (info.mode) {
      case 'poweroff':
      case 'reboot':
        await RootMode.shutdownCancel();
        break;
      default:
        logDebug('No root mode protection stopped for: ' + info.mode);
      }
    } catch (err) {
      _showTextbox(
        C_('Error', '%s\n%s').format(_('Root mode protection failed!'), err)
      );
      logError(err, 'DisableRootModeProtection');
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
  if (info.scheduled && settings.get_boolean('root-mode-value')) {
    logDebug('Start root mode protection for: ' + info.label);
    try {
      const minutes = Math.max(0, info.minutes) + 1;
      switch (info.mode) {
      case 'poweroff':
        await RootMode.shutdown(minutes);
        break;
      case 'reboot':
        await RootMode.shutdown(minutes, true);
        break;
      default:
        logDebug('No root mode protection started for: ' + info.mode);
      }
    } catch (err) {
      _showTextbox(
        C_('Error', '%s\n%s').format(_('Root mode protection failed!'), err)
      );
      logError(err, 'EnableRootModeProtection');
    }
  }
}

async function maybeStartWake(wakeMinutes) {
  if (settings.get_boolean('auto-wake-value')) {
    await RootMode.wake(wakeMinutes);
  }
}

async function maybeStopWake() {
  if (settings.get_boolean('auto-wake-value')) {
    await RootMode.wakeCancel();
  }
}

// timer action (shutdown/reboot/suspend)
function serveInernalSchedule(mode) {
  maybeDoCheck(mode)
    .then(() => {
      // check succeeded: do shutdown
      shutdown(mode);
    })
    .catch(err => {
      logError(err, 'CheckError');
      // check failed: cancel shutdown
      if (settings.get_boolean('root-mode-value')) {
        RootMode.shutdownCancel();
      }
      if (settings.get_boolean('auto-wake-value')) {
        RootMode.wakeCancel();
      }
    })
    .finally(() => {
      // reset schedule timestamp
      settings.set_int('shutdown-timestamp-value', -1);
    });
}

function maybeDoCheck(mode) {
  if (checkCancel !== undefined) {
    throw new Error(
      'Confirmation canceled: attempted to start a second check command!'
    );
  }

  const checkCmd = maybeCheckCmdString();
  if (checkCmd === '') {
    return;
  }

  checkCancel = new Gio.Cancellable();
  guiIdle(() => {
    shutdownTimerMenu.checkRunning = true;
    shutdownTimerMenu._updateShutdownInfo();
  });
  _showTextbox(
    C_('CheckCommand', "%s\n'%s'").format(
      _('Waiting for %s confirmation').format(modeLabel(mode)),
      checkCmd
    )
  );
  checkSuccess = false;
  const checkWatchCancel = new Gio.Cancellable();
  continueRootProtectionDuringCheck(mode, checkWatchCancel);
  return RootMode.execCheck(checkCmd, checkCancel)
    .then(() => {
      checkSuccess = true;
      logDebug(`Check command "${checkCmd}" confirmed shutdown.`);
      return;
    })
    .catch(err => {
      let code = '?';
      if ('code' in err) {
        code = `${err.code}`;
        logDebug(`Check command aborted ${mode}. Code: ${code}`);
      }
      _showTextbox(
        C_('CheckCommand', '%s (Code: %s)').format(
          C_('CheckCommand', "%s\n'%s'").format(
            _('%s aborted').format(modeLabel(mode)),
            checkCmd
          ),
          code
        )
      );
      throw err;
    })
    .finally(() => {
      checkCancel = undefined;
      checkWatchCancel.cancel();
      guiIdle(() => {
        shutdownTimerMenu.checkRunning = false;
        shutdownTimerMenu._updateShutdownInfo();
      });
    });
}

async function continueRootProtectionDuringCheck(mode, cancellable) {
  await RootMode.execCheck(['sleep', '30'], cancellable, false).catch(() => {});
  const dueInfo = new ScheduleInfo.ScheduleInfo({ mode, deadline: 0 });
  if (checkCancel !== undefined && !checkCancel.is_cancelled()) {
    logDebug('RootProtection during check: Continue');
    await maybeStartRootModeProtection(dueInfo);
    await continueRootProtectionDuringCheck(mode, cancellable);
  } else {
    logDebug('RootProtection during check: Done');
    if (checkSuccess) {
      await maybeStartRootModeProtection(dueInfo);
    } else {
      await maybeStopRootModeProtection(dueInfo, true);
    }
  }
}

function shutdown(mode) {
  Main.overview.hide();
  const getSession = () => new imports.misc.gnomeSession.SessionManager();

  switch (mode) {
  case 'reboot':
    EndSessionDialogAware.register();
    getSession().RebootRemote(0);
    break;
  case 'suspend':
    LoginManager.getLoginManager().suspend();
    break;
  default:
    EndSessionDialogAware.register();
    getSession().ShutdownRemote(0); // shutdown after 60s
    break;
  }
}

function maybeCheckCmdString() {
  const cmd = settings.get_string('check-command-value');
  return settings.get_boolean('enable-check-command-value') ? cmd : '';
}

/* --- GUI main loop ---- */

/* ACTION FUNCTIONS */
async function wakeAction(mode, minutes) {
  try {
    switch (mode) {
    case 'wake':
      return await RootMode.wake(minutes);
    case 'no-wake':
      return await RootMode.wakeCancel();
    default:
      logError(new Error('Unknown wake mode: ' + mode));
      return false;
    }
  } catch (err) {
    _showTextbox(C_('Error', '%s\n%s').format(_('Wake action failed!'), err));
  }
}

function stopSchedule() {
  EndSessionDialogAware.unregister();
  if (
    checkCancel !== undefined ||
    settings.get_int('shutdown-timestamp-value') > -1
  ) {
    settings.set_int('shutdown-timestamp-value', -1);
    let showText = _('Shutdown Timer stopped');
    if (checkCancel !== undefined) {
      checkCancel.cancel();
      showText = _('Confirmation canceled');
    }
    _showTextbox(showText);
  }

  // stop root protection
  const info = timer !== undefined ? timer.info : new ScheduleInfo.ScheduleInfo();
  return Promise.all([maybeStopRootModeProtection(info), maybeStopWake()]);
}

async function startSchedule(maxTimerMinutes, wakeMinutes) {
  EndSessionDialogAware.unregister();
  if (checkCancel !== undefined) {
    // cancel running check command
    if (!checkCancel.is_cancelled()) {
      checkCancel.cancel();
      await RootMode.execCheck(['sleep', '0.1'], null, false).catch(() => {});
    }
  }
  const seconds = maxTimerMinutes * 60;
  const info = new ScheduleInfo.ScheduleInfo({
    mode: settings.get_string('shutdown-mode-value'),
    deadline: GLib.DateTime.new_now_utc().to_unix() + Math.max(1, seconds),
  });
  settings.set_int('shutdown-timestamp-value', info.deadline);
  let startPopupText = C_('StartSchedulePopup', '%s in %s').format(
    modeLabel(info.mode),
    _n('%s minute', '%s minutes', maxTimerMinutes).format(maxTimerMinutes)
  );
  const checkCmd = maybeCheckCmdString();
  if (checkCmd !== '') {
    startPopupText = C_('CheckCommand', "%s\n'%s'").format(
      startPopupText,
      checkCmd
    );
  }
  _showTextbox(startPopupText);

  // start root protection
  await Promise.all([
    maybeStartRootModeProtection(info),
    maybeStartWake(wakeMinutes),
  ]);
}

function onShutdownScheduleChange(info) {
  if (timer !== undefined) {
    timer.adjustTo(info);
  }
}

function guiIdle(func) {
  if (shutdownTimerMenu !== undefined) {
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
      onShutdownScheduleChange,
    });

    // check for shutdown may run in background and can be canceled by user
    checkCancel = undefined;
    // starts internal shutdown schedule if ready
    timer = new Timer.Timer(serveInernalSchedule);

    ScreenSaverAware.load();

    EndSessionDialogAware.load(stopSchedule);

    initialized = true;
  }

  // add separator line and submenu in status area menu
  const statusMenu = Main.panel.statusArea['aggregateMenu'];
  if (separator === undefined) {
    separator = new PopupMenu.PopupSeparatorMenuItem();
    statusMenu.menu.addMenuItem(separator);
  }
  if (shutdownTimerMenu === undefined) {
    shutdownTimerMenu = new MenuItem.ShutdownTimer();
    shutdownTimerMenu.checkRunning = checkCancel !== undefined;
    timer.setTickCallback(() => shutdownTimerMenu._updateShutdownInfo());
    statusMenu.menu.addMenuItem(shutdownTimerMenu);
  }
}

async function maybeCompleteDisable() {
  const sleepCancel = new Gio.Cancellable();
  const changePromise = ScreenSaverAware.screenSaverTurnsActive(3, sleepCancel);
  let active = await ScreenSaverAware.screenSaverGetActive();
  if (!active) {
    active = await changePromise;
  } else {
    sleepCancel.cancel();
  }
  if (!initialized) {
    throw new Error('Already completely disabled!');
  }
  if (shutdownTimerMenu !== undefined) {
    throw new Error('Extension is enabled. Complete disable aborted!');
  }
  if (!active) {
    // screen saver inactive => the user probably disabled the extension

    if (timer !== undefined) {
      timer.stopTimer();
      timer = undefined;
    }
    if (checkCancel !== undefined) {
      checkCancel.cancel();
      checkCancel = undefined;
    }
    ScreenSaverAware.unload();
    EndSessionDialogAware.unload();

    initialized = false;
    logDebug('Completly disabled. Screen saver is disabled.');
  } else {
    logDebug('Partially disabled. Screen saver is enabled.');
  }
}

function disable() {
  Textbox._hideTextbox();
  if (shutdownTimerMenu !== undefined) {
    shutdownTimerMenu.destroy();
    if (timer !== undefined) {
      timer.setTickCallback(null);
      // keep sleep process alive
      timer.stopGLibTimer();
    }
  }
  shutdownTimerMenu = undefined;
  if (separator !== undefined) {
    separator.destroy();
  }
  separator = undefined;

  if (initialized) {
    maybeCompleteDisable().catch(error => {
      logDebug(`Partially disabled. ${error}`);
    });
  }
}
