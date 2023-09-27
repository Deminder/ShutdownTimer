// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>, D. Neumann <neumann89@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { currentSessionMode } from './modules/session-mode-aware.js';
import { ShutdownTimerIndicator } from './modules/menu-item.js';
import { logDebug } from './modules/util.js';
import { addExternalIndicator } from './modules/quicksettings.js';
import { InjectionTracker } from './modules/injection.js';
import { ShutdownTimerDBus } from './dbus-service/shutdown-timer-dbus.js';

export default class ShutdownTimer extends Extension {
  #sdt = null;
  #disableTimestamp = 0;

  enable() {
    const settings = this.getSettings();

    if (!this.#disableTimestamp || Date.now() > this.#disableTimestamp + 100) {
      logDebug('[ENABLE] Clear shutdown schedule');
      settings.set_int('shutdown-timestamp-value', -1);
    }

    logDebug(`[ENABLE] '${currentSessionMode()}'`);
    this.#sdt = new ShutdownTimerDBus({ settings });

    const indicator = new ShutdownTimerIndicator({
      path: this.path,
      settings,
    });
    indicator.connect('open-preferences', () => this.openPreferences());

    // Add ShutdownTimer indicator to quicksettings menu
    this._tracker = new InjectionTracker();
    addExternalIndicator(this._tracker, indicator);

    this._indicator = indicator;

    logDebug(`[ENABLE-DONE] '${currentSessionMode()}'`);
  }

  disable() {
    // Extension should not be disabled during unlock-dialog`:
    // When the `unlock-dialog` is active, the quicksettings indicator and item
    // should remain visible.
    logDebug(`[DISABLE] '${currentSessionMode()}'`);
    this._tracker.clearAll();
    this._tracker = null;

    this._indicator.destroy();
    this._indicator = null;

    this.#sdt.destroy();
    this.#sdt = null;
    this.#disableTimestamp = Date.now();
  }
}
