// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';
import * as GnomeSession from 'resource:///org/gnome/shell/misc/gnomeSession.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import { gettext as _ } from './translation.js';
import { foregroundActive } from './session-mode-aware.js';
import * as RootMode from './root-mode.js';
import { logDebug } from './util.js';

/**
 * Perform the shutdown action.
 * The specific action is specified by the `shutdown-mode-value` setting
 *
 * @param {object} settings
 * @param {Function} onCanceled called when end-session-dialog is canceled
 * @param {ESDAware} esdAware
 */
export function shutdownAction(settings, onCanceled, esdAware) {
  const action = settings.get_string('shutdown-mode-value');
  if (['reboot', 'poweroff'].includes(action)) {
    if (
      foregroundActive() &&
      settings.get_boolean('show-end-session-dialog-value')
    ) {
      const session = new GnomeSession.SessionManager();
      // Call stopSchedule if endSessionDialog is canceled
      esdAware.dialogSignal().then(name => {
        logDebug(`[EndSessionDialog] action: ${name}`);
        if (name === 'cancel') onCanceled();
      });
      if (action === 'reboot') {
        session.RebootRemote(0);
      } else {
        session.ShutdownRemote(0);
      }
    } else {
      Util.spawnCommandLine(action === 'reboot' ? 'reboot' : 'poweroff');
    }
  } else if (action === 'suspend') {
    LoginManager.getLoginManager().suspend();
  } else {
    throw new Error(`Unknown shutdown mode: ${action}`);
  }
}

/**
 * Schedule a wake after some minutes or cancel
 *
 * @param {boolean} wake
 * @param {number} minutes
 */
export async function wakeAction(wake, minutes) {
  if (wake) {
    await RootMode.wake(minutes);
  } else {
    await RootMode.wakeCancel();
  }
}
