// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>, D. Neumann <neumann89@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { currentSessionMode } from './modules/session-mode-aware.js';
import { ShutdownTimerIndicator } from './modules/menu-item.js';
import { Timer } from './modules/timer.js';
import { logDebug } from './modules/util.js';
import { addExternalIndicator } from './modules/quicksettings.js';
import { InjectionTracker } from './modules/injection.js';

export default class ShutdownTimer extends Extension {
  disableTimestamp = 0;

  enable() {
    logDebug(
      `[ENABLE] '${currentSessionMode()}' (last enabled: ${
        this.disableTimestamp ? new Date(this.disableTimestamp) : 'unknown'
      })`
    );
    const settings = this.getSettings();

    if (!this.disableTimestamp || Date.now() > this.disableTimestamp + 100) {
      logDebug('[enable] clear shutdown schedule');
      settings.set_int('shutdown-timestamp-value', -1);
    }

    const timer =
      this._timer ??
      new Timer({
        settings,
      });

    const indicator = new ShutdownTimerIndicator({
      path: this.path,
      settings,
      info: timer.info,
    });

    indicator.connect('wake', (__, wake) => timer.toggleWake(wake));
    indicator.connect('shutdown', (__, shutdown) =>
      timer.toggleShutdown(shutdown)
    );
    indicator.connect('open-preferences', () => this.openPreferences());

    timer.connectObject(
      'info-change',
      () => indicator.setInfo(timer.info),
      indicator
    );

    // Add ShutdownTimer indicator to quicksettings menu
    this._tracker = new InjectionTracker();
    addExternalIndicator(this._tracker, indicator);

    this._settings = settings;
    this._indicator = indicator;
    this._timer = timer;
    logDebug(`[ENABLE-DONE] '${currentSessionMode()}'`);
  }

  disable() {
    // Extension should reenable in unlock-dialog`:
    // When the `unlock-dialog` is active, the quicksettings indicator and item
    // should remain visible.
    logDebug(`[DISABLE] '${currentSessionMode()}'`);
    this._tracker.clearAll();
    this._tracker = null;

    this._indicator.destroy();
    this._indicator = null;

    this._settings = null;

    this._timer.destroy();
    this._timer = null;
    this.disableTimestamp = Date.now();
    logDebug(
      `[DISABLE-DONE] '${currentSessionMode()}' (now: ${new Date(
        this.disableTimestamp
      )})`
    );
  }
}
