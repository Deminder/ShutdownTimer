// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>, D. Neumann <neumann89@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Utils from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { currentSessionMode } from './modules/session-mode-aware.js';
import { ShutdownTimerIndicator } from './modules/menu-item.js';
import { logDebug } from './modules/util.js';
import { addExternalIndicator } from './modules/quicksettings.js';
import { InjectionTracker } from './modules/injection.js';
import { ShutdownTimerDBus } from './dbus-service/shutdown-timer-dbus.js';

export default class ShutdownTimer extends Extension {
  #sdt = null;

  enable() {
    const settings = this.getSettings();

    if (this.#sdt === null) {
      logDebug(`[ENABLE] '${currentSessionMode()}'`);
      settings.set_int('shutdown-timestamp-value', -1);
      this.#sdt = new ShutdownTimerDBus({ settings });
    } else {
      logDebug(`[ENABLE-PARTIAL] '${currentSessionMode()}'`);
    }

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

    const state = Main.extensionManager.lookup(this.uuid).state;
    if (state === Utils.ExtensionState.DISABLING) {
      this.#sdt.destroy();
      this.#sdt = null;
      logDebug(`[DISABLE-DONE] '${currentSessionMode()}' state: ${state}`);
    } else {
      // Only unpatch while rebasing extensions
      logDebug(`[DISABLE-PARTIAL] '${currentSessionMode()}' state: ${state}`);
    }
  }
}
