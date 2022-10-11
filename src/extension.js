/**
 * Shutdown Timer Extension for GNOME Shell
 *
 * @author Deminder <tremminder@gmail.com>
 * @author D. Neumann <neumann89@gmail.com>
 * @copyright 2014-2021
 * @license GNU General Public License v3.0
 */
/* exported init, enable, disable */

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const {
  ScheduleInfo,
  MenuItem,
  Textbox,
  RootMode,
  Timer,
  Convenience,
  EndSessionDialogAware,
  SessionModeAware,
  CheckCommand,
} = Me.imports.lib;

const {
  guiIdle,
  throttleTimeout,
  disableGuiIdle,
  modeLabel,
  enableGuiIdle,
  longDurationString,
  logDebug,
} = Convenience;

/* IMPORTS */
const { GLib } = imports.gi;
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
let shutdownTimerMenu, timer, separator, settings;

let initialized = false;

/**
 *
 */
function refreshExternalInfo() {
  if (shutdownTimerMenu !== undefined) {
    shutdownTimerMenu.infoFetcher.refresh();
  }
}

/**
 *
 * @param textmsg
 */
function maybeShowTextbox(textmsg) {
  if (settings.get_boolean('show-textboxes-value')) {
    guiIdle(() => {
      Textbox.showTextbox(textmsg);
    });
  }
}

/**
 *
 * @param info
 * @param stopScheduled
 */
