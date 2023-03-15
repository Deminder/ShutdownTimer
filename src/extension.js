/**
 * Shutdown Timer Extension for GNOME Shell
 *
 * @author Deminder <tremminder@gmail.com>
 * @author D. Neumann <neumann89@gmail.com>
 * @copyright 2014-2023
 * @license GNU General Public License v3.0
 */
/* exported init */

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

const { throttleTimeout, modeLabel, longDurationString, logDebug } =
  Convenience;

/* IMPORTS */
const { GLib } = imports.gi;
const LoginManager = imports.misc.loginManager;

// screen and main functionality
const Main = imports.ui.main;

// translations
const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;
const C_ = Gettext.pgettext;
const _n = Gettext.ngettext;

/**
 * Check if we want to show foreground activity
 */
function foregroundActive() {
  // ubuntu22.04 uses 'ubuntu' as 'user' sessionMode
  return Main.sessionMode.currentMode !== 'unlock-dialog';
}

class Extension {
  constructor() {
    ExtensionUtils.initTranslations();
    this._settings = null;
    this._indicator = null;
    this._currentScheduleUpdate = null;
    this._pendingScheduleUpdate = false;
    this._currentExecuteAction = null;
    this._pendingEnable = false;
    this._disablePromise = null;
    this._autoWakeMinutes = -1;
    this._disableThrottled = null;
    this._disableThrottledCancel = null;
  }

  enable() {
    logDebug(`[ENABLE] '${Main.sessionMode.currentMode}'`);
    if (this._disableThrottled === null) {
      if (this._disablePromise === null) {
        [this._disableThrottled, this._disableThrottledCancel] =
          throttleTimeout(() => this.completeDisable(), 100);
        this._settings = ExtensionUtils.getSettings();
        this._settingsIds = [
          ['root-mode-value', () => this.updateRootModeProtection()],
          ['shutdown-timestamp-value', () => this.updateSchedule()],
          ['shutdown-mode-value', () => this.updateSchedule()],
        ].map(([prop, func]) =>
          this._settings.connect(`changed::${prop}`, func)
        );

        // check for shutdown may run in background and can be canceled by user
        // starts internal shutdown schedule if ready
        this._timer = new Timer.Timer();
        this._timerActionId = this._timer.connect('action', () =>
          this.executeAction()
        );

        SessionModeAware.load(sessionMode => {
          // Disable the foreground activity during unlock-dialog
          logDebug(`sessionMode: ${sessionMode}`);
          if (sessionMode === 'unlock-dialog') this.disableForeground();
          else this.enableForeground();
        });

        // Clear shutdown schedule and keep root protected schedule
        this.scheduleShutdown(-1, true);
      } else {
        // Wait for disable promise to complete before enabling
        logDebug('pending [ENABLE]');
        this._pendingEnable = true;
      }
    } else {
      this._disableThrottledCancel();
    }

    if (foregroundActive()) {
      this.enableForeground();
      logDebug(`[ENABLE COMPLETE] '${Main.sessionMode.currentMode}'`);
    } else {
      logDebug(`[ENABLE BACKGROUND] '${Main.sessionMode.currentMode}'`);
    }
  }

  disable() {
    // Unlock-dialog session-mode required:
    // the timer action has to execute even when the screen is locked
    logDebug(`[DISABLE] '${Main.sessionMode.currentMode}'`);
    if (this._pendingEnable) {
      logDebug(`abort pending [ENABLE] '${Main.sessionMode.currentMode}'`);
      this._pendingEnable = false;
    }
    this.disableForeground();
    // Delay complete disable to avoid stopping the timer when switching to the unlock-dialog.
    // Unlock-dialog behavior/bug in GNOME 42,43,44:
    // On unlock-dialog activation disable() and enable() are called in quick succession.
    this._disableThrottled();
  }

  completeDisable() {
    if (this._disableThrottled === null) return;
    this._disableThrottled = null;
    this._disableThrottledCancel();
    this._disableThrottledCancel = null;
    CheckCommand.maybeCancel();
    const unresolved = [];
    if (this._currentExecuteAction !== null)
      unresolved.push(this._currentExecuteAction);
    if (this._currentScheduleUpdate !== null)
      unresolved.push(this._currentScheduleUpdate);

    this._disablePromise = Promise.all(unresolved).then(() => {
      this._disablePromise = null;
      if (this._pendingEnable) {
        this._pendingEnable = false;
        this.enable();
        return;
      }

      this._timer.disconnect(this._timerActionId);
      this._timer.stopTimer();
      this._timer = null;
      SessionModeAware.unload();

      for (const handlerId of this._settingsIds) {
        this._settings.disconnect(handlerId);
      }
      this._settingsIds = null;

      this._settings.set_int('shutdown-timestamp-value', -1);
      this._settings = null;
      logDebug(`[DISABLE COMPLETE] '${Main.sessionMode.currentMode}'`);
    });
  }

