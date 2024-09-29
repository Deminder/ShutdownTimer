// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {
  gettext as _,
  ngettext as _n,
  pgettext as C_,
} from '../modules/translation.js';

import { logDebug, throttleTimeout } from '../modules/util.js';
import * as Control from './control.js';
import {
  longDurationString,
  ScheduleInfo,
  getShutdownScheduleFromSettings,
  getSliderMinutesFromSettings,
} from '../modules/schedule-info.js';
import {
  actionLabel,
  Action,
  mapLegacyAction,
  UnsupportedActionError,
} from './action.js';

const Signals = imports.signals;

export class Timer {
  _timerCancellable = null;
  _updateScheduleCancel = null;
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

    const [updateScheduleThrottled, updateScheduleCancel] = throttleTimeout(
      () => this.updateSchedule(),
      20
    );
    this._updateScheduleCancel = updateScheduleCancel;
    this._settingsIds = [
      'root-mode-value',
      'shutdown-timestamp-value',
      'shutdown-mode-value',
    ].map(settingName =>
      settings.connect(`changed::${settingName}`, updateScheduleThrottled)
    );

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

    // Cancel schedule updates
    if (this._updateScheduleCancel !== null) {
      this._updateScheduleCancel();
      this._updateScheduleCancel = null;
    }

    // Cancel internal timer
    if (this._timerCancellable !== null) {
      this._timerCancellable.cancel();
      this._timerCancellable = null;
    }

    // External schedules (for 'shutdown' and 'wake') are not stopped
  }

  updateSchedule() {
    const oldInternal = this.info.internalShutdown;
    const internal = getShutdownScheduleFromSettings(this._settings);
    this.info.internalShutdown = internal;
    logDebug(
      `[updateSchedule] internal schedule: ${internal.label} (old internal schedule: ${oldInternal.label})`
    );
    this._updateRootModeProtection(oldInternal);
    if (
      internal.mode !== oldInternal.mode ||
      internal.deadline !== oldInternal.deadline
    ) {
      this.emit('change');
      if (internal.scheduled) {
        if (internal.minutes > 0) {
          // Show schedule info
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
        this.executeActionDelayed()
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
          this.emit('message', _('Shutdown Timer stopped'));
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
    try {
      this.emit('change');
      // Refresh root mode protection
      await Promise.all([
        this._updateRootModeProtection(),
        // Do shutdown
        this._action.shutdownAction(
          internal.mode,
          this._settings.get_boolean('show-end-session-dialog-value')
        ),
      ]);
    } catch (err) {
      if (/* destroyed */ this._settings === null) {
        throw err;
      }
      const newInternal = this.info.internalShutdown;
      if (newInternal.scheduled && newInternal.secondsLeft > 0) {
        logDebug('[timer] Replaced by new schedule.');
        return;
      }
      if (err instanceof UnsupportedActionError) {
        this.emit(
          'message',
          _('%s is not supported!').format(actionLabel(internal.mode))
        );
      }
    }
    await this.toggleShutdown(false);
  }

  async executeActionDelayed() {
    const internal = this.info.internalShutdown;
    const secs = internal.secondsLeft;
    if (secs > 0) {
      logDebug(`Started delayed action: ${internal.minutes}min remaining`);
      try {
        this._timerCancellable = new Gio.Cancellable();
        await Control.sleepUntilDeadline(
          internal.deadline,
          this._timerCancellable
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
      this._settings.set_string('shutdown-mode-value', mapLegacyAction(action));
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
    if (shutdown) {
      await this._action.inhibitSuspend();
    } else {
      await this._action.uninhibitSuspend();
    }
    if (this._settings.get_boolean('auto-wake-value')) {
      await this.toggleWake(shutdown);
    }
  }

  get state() {
    return this.info.internalShutdown.scheduled
      ? this.info.internalShutdown.secondsLeft > 0
        ? 'active'
        : 'action'
      : 'inactive';
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