async function maybeStopRootModeProtection(info, stopScheduled = false) {
  if (
    (stopScheduled || !info.scheduled) &&
    settings.get_boolean('root-mode-value')
  ) {
    logDebug(`Stop root mode protection for: ${info.mode}`);
    try {
      switch (info.mode) {
        case 'poweroff':
        case 'reboot':
          await RootMode.shutdownCancel();
          refreshExternalInfo();
          break;
        default:
          logDebug(`No root mode protection stopped for: ${info.mode}`);
      }
    } catch (err) {
      maybeShowTextbox(
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
 * @param info
 */
async function maybeStartRootModeProtection(info) {
  if (info.scheduled && settings.get_boolean('root-mode-value')) {
    logDebug(`Start root mode protection for: ${info.label}`);
    try {
      const minutes = Math.max(0, info.minutes) + 1;
      switch (info.mode) {
        case 'poweroff':
          await RootMode.shutdown(minutes);
          refreshExternalInfo();
          break;
        case 'reboot':
          await RootMode.shutdown(minutes, true);
          refreshExternalInfo();
          break;
        default:
          logDebug(`No root mode protection started for: ${info.mode}`);
      }
    } catch (err) {
      maybeShowTextbox(
        C_('Error', '%s\n%s').format(_('Root mode protection failed!'), err)
      );
      logError(err, 'EnableRootModeProtection');
    }
  }
}

/**
 *
 * @param wakeMinutes
 */
async function maybeStartWake(wakeMinutes) {
  if (settings.get_boolean('auto-wake-value')) {
    await wakeAction('wake', wakeMinutes);
  }
}

/**
 *
 */
async function maybeStopWake() {
  if (settings.get_boolean('auto-wake-value')) {
    await wakeAction('no-wake');
  }
}

// timer action (shutdown/reboot/suspend)
/**
 *
 * @param mode
 */
async function serveInernalSchedule(mode) {
  const checkCmd = maybeCheckCmdString();
  try {
    if (checkCmd !== '') {
      guiIdle(() => {
        shutdownTimerMenu.checkRunning = true;
        shutdownTimerMenu.updateShutdownInfo();
      });
      maybeShowTextbox(checkCmd);
      maybeShowTextbox(
        _('Waiting for %s confirmation').format(modeLabel(mode))
      );
      await CheckCommand.doCheck(
        checkCmd,
        line => {
          if (!line.startsWith('[')) {
            maybeShowTextbox(`'${line}'`);
          }
        },
        async () => {
          // keep protection alive
          await maybeStartRootModeProtection(
            new ScheduleInfo.ScheduleInfo({ mode, deadline: 0 })
          );
        }
      );
    }
    // check succeeded: do shutdown
    shutdown(mode);
  } catch (err) {
    logError(err, 'CheckError');
    // check failed: cancel shutdown
    // stop root protection
    await maybeStopRootModeProtection(
      new ScheduleInfo.ScheduleInfo({ mode, deadline: 0 }),
      true
    );
    try {
      const root = settings.get_boolean('root-mode-value');
      if (root) {
        await RootMode.shutdownCancel();
      }
      const wake = settings.get_boolean('auto-wake-value');
      if (wake) {
        await RootMode.wakeCancel();
      }
      if (root || wake) {
        refreshExternalInfo();
      }
    } catch (err2) {
      // error is most likely: script not installed
      logError(err2, 'CheckError');
    }
    // check failed: log failure
    let code = '?';
    if ('code' in err) {
      code = `${err.code}`;
      logDebug(`Check command aborted ${mode}. Code: ${code}`);
    }
    maybeShowTextbox(
      C_('CheckCommand', '%s aborted (Code: %s)').format(modeLabel(mode), code)
    );
    if (parseInt(code) === 19) {
      maybeShowTextbox(_('Confirmation canceled'));
    }
  } finally {
    // update shutdownTimerMenu
    guiIdle(() => {
      shutdownTimerMenu.checkRunning = false;
      shutdownTimerMenu.updateShutdownInfo();
    });
    // reset schedule timestamp
    settings.set_int('shutdown-timestamp-value', -1);
  }
}

/**
 *
 */
function foregroundActive() {
  // ubuntu22.04 uses 'ubuntu' as 'user' sessionMode
  return Main.sessionMode.currentMode !== 'unlock-dialog';
}

/**
 *
 * @param mode
 */
function shutdown(mode) {
  if (foregroundActive()) {
    Main.overview.hide();
    Textbox.hideAll();
  }

  if (['reboot', 'poweroff'].includes(mode)) {
    if (
      foregroundActive() &&
      settings.get_boolean('show-end-session-dialog-value')
    ) {
      // show endSessionDialog
      // refresh root shutdown protection
      maybeStartRootModeProtection(
        new ScheduleInfo.ScheduleInfo({ mode, deadline: 0 })
      );
      EndSessionDialogAware.register();
      const session = new imports.misc.gnomeSession.SessionManager();
      if (mode === 'reboot') {
        session.RebootRemote(0);
      } else {
        session.ShutdownRemote(0);
      }
    } else {
      imports.misc.util.spawnCommandLine(
        mode === 'reboot' ? 'reboot' : 'poweroff'
      );
    }
  } else if (mode === 'suspend') {
    LoginManager.getLoginManager().suspend();
  } else {
    logError(new Error(`Unknown shutdown mode: ${mode}`));
  }
}

/* ACTION FUNCTIONS */
/**
 *
 * @param mode
 * @param minutes
 */
async function wakeAction(mode, minutes) {
  try {
    switch (mode) {
      case 'wake':
        await RootMode.wake(minutes);
        refreshExternalInfo();
        return;
      case 'no-wake':
        await RootMode.wakeCancel();
        refreshExternalInfo();
        return;
      default:
        logError(new Error(`Unknown wake mode: ${mode}`));
        return;
    }
  } catch (err) {
    maybeShowTextbox(
      C_('Error', '%s\n%s').format(_('Wake action failed!'), err)
    );
  }
}

/**
 *
 * @param stopProtection
 */
function stopSchedule(stopProtection = true) {
  EndSessionDialogAware.unregister();
  const canceled = CheckCommand.maybeCancel();
  if (!canceled && settings.get_int('shutdown-timestamp-value') > -1) {
    settings.set_int('shutdown-timestamp-value', -1);
    maybeShowTextbox(_('Shutdown Timer stopped'));
  }

  if (stopProtection) {
    // stop root protection
    const info =
      timer !== undefined ? timer.info : new ScheduleInfo.ScheduleInfo();
    return Promise.all([maybeStopRootModeProtection(info), maybeStopWake()]);
  }
  return Promise.resolve();
}

/**
 *
 * @param maxTimerMinutes
 * @param wakeMinutes
 */
async function startSchedule(maxTimerMinutes, wakeMinutes) {
  EndSessionDialogAware.unregister();
  CheckCommand.maybeCancel();

  const seconds = maxTimerMinutes * 60;
  const info = new ScheduleInfo.ScheduleInfo({
    mode: settings.get_string('shutdown-mode-value'),
    deadline: GLib.DateTime.new_now_utc().to_unix() + Math.max(1, seconds),
  });
  settings.set_int('shutdown-timestamp-value', info.deadline);
  let startPopupText = C_('StartSchedulePopup', '%s in %s').format(
    modeLabel(info.mode),
    longDurationString(
      maxTimerMinutes,
      h => _n('%s hour', '%s hours', h),
      m => _n('%s minute', '%s minutes', m)
    )
  );
  const checkCmd = maybeCheckCmdString();
  if (checkCmd !== '') {
    maybeShowTextbox(checkCmd);
  }
  maybeShowTextbox(startPopupText);

  // start root protection
  await Promise.all([
    maybeStartRootModeProtection(info),
    maybeStartWake(wakeMinutes),
  ]);
}

/**
 *
 */
function maybeCheckCmdString() {
  const cmd = settings
    .get_string('check-command-value')
    .split('\n')
    .filter(line => !line.trimLeft().startsWith('#') && line.trim())
    .join('\n');

  return settings.get_boolean('enable-check-command-value') ? cmd : '';
}

/**
 *
 * @param info
 */
function onShutdownScheduleChange(info) {
  if (timer !== undefined) {
    timer.adjustTo(info);
  }
}

/**
 *
 * @param sessionMode
 */
function onSessionModeChange(sessionMode) {
  logDebug(`sessionMode: ${sessionMode}`);
  switch (sessionMode) {
    case 'unlock-dialog':
      disableForeground();
      break;
    case 'user':
    default:
      enableForeground();
      break;
  }
}

/**
 *
 */
function enableForeground() {
  enableGuiIdle();
  // add separator line and submenu in status area menu
  const statusMenu = Main.panel.statusArea['aggregateMenu'];
  if (separator === undefined) {
    separator = new PopupMenu.PopupSeparatorMenuItem();
    statusMenu.menu.addMenuItem(separator);
  }
  if (shutdownTimerMenu === undefined) {
    shutdownTimerMenu = new MenuItem.ShutdownTimer();
    shutdownTimerMenu.checkRunning = CheckCommand.isChecking();
    timer.setTickCallback(
      shutdownTimerMenu.updateShutdownInfo.bind(shutdownTimerMenu)
    );
    statusMenu.menu.addMenuItem(shutdownTimerMenu);
  }
  // stop schedule if endSessionDialog cancel button is activated
  EndSessionDialogAware.load(stopSchedule);
  logDebug('Enabled foreground.');
}

/**
 *
 */
function disableForeground() {
  disableGuiIdle();
  Textbox.hideAll();
  if (shutdownTimerMenu !== undefined) {
    shutdownTimerMenu.destroy();
    if (timer !== undefined) {
      timer.setTickCallback(null);
      // keep sleep process alive
      timer.stopForeground();
    }
  }
  shutdownTimerMenu = undefined;
  if (separator !== undefined) {
    separator.destroy();
  }
  separator = undefined;
  EndSessionDialogAware.unload();
  logDebug('Disabled foreground.');
}

/* EXTENSION MAIN FUNCTIONS */
/**
 *
 */
function init() {
  // initialize translations
  ExtensionUtils.initTranslations();
}

let throttleDisable = null;
let throttleDisableCancel = null;

/**
 *
 */
function enable() {
  if (!initialized) {
    [throttleDisable, throttleDisableCancel] = throttleTimeout(
      completeDisable,
      100
    );
    // initialize settings
    settings = ExtensionUtils.getSettings();
    // ensure that no shutdown is scheduled
    settings.set_int('shutdown-timestamp-value', -1);
    MenuItem.init(settings, {
      wakeAction,
      startSchedule,
      stopSchedule,
      maybeStopRootModeProtection,
      maybeStartRootModeProtection,
      onShutdownScheduleChange,
    });
    Textbox.init();

    // check for shutdown may run in background and can be canceled by user
    // starts internal shutdown schedule if ready
    timer = new Timer.Timer(serveInernalSchedule);

    SessionModeAware.load(onSessionModeChange);

    initialized = true;
  } else {
    throttleDisableCancel();
  }
  if (foregroundActive()) {
    enableForeground();
    logDebug('Completly enabled.');
  } else {
    logDebug('Background enabled.');
  }
}

/**
 *
 */
function disable() {
  // unlock-dialog session-mode is required such that the timer action can trigger
  disableForeground();
  // DELAYED DISABLE:
  // Workaround for Gnome 42 weird behaviour (?unlock-dialog sessionMode bug?):
  // on first screensaver activation after login gnome-shell quickly enables/disables this extension
  // for each extension that is also enabled besides this extension
  if (initialized) {
    throttleDisable();
  }
}

/**
 *
 */
function completeDisable() {
  if (initialized) {
    if (timer !== undefined) {
      timer.stopTimer();
      timer = undefined;
    }
    Textbox.uninit();
    MenuItem.uninit();
    // clear internal schedule and keep root protected schedule
    stopSchedule(false);
    SessionModeAware.unload();

    throttleDisableCancel();
    throttleDisable = null;
    throttleDisableCancel = null;
    initialized = false;
    logDebug('Completly disabled.');
  }
}