  enableForeground() {
    if (this._indicator !== null) {
      return;
    }

    // Add to ShutdownTimer indicator to quicksettings menu
    const qs = Main.panel.statusArea.quickSettings;
    this._indicator = new MenuItem.ShutdownTimerIndicator();
    this._indicator.connect('wake', (__, wake) =>
      this.wakeAction(wake, this._indicator.wake_minutes)
    );
    this._indicator.connect('shutdown', (__, shutdown) => {
      if (shutdown) {
        this.scheduleShutdown(
          GLib.DateTime.new_now_utc().to_unix() +
            Math.max(1, this._indicator.shutdown_minutes * 60)
        );
      } else {
        this.scheduleShutdown(-1);
      }
    });
    qs._indicators.add_child(this._indicator);
    qs._addItems(this._indicator.quickSettingsItems);
    this._osdTextbox = new Textbox.OsdTextbox();

    // stop schedule if endSessionDialog cancel button is activated
    this._esdAware = new EndSessionDialogAware.ESDAware();
    logDebug('Enabled foreground.');
  }

  disableForeground() {
    if (this._indicator === null) {
      return;
    }
    this._osdTextbox.destroy();
    this._osdTextbox = null;
    this._indicator.destroy();
    this._indicator = null;

    this._esdAware.destroy();
    this._esdAware = null;
    logDebug('Disabled foreground.');
  }

  /**
   * Show a text message on the primary monitor
   *
   * @param {string} textmsg
   */
  showTextbox(textmsg) {
    if (this._osdTextbox !== null && textmsg)
      this._osdTextbox.showTextbox(textmsg);
  }

  executeAction() {
    if (this._currentExecuteAction === null)
      this._currentExecuteAction = this._executeAction()
        .then(() => {
          this._currentExecuteAction = null;
        })
        .catch(e => {
          logError(e, 'executeAction');
        });
  }

  async _executeAction() {
    const info = this.shutdownScheduleInfo;
    if (!info.scheduled) {
      logDebug(`Refusing to exectute non scheduled action! '${info.mode}'`);
      return;
    }
    logDebug(`Running '${info.mode}' timer action...`);
    const checkCmd = this.checkCommandString;
    try {
      if (checkCmd !== '') {
        this.showTextbox(checkCmd);
        this.showTextbox(
          _('Waiting for %s confirmation').format(modeLabel(info.mode))
        );
        const check = CheckCommand.doCheck(
          checkCmd,
          line => {
            if (!line.startsWith('[')) {
              this.showTextbox(`'${line}'`);
            }
          },
          // Keep root mode protection alive
          () => this.updateRootModeProtection()
        );
        if (this._indicator !== null) this._indicator.emit('external-info');
        await check;
      }
      // Check succeeded: do shutdown
      if (foregroundActive()) Main.overview.hide();
      if (this._osdTextbox !== null) this._osdTextbox.hideAll();

      if (['reboot', 'poweroff'].includes(info.mode)) {
        if (
          foregroundActive() &&
          this._settings.get_boolean('show-end-session-dialog-value')
        ) {
          const session = new imports.misc.gnomeSession.SessionManager();
          // Call stopSchedule if endSessionDialog is canceled
          this._esdAware.react(name => {
            logDebug(`[EndSessionDialog] action: ${name}`);
            if (name === 'Canceled') this.scheduleShutdown(-1);
          });
          if (info.mode === 'reboot') {
            session.RebootRemote(0);
          } else {
            session.ShutdownRemote(0);
          }
        } else {
          imports.misc.util.spawnCommandLine(
            info.mode === 'reboot' ? 'reboot' : 'poweroff'
          );
        }
      } else if (info.mode === 'suspend') {
        LoginManager.getLoginManager().suspend();
      } else {
        throw new Error(`Unknown shutdown mode: ${info.mode}`);
      }
      // Refresh root mode protection
      await this.updateRootModeProtection();
    } catch (err) {
      // Check failed: log error
      let code = '?';
      if ('code' in err) {
        code = `${err.code}`;
        logDebug(`Check command aborted ${info.mode}. Code: ${code}`);
      } else {
        logError(err, 'CheckError');
      }
      this.showTextbox(
        C_('CheckCommand', '%s aborted (Code: %s)').format(
          modeLabel(info.mode),
          code
        )
      );
      this.scheduleShutdown(-1);
    }
  }

