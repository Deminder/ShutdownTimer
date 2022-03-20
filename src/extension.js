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
  ScreenSaverAware,
  EndSessionDialogAware,
  CheckCommand,
} = Me.imports.lib;
const modeLabel = Me.imports.prefs.modeLabel;
const { longDurationString, logDebug } = Convenience;

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
let shutdownTimerMenu, timer, separator, settings;

let initialized = false;

function guiIdle(func) {
  if (shutdownTimerMenu !== undefined) {
    shutdownTimerMenu.guiIdle(func);
  }
}

function refreshExternalInfo() {
  if (shutdownTimerMenu !== undefined) {
    shutdownTimerMenu.refreshExternalInfo();
  }
}

function maybeShowTextbox(textmsg) {
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
        refreshExternalInfo();
        break;
      default:
        logDebug('No root mode protection stopped for: ' + info.mode);
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
 */
async function maybeStartRootModeProtection(info) {
  if (info.scheduled && settings.get_boolean('root-mode-value')) {
    logDebug('Start root mode protection for: ' + info.label);
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
        logDebug('No root mode protection started for: ' + info.mode);
      }
    } catch (err) {
      maybeShowTextbox(
        C_('Error', '%s\n%s').format(_('Root mode protection failed!'), err)
      );
      logError(err, 'EnableRootModeProtection');
    }
  }
}

async function maybeStartWake(wakeMinutes) {
  if (settings.get_boolean('auto-wake-value')) {
    await wakeAction('wake', wakeMinutes);
  }
}

async function maybeStopWake() {
  if (settings.get_boolean('auto-wake-value')) {
    await wakeAction('no-wake');
  }
}

// timer action (shutdown/reboot/suspend)
function serveInernalSchedule(mode) {
  const checkCmd = maybeCheckCmdString();
  CheckCommand.maybeDoCheck(
    checkCmd,
    mode,
    () => {
      guiIdle(() => {
        shutdownTimerMenu.checkRunning = true;
        shutdownTimerMenu._updateShutdownInfo();
      });
      maybeShowTextbox(checkCmd);
      maybeShowTextbox(
        _('Waiting for %s confirmation').format(modeLabel(mode))
      );
    },
    code => {
      maybeShowTextbox(checkCmd);
      maybeShowTextbox(
        C_('CheckCommand', '%s aborted (Code: %s)').format(
          modeLabel(mode),
          code
        )
      );
    },
    () =>
      guiIdle(() => {
        shutdownTimerMenu.checkRunning = false;
        shutdownTimerMenu._updateShutdownInfo();
      }),
    (done, success) => {
      const dueInfo = new ScheduleInfo.ScheduleInfo({ mode, deadline: 0 });
      if (done && !success) {
        // disable protection if check command failed
        return maybeStopRootModeProtection(dueInfo, true);
      }
      // keep protection
      return maybeStartRootModeProtection(dueInfo);
    }
  )
    .then(() => {
      // check succeeded: do shutdown
      shutdown(mode);
    })
    .catch(err => {
      logError(err, 'CheckError');
      // check failed: cancel shutdown
      if (settings.get_boolean('root-mode-value')) {
        RootMode.shutdownCancel();
        refreshExternalInfo();
      }
      if (settings.get_boolean('auto-wake-value')) {
        RootMode.wakeCancel();
        refreshExternalInfo();
      }
    })
    .finally(() => {
      // reset schedule timestamp
      settings.set_int('shutdown-timestamp-value', -1);
    });
}

function shutdown(mode) {
  Main.overview.hide();
  Textbox.hideAll();
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

/* ACTION FUNCTIONS */
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
      logError(new Error('Unknown wake mode: ' + mode));
      return false;
    }
  } catch (err) {
    maybeShowTextbox(
      C_('Error', '%s\n%s').format(_('Wake action failed!'), err)
    );
  }
}

function stopSchedule(stopProtection = true) {
  EndSessionDialogAware.unregister();
  const canceled = CheckCommand.maybeCancel();
  if (canceled || settings.get_int('shutdown-timestamp-value') > -1) {
    settings.set_int('shutdown-timestamp-value', -1);
    maybeShowTextbox(
      canceled ? _('Confirmation canceled') : _('Shutdown Timer stopped')
    );
  }

  if (stopProtection) {
    // stop root protection
    const info =
      timer !== undefined ? timer.info : new ScheduleInfo.ScheduleInfo();
    return Promise.all([maybeStopRootModeProtection(info), maybeStopWake()]);
  }
  return Promise.resolve();
}

async function startSchedule(maxTimerMinutes, wakeMinutes) {
  EndSessionDialogAware.unregister();
  if (CheckCommand.maybeCancel()) {
    // cancel running check command
    await RootMode.execCheck(['sleep', '0.1'], null, false).catch(() => {});
  }
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

function maybeCheckCmdString() {
  const cmd = settings
    .get_string('check-command-value')
    .split('\n')
    .filter(line => !line.trimLeft().startsWith('#') && line.trim())
    .join('\n');

  return settings.get_boolean('enable-check-command-value') ? cmd : '';
}

function onShutdownScheduleChange(info) {
  if (timer !== undefined) {
    timer.adjustTo(info);
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
    shutdownTimerMenu.checkRunning = CheckCommand.isChecking();
    timer.setTickCallback(
      shutdownTimerMenu._updateShutdownInfo.bind(shutdownTimerMenu)
    );
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
    // clear internal schedule and keep root protected schedule
    stopSchedule(false);
    ScreenSaverAware.unload();
    EndSessionDialogAware.unload();

    initialized = false;
    logDebug('Completly disabled. Screen saver is disabled.');
  } else {
    logDebug('Partially disabled. Screen saver is enabled.');
  }
}

function disable() {
  Textbox.hideAll();
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
