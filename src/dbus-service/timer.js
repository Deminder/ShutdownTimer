// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {
  gettext as _,
  ngettext as _n,
  pgettext as C_,
} from '../modules/translation.js';

import { logDebug } from '../modules/util.js';
import * as Control from './control.js';
import { CheckCommand } from './check-command.js';
import {
  longDurationString,
  ScheduleInfo,
  getShutdownScheduleFromSettings,
  getSliderMinutesFromSettings,
} from '../modules/schedule-info.js';
import { actionLabel, Action, mapLegacyAction } from './action.js';

const Signals = imports.signals;

export class Timer {
  _ignoreScheduleUpdate = false;
  _timerCancellable = null;
  _checkCommand = new CheckCommand();
  _action = new Action();
  info = {
    externalShutdown: new ScheduleInfo({
      external: true,
    }),
    externalWake: new ScheduleInfo({
      external: false,
      mode: 'wake',
    }),
    internalShutdown: new ScheduleInfo({ mode: 'PowerOff' }),
  };

  constructor({ settings }) {
    this._settings = settings;

    this._settingsIds = [
      settings.connect('changed::root-mode-value', () =>
        this._updateRootModeProtection()
      ),
      settings.connect('changed::shutdown-timestamp-value', () =>
        this.updateSchedule()
      ),
      settings.connect('changed::shutdown-mode-value', () =>
        this.updateSchedule()
      ),
    ];

    // React to changes of the check command
    this._checkCommand.connect('change', () => {
      this.emit('change');
    });
    this.updateSchedule();
  }

  destroy() {
    if (this._settings === null) {
      throw new Error('should not destroy twice');
    }
    // Disconnect settings
    this._settingsIds.forEach(id => this._settings.disconnect(id));
    this._settingsIds = [];
    this._settings = null;

    // Cancel internal timer
    if (this._timerCancellable !== null) {
      this._timerCancellable.cancel();
      this._timerCancellable = null;
    }

    // Cancel check-command
    this._checkCommand.destroy();
    this._checkCommand = null;
    // External schedules (for 'shutdown' and 'wake') are not stopped
  }

  updateSchedule() {
    const oldInternal = this.info.internalShutdown;
    const internal = getShutdownScheduleFromSettings(this._settings);
    this.info.internalShutdown = internal;
    logDebug(
      `[updateSchedule] internal schedule: ${internal.label} (ignore: ${this._ignoreScheduleUpdate})`
    );
    this._updateRootModeProtection(oldInternal);
    if (this._ignoreScheduleUpdate) return;
    if (
      internal.mode !== oldInternal.mode ||
      internal.deadline !== oldInternal.deadline
    ) {
      this.emit('change');
      const canceled = this._checkCommand.cancel();
      if (internal.scheduled) {
        if (internal.minutes > 0) {
          // Show schedule info
          this.emit(
            'message',
            this._checkCommand.checkCommandString(this._settings)
          );
          this.emit(
            'message',
            C_('StartSchedulePopup', '%s in %s').format(
              actionLabel(internal.mode),
              longDurationString(
                internal.minutes,
                h => _n('%s hour', '%s hours', h),
                m => _n('%s minute', '%s minutes', m)
              )
            )
          );
        } else {
          logDebug(`[updateSchedule] hidden message for '< 1 minute' schedule`);
        }
        if (this._timerCancellable !== null) {
          this._timerCancellable.cancel();
          this._timerCancellable = null;
        }
        this._actionPromise = this.executeActionDelayed()
          .then(() => {
            logDebug('[executeActionDelayed] done');
          })
          .catch(err => {
            console.error('executeActionDelayed', err);
          });
      } else {
        if (this._timerCancellable !== null) {
          this._timerCancellable.cancel();
          this._timerCancellable = null;
        }
        if (oldInternal.scheduled) {
          this.emit(
            'message',
            canceled ? _('Confirmation canceled') : _('Shutdown Timer stopped')
          );
        }
      }
    }
  }