  /**
   * Schedule a wake after some minutes or cancel
   *
   * @param {boolean} wake
   * @param {number} minutes
   */
  async wakeAction(wake, minutes) {
    try {
      if (wake) {
        await RootMode.wake(minutes);
      } else {
        await RootMode.wakeCancel();
      }
    } catch (err) {
      this.showTextbox(
        C_('Error', '%s\n%s').format(_('Wake action failed!'), err)
      );
    }
    this.refreshExternalInfo();
  }

  updateSchedule() {
    if (this._currentScheduleUpdate === null)
      this._currentScheduleUpdate = this._updateSchedule()
        .then(() => {
          logDebug('[updateSchedule] done');
          this._currentScheduleUpdate = null;
          this._softScheduleUpdate = false;
        })
        .catch(e => {
          logError(e, 'updateSchedule');
          this.scheduleShutdown(-1, true);
        });
    else this._pendingScheduleUpdate = true;
  }

  async _updateSchedule() {
    if (this._indicator !== null) this._indicator.emit('external-info');
    const info = this.shutdownScheduleInfo;
    const oldInfo = this._timer.info;
    if (!this._softScheduleUpdate) {
      if (this._autoWakeMinutes > -1)
        await this.wakeAction(info.scheduled, this._autoWakeMinutes);
      await this.updateRootModeProtection();
    }
    if (
      info.scheduled !== oldInfo.scheduled ||
      info.mode !== oldInfo.mode ||
      info.deadline !== oldInfo.deadline
    ) {
      logDebug(`[_updateSchedule] schedule: ${info.label}`);
      const canceled = CheckCommand.maybeCancel();
      if (!this._softScheduleUpdate) {
        // Show schedule info
        if (info.scheduled) {
          const startStr = C_('StartSchedulePopup', '%s in %s').format(
            modeLabel(info.mode),
            longDurationString(
              info.minutes,
              h => _n('%s hour', '%s hours', h),
              m => _n('%s minute', '%s minutes', m)
            )
          );
          if (info.minutes > 0) {
            this.showTextbox(this.checkCommandString);
            this.showTextbox(startStr);
          } else logDebug(`hidden textbox: ${startStr}`);
        } else if (oldInfo.scheduled)
          this.showTextbox(
            canceled ? _('Confirmation canceled') : _('Shutdown Timer stopped')
          );
      }
      // Adjust timer which will signal the shutdown `action` on completion
      this._timer.adjustTo(info);
    }

    // Run pending update
    if (this._pendingScheduleUpdate) {
      this._pendingScheduleUpdate = false;
      await this._updateSchedule();
    }
  }

  scheduleShutdown(timestamp, soft = false) {
    this._autoWakeMinutes =
      this._indicator !== null && this._settings.get_boolean('auto-wake-value')
        ? this._indicator.wake_minutes
        : -1;
    if (this._settings.get_int('shutdown-timestamp-value') !== timestamp) {
      if (soft) this._softScheduleUpdate = true;
      this._settings.set_int('shutdown-timestamp-value', timestamp);
    }
  }

  get shutdownScheduleInfo() {
    return new ScheduleInfo.ScheduleInfo({
      mode: this._settings.get_string('shutdown-mode-value'),
      deadline: this._settings.get_int('shutdown-timestamp-value'),
    });
  }

  get checkCommandString() {
    return this._settings.get_boolean('enable-check-command-value')
      ? this._settings
          .get_string('check-command-value')
          .split('\n')
          .filter(line => !line.trimLeft().startsWith('#') && line.trim())
          .join('\n')
      : '';
  }

  /**
   *
   * Ensure that shutdown is executed even if the Timer fails by running
   * the `shutdown` command delayed by 1 minute.
   * The external schedule of the `shutdown` command is fetched by the InfoFetcher.
   * There is no external schedule for `suspend`.
   *
   */
  async updateRootModeProtection() {
    if (!this._settings.get_boolean('root-mode-value')) return;
    const info = this.shutdownScheduleInfo;
    const oldInfo = this._timer.info;
    const protect = async i => {
      if (i.mode in { poweroff: 1, reboot: 1 })
        await (i.scheduled
          ? RootMode.shutdown(Math.max(0, i.minutes) + 1, i.mode === 'reboot')
          : RootMode.shutdownCancel());
    };
    try {
      if (oldInfo.scheduled && oldInfo.mode !== info.mode)
        await protect(oldInfo.copy({ deadline: -1 }));
      await protect(info);
      logDebug(`Updated root mode protection for: ${info.label}`);
    } catch (err) {
      this.showTextbox(
        C_('Error', '%s\n%s').format(_('Root mode protection failed!'), err)
      );
      logError(err, 'updateRootModeProtection');
    }
    this.refreshExternalInfo();
  }

  refreshExternalInfo() {
    if (this._indicator !== null) {
      this._indicator.emit('external-info');
    }
  }
}

function init() {
  return new Extension();
}
