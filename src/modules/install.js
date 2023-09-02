// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { gettext as _ } from './translation.js';

import { execCheck, installedScriptPath } from './root-mode.js';
import { logDebug } from './util.js';

export class Install {
  destroy() {
    if (this.installCancel !== undefined) {
      this.installCancel.cancel();
    }
    this.installCancel = undefined;
  }

  /**
   * @param installerScriptPath
   * @param action
   * @param logInstall
   */
  async installAction(installerScriptPath, action, logInstall) {
    const label = this.actionLabel(action);
    if (this.installCancel !== undefined) {
      logDebug(`Trigger cancel install. ${label}`);
      this.installCancel.cancel();
    } else {
      logDebug(`Trigger ${action} action.`);
      this.installCancel = new Gio.Cancellable();
      logInstall(`[${_('START')} ${label}]`);
      try {
        const user = GLib.get_user_name();
        logDebug(`? installer.sh --tool-user ${user} ${action}`);
        await execCheck(
          ['pkexec', installerScriptPath, '--tool-user', user, action],
          this.installCancel,
          false,
          logInstall
        );
        logInstall(`[${_('END')} ${label}]`);
      } catch (err) {
        logInstall(`[${_('FAIL')} ${label}]\n# ${err}`);
        console.error(err, 'InstallError');
      } finally {
        this.installCancel = undefined;
      }
    }
  }

  checkInstalled() {
    const scriptPath = installedScriptPath();
    const isInstalled = scriptPath !== null;
    if (isInstalled) {
      logDebug(`Existing installation at: ${scriptPath}`);
    }
    return isInstalled;
  }

  actionLabel(action) {
    return { install: _('install'), uninstall: _('uninstall') }[action];
  }
}
