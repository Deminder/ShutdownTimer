// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import { gettext as _ } from './translation.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import { logDebug } from './util.js';
import * as RootMode from './root-mode.js';

export class CheckCommand extends Signals.EventEmitter {
  #checkCancel = null;

  /**
   * Wait for the check command to execute successfully.
   *
   * @param {string} checkCmd check command
   * @param {Function} tickAsync tick function called every 30 seconds
   * @param {Function} onCommandLogLine called for each output line of the executed script
   */
  async doCheck(checkCmd, tickAsync, onCommandLogLine) {
    if (this.#checkCancel !== null) {
      throw new Error(
        'Confirmation canceled: attempted to start a second check command!'
      );
    }
    this.#checkCancel = new Gio.Cancellable();
    this.emit('change');

    await Promise.all([
      this.#check(checkCmd, onCommandLogLine),
      this.#continueTick(tickAsync),
    ]);
  }

  async #check(checkCmd, onCommandLogLine) {
    logDebug('[check] start');
    try {
      await RootMode.execCheck(
        checkCmd,
        this.#checkCancel,
        true,
        onCommandLogLine
      );
      logDebug('[check] confirmed');
    } finally {
      if (this.#checkCancel !== null) {
        // Cancel continueTick
        this.#checkCancel.cancel();
        this.#checkCancel = null;
      } else {
        logDebug('[check] canceled');
      }
      this.emit('change');
    }
  }

  async #continueTick(tickAsync) {
    logDebug('[check-tick] tickAsync');
    try {
      await tickAsync();
    } catch (err) {
      logError('[check-tick]', err);
    }
    try {
      await RootMode.execCheck(['sleep', '30'], this.#checkCancel, false);
      await this.continueTick(tickAsync);
    } catch {
      logDebug('[check-tick] Done');
    }
  }

  isChecking() {
    return this.#checkCancel !== null;
  }

  cancel() {
    const doCancel = this.isChecking();
    if (doCancel) {
      this.#checkCancel.cancel();
    }
    this.#checkCancel = null;
    return doCancel;
  }

  checkCommandString(settings) {
    return settings.get_boolean('enable-check-command-value')
      ? settings
          .get_string('check-command-value')
          .split('\n')
          .filter(line => !line.trimLeft().startsWith('#') && line.trim())
          .join('\n')
      : '';
  }
}
