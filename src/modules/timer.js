// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { gettext as _, ngettext as _n, pgettext as C_ } from './translation.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import { logDebug } from './util.js';
import { longDurationString, modeLabel } from './schedule-info.js';
import * as RootMode from './root-mode.js';
import * as SessionModeAware from './session-mode-aware.js';
import { Textbox } from './text-box.js';
import { ESDAware } from './end-session-dialog-aware.js';
import { CheckCommand } from './check-command.js';
import { InfoFetcher } from './info-fetcher.js';
import {
  ScheduleInfo,
  getShutdownScheduleFromSettings,
  getSliderMinutesFromSettings,
} from './schedule-info.js';
import * as Action from './action.js';

export class Timer extends Signals.EventEmitter {
  constructor({ settings }) {
    super();
    this.info = {
      externalShutdown: new ScheduleInfo({
        external: true,
      }),
      externalWake: new ScheduleInfo({
        external: false,
        mode: 'wake',
      }),
      internalShutdown: new ScheduleInfo({ mode: 'shutdown' }),
      checkCommandRunning: false,
    };
    this._actionCancellable = null;
    this._textbox = new Textbox({ settings });
    this._checkCommand = new CheckCommand();
    this._esdAware = new ESDAware();
    this._infoFetcher = new InfoFetcher();

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
    // React to changes in external shutdown and wake schedule
    this._infoFetcher.connect('changed', () => {
      this.info.externalShutdown = this.info.externalShutdown.copy({
        ...this._infoFetcher.shutdownInfo,
      });
      this.info.externalWake = this.info.externalWake.copy({
        ...this._infoFetcher.wakeInfo,
      });
      this.emit('info-change');
    });

    // React to changes of the check command
    this._checkCommand.connect('change', () => {
      this.info.checkCommandRunning = this._checkCommand.isChecking();
      this.emit('info-change');
    });
    this.updateSchedule();
  }

  async destroy() {
    // Disconnect settings
    this._settingsIds.forEach(id => this._settings.disconnect(id));
    this._settingsIds = [];
    this._settings = null;

    // Cancel check-command
    this._checkCommand.cancel();
    this._checkCommand = null;

    // Cancel internal timer
    // Note that root commands (e.g. 'shutdown' and 'wake') are not canceled
    if (this._actionCancellable !== null) this._actionCancellable.cancel();
    if (this._actionPromise !== null) await this._actionPromise;

    this._infoFetcher.destroy();
    this._infoFetcher = null;
    this._esdAware.destroy();
    this._esdAware = null;
    this._textbox.destroy();
    this._textbox = null;
  }