  async executeAction() {
    const internal = this.info.internalShutdown;
    if (!internal.scheduled) {
      logDebug(`Refusing to exectute non scheduled action! '${internal.mode}'`);
      return;
    }
    logDebug(`Running '${internal.mode}' timer action...`);
    let checkCompleted = false;
    try {
      const checkCmd = this._checkCommand.checkCommandString(this._settings);
      if (checkCmd !== '') {
        this.emit('message', checkCmd);
        this.emit(
          'message',
          _('Waiting for %s confirmation').format(actionLabel(internal.mode))
        );
        await this._checkCommand.doCheck(
          checkCmd,
          () => this._updateRootModeProtection(),
          line => {
            if (!line.startsWith('[')) {
              this.emit('message', `'${line}'`);
            }
          }
        );
      }
      checkCompleted = true;
      this.emit('change');
      // Refresh root mode protection
      await Promise.all([
        this._updateRootModeProtection(),
        // Check succeeded: do shutdown
        this._action.shutdownAction(
          this.info.internalShutdown.mode,
          this._settings.get_boolean('show-end-session-dialog-value')
        ),
      ]);
    } catch (err) {
      if (/* destroyed */ this._settings === null) {
        throw err;
      }
      logDebug(
        `[executeAction] canceled (checkCompleted: ${checkCompleted})`,
        err
      );
      const newInternal = this.info.internalShutdown;
      if (newInternal.scheduled && newInternal.secondsLeft > 0) {
        logDebug('[timer] Replaced by new schedule.');
        return;
      }
      if (!checkCompleted) {
        // Check failed: log error
        let code = '?';
        if ('code' in err) {
          code = `${err.code}`;
        } else {
          console.error(err, 'CheckError');
        }
        logDebug(
          `[executeAction] check canceled ${internal.mode}. Code: ${code}`,
          err
        );
        this.emit(
          'message',
          C_('CheckCommand', '%s aborted (Code: %s)').format(
            actionLabel(internal.mode),
            code
          )
        );
      }
      await this.toggleShutdown(false);
    }
  }

  async executeActionDelayed() {
    const internal = this.info.internalShutdown;
    const secs = internal.secondsLeft;
    if (secs > 0) {
      logDebug(`Started delayed action: ${internal.minutes}min remaining`);
      try {
        this._timerCancellable = new Gio.Cancellable();
        await Control.execCheck(
          ['sleep', `${secs}`],
          this._timerCancellable,
          false
        );
        this._timerCancellable = null;
      } catch {
        logDebug(`Canceled delayed action: ${internal.minutes}min remaining`);
        return;
      }
    }
    await this.executeAction();
  }

  async toggleWake(wake) {
    try {
      logDebug('[toggleWake] wake', wake);
      await this._action.wakeAction(
        wake,
        getSliderMinutesFromSettings(this._settings, 'wake')
      );
      this.emit('change-external');
    } catch (err) {
      this.emit(
        'message',
        C_('Error', '%s\n%s').format(_('Wake action failed!'), err)
      );
      this._settings.set_int('shutdown-timestamp-value', -1);
    }
  }

  async toggleShutdown(shutdown, action) {
    logDebug('[toggleShutdown] shutdown', shutdown, 'action', action);
    if (action) {
      this._ignoreScheduleUpdate = true;
      this._settings.set_string('shutdown-mode-value', mapLegacyAction(action));
      this._ignoreScheduleUpdate = false;
    }
    this._settings.set_int(
      'shutdown-timestamp-value',
      shutdown
        ? GLib.DateTime.new_now_utc().to_unix() +
            Math.max(
              1,
              getSliderMinutesFromSettings(this._settings, 'shutdown') * 60
            )
        : -1
    );
    if (this._settings.get_boolean('auto-wake-value')) {
      await this.toggleWake(shutdown);
    }
  }

  get state() {
    if (this._checkCommand.isChecking()) {
      return 'check';
    } else if (this.info.internalShutdown.scheduled) {
      return this.info.internalShutdown.secondsLeft > 0 ? 'active' : 'action';
    } else {
      return 'inactive';
    }
  }

  /**
   * Ensure that shutdown/reboot is executed even if the Timer fails by running
   * the `shutdown` command delayed by 1 minute.
   */
  async _updateRootModeProtection(oldInternal) {
    if (this._settings.get_boolean('root-mode-value')) {
      const internal = this.info.internalShutdown;
      logDebug('[updateRootModeProtection] mode ', internal.mode);
      try {
        if (oldInternal?.scheduled && oldInternal.mode !== internal.mode) {
          await Control.stopRootModeProtection(oldInternal);
        }
        if (internal.scheduled) {
          await Control.startRootModeProtection(internal);
        } else {
          await Control.stopRootModeProtection(internal);
        }
      } catch (err) {
        this.emit(
          'message',
          C_('Error', '%s\n%s').format(_('Root mode protection failed!'), err)
        );
        console.error('[updateRootModeProtection]', err);
      }
      this.emit('change-external');
    }
  }
}
Signals.addSignalMethods(Timer.prototype);