  updateSchedule() {
    const oldInternal = this.info.internalShutdown;
    const internal = getShutdownScheduleFromSettings(this._settings);
    this.info.internalShutdown = internal;
    logDebug(`[updateSchedule] internal schedule: ${internal.label}`);
    this._updateRootModeProtection(oldInternal);
    if (
      internal.mode !== oldInternal.mode ||
      internal.deadline !== oldInternal.deadline
    ) {
      this.emit('internal-info');
      const canceled = this._checkCommand.cancel();
      if (internal.scheduled) {
        if (internal.secondsLeft > 0) {
          if (internal.minutes > 0) {
            // Show schedule info
            this.#textboxShow(
              this._checkCommand.checkCommandString(this._settings)
            );
            this.#textboxShow(
              C_('StartSchedulePopup', '%s in %s').format(
                modeLabel(internal.mode),
                longDurationString(
                  internal.minutes,
                  h => _n('%s hour', '%s hours', h),
                  m => _n('%s minute', '%s minutes', m)
                )
              )
            );
          } else {
            logDebug(
              `[updateSchedule] hidden textbox for '< 1 minute' schedule`
            );
          }
          if (this._actionCancellable !== null) {
            this._actionCancellable.cancel();
          }
          this._actionCancellable = new Gio.Cancellable();
          this._actionPromise = this.executeActionDelayed(
            this._actionCancellable
          )
            .then(() => {
              logDebug('[executeActionDelayed] done');
            })
            .catch(err => {
              console.error('executeActionDelayed', err);
            })
            .finally(() => {
              this._actionCancellable = null;
            });
        } else {
          logDebug('[updateSchedule] ignore expired schedule!');
        }
      } else {
        if (this._actionCancellable !== null) {
          this._actionCancellable.cancel();
          this._actionCancellable = null;
        }
        if (oldInternal.scheduled) {
          this.#textboxShow(
            canceled ? _('Confirmation canceled') : _('Shutdown Timer stopped')
          );
        }
      }
    }
  }

  async executeAction(cancellable) {
    const internal = this.info.internalShutdown;
    if (!internal.scheduled) {
      logDebug(`Refusing to exectute non scheduled action! '${internal.mode}'`);
      return;
    }
    logDebug(`Running '${internal.mode}' timer action...`);
    try {
      const checkCmd = this._checkCommand.checkCommandString(this._settings);
      if (checkCmd !== '') {
        this.#textboxShow(checkCmd);
        this.#textboxShow(
          _('Waiting for %s confirmation').format(modeLabel(internal.mode))
        );
        await this._checkCommand.doCheck(
          checkCmd,
          () => this._updateRootModeProtection(),
          line => {
            if (!line.startsWith('[')) {
              this.#textboxShow(`'${line}'`);
            }
          },
          cancellable
        );
      }
      // Check succeeded: do shutdown
      if (SessionModeAware.foregroundActive()) Main.overview.hide();
      this.#textboxHideAll();
      Action.shutdownAction(
        this._settings,
        () => this.toggleShutdown(false),
        this._esdAware
      );

      // Refresh root mode protection
      await this._updateRootModeProtection();
    } catch (err) {
      // Check failed: log error
      let code = '?';
      if ('code' in err) {
        code = `${err.code}`;
      } else {
        console.error(err, 'CheckError');
      }
      logDebug(`[executeAction] abort ${internal.mode}. Code: ${code}`, err);
      this.#textboxShow(
        C_('CheckCommand', '%s aborted (Code: %s)').format(
          modeLabel(internal.mode),
          code
        )
      );
      this.toggleShutdown(false);
    }
  }

  #textboxHideAll() {
    if (this._textbox) this._textbox.hideAll();
  }

  #textboxShow(message) {
    if (this._textbox) this._textbox.showTextbox(message);
  }

  async executeActionDelayed(cancellable) {
    const internal = this.info.internalShutdown;
    const secs = internal.secondsLeft;
    if (secs > 0) {
      logDebug(`Started delayed action: ${internal.minutes}min remaining`);
      try {
        await RootMode.execCheck(['sleep', `${secs}`], cancellable, false);
      } catch {
        logDebug(`Canceled delayed action: ${internal.minutes}min remaining`);
        return;
      }
    }
    await this.executeAction(cancellable);
  }

  async toggleWake(wake) {
    try {
      await Action.wakeAction(
        wake,
        getSliderMinutesFromSettings(this._settings, 'wake')
      );
      this._infoFetcher.refresh();
    } catch (err) {
      this._textbox.showTextbox(
        C_('Error', '%s\n%s').format(_('Wake action failed!'), err)
      );
      this._settings.set_int('shutdown-timestamp-value', -1);
    }
  }

  async toggleShutdown(shutdown) {
    if (this._settings !== null) {
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
    } else {
      logDebug('[toggleShutdown] skip when destroying');
    }
  }

  /**
   * Ensure that shutdown/reboot is executed even if the Timer fails by running
   * the `shutdown` command delayed by 1 minute.
   */
  async _updateRootModeProtection(oldInternal) {
    if (this._settings.get_boolean('root-mode-value')) {
      const internal = this.info.internalShutdown;
      try {
        if (oldInternal?.scheduled && oldInternal.mode !== internal.mode) {
          await RootMode.stopRootModeProtection(oldInternal);
        }
        if (internal.scheduled) {
          await RootMode.startRootModeProtection(internal);
        } else {
          await RootMode.stopRootModeProtection(internal);
        }
      } catch (err) {
        this.showTextbox(
          C_('Error', '%s\n%s').format(_('Root mode protection failed!'), err)
        );
        console.error(err, 'updateRootModeProtection');
      }
      this._infoFetcher.refresh();
    }
  }
}
