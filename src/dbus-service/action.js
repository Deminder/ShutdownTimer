// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import * as Control from './control.js';
import { proxyPromise } from '../modules/util.js';
import { pgettext as C_, gettext as _ } from '../modules/translation.js';
import { logDebug } from '../modules/util.js';

export const ACTIONS = {
  PowerOff: 0,
  Reboot: 1,
  Suspend: 2,
  SuspendThenHibernate: 3,
  Hibernate: 4,
  HybridSleep: 5,
  Halt: 6,
};

export const WAKE_ACTIONS = { wake: 100, 'no-wake': 101 };

/**
 * Get supported actions.
 * In order to show an error when shutdown or reboot are not supported
 * they are always included here. */
export async function* supportedActions() {
  const actionDbus = new Action();
  for await (const action of Object.keys(ACTIONS).map(async a =>
    ['PowerOff', 'Reboot'].includes(a) ||
    (await actionDbus.canShutdownAction(a))
      ? a
      : null
  )) {
    if (action) {
      yield action;
    }
  }
}

export class UnsupportedActionError extends Error {}

export class Action {
  #cancellable = new Gio.Cancellable();
  #cookie = null;

  #loginProxy = proxyPromise(
    'org.freedesktop.login1.Manager',
    Gio.DBus.system,
    'org.freedesktop.login1',
    '/org/freedesktop/login1',
    this.#cancellable
  );

  #screenSaverProxy = proxyPromise(
    'org.gnome.ScreenSaver',
    Gio.DBus.session,
    'org.gnome.ScreenSaver',
    '/org/gnome/ScreenSaver',
    this.#cancellable
  );

  #sessionProxy = proxyPromise(
    'org.gnome.SessionManager',
    Gio.DBus.session,
    'org.gnome.SessionManager',
    '/org/gnome/SessionManager',
    this.#cancellable
  );

  destroy() {
    if (this.#cancellable !== null) {
      this.#cancellable.cancel();
      this.#cancellable = null;
    }
  }

  #poweroffOrReboot(action) {
    return [ACTIONS.PowerOff, ACTIONS.Reboot].includes(ACTIONS[action]);
  }

  /**
   * Perform the shutdown action.
   *
   * @param {string} action the shutdown action
   * @param {boolean} showEndSessionDialog show the end session dialog or directly shutdown
   *
   * @returns {Promise} resolves on action completion
   */
  async shutdownAction(action, showEndSessionDialog) {
    if (!(action in ACTIONS))
      throw new Error(`Unknown shutdown action: ${action}`);
    logDebug('[shutdownAction]', action);

    await this.uninhibitSuspend();

    const screenSaverProxy = await this.#screenSaverProxy;
    const [screenSaverActive] = await screenSaverProxy.GetActiveAsync();
    if (
      showEndSessionDialog &&
      !screenSaverActive &&
      this.#poweroffOrReboot(action)
    ) {
      const sessionProxy = await this.#sessionProxy;
      if (action === 'PowerOff') {
        await sessionProxy.ShutdownAsync();
      } else {
        await sessionProxy.RebootAsync();
      }
    } else {
      const loginProxy = await this.#loginProxy;
      if (await this.canShutdownAction(action)) {
        await loginProxy[`${action}Async`](true);
      } else if (this.#poweroffOrReboot(action)) {
        await Control.shutdown('now', ACTIONS[action] === ACTIONS.Reboot);
      } else {
        throw new UnsupportedActionError();
      }
    }
  }

  /**
   * Check if a shutdown action can be performed (without authentication).
   *
   * @returns {Promise} resolves to `true` if action can be performed, otherwise `false`.
   */
  async canShutdownAction(action) {
    const loginProxy = await this.#loginProxy;
    if (!(action in ACTIONS))
      throw new Error(`Unknown shutdown action: ${action}`);
    const [result] = await loginProxy[`Can${action}Async`]();
    return result === 'yes';
  }

  /**
   * Schedule a wake after some minutes or cancel
   *
   * @param {boolean} wake
   * @param {number} minutes
   */
  async wakeAction(wake, minutes) {
    if (wake) {
      await Control.wake(minutes);
    } else {
      await Control.wakeCancel();
    }
  }

  async inhibitSuspend() {
    if (this.#cookie === null) {
      const sessionProxy = await this.#sessionProxy;
      const [cookie] = await sessionProxy.InhibitAsync(
        'user',
        0,
        'Inhibit by Shutdown Timer (GNOME-Shell extension)',
        /* Suspend flag */ 4
      );
      this.#cookie = cookie;
    }
  }

  async uninhibitSuspend() {
    if (this.#cookie !== null) {
      const sessionProxy = await this.#sessionProxy;
      await sessionProxy.UninhibitAsync(this.#cookie);
      this.#cookie = null;
    }
  }
}

/**
 * Get the translated action label
 *
 * @param action
 */
export function actionLabel(action) {
  return {
    SuspendThenHibernate: _('Suspend then Hibernate'),
    HybridSleep: _('Hybrid Sleep'),
    Hibernate: _('Hibernate'),
    Halt: _('Halt'),
    Suspend: _('Suspend'),
    PowerOff: _('Power Off'),
    Reboot: _('Restart'),
    wake: _('Wake'),
    'no-wake': _('No Wake'),
  }[action];
}

export function checkText(action) {
  return {
    SuspendThenHibernate: C_('checktext', 'suspend then hibernate'),
    HybridSleep: C_('checktext', 'hybrid sleep'),
    Hibernate: C_('checktext', 'hibernate'),
    Halt: C_('checktext', 'halt'),
    Suspend: C_('checktext', 'suspend'),
    PowerOff: C_('checktext', 'shutdown'),
    Reboot: C_('checktext', 'reboot'),
    wake: C_('checktext', 'wakeup'),
  }[action];
}

export function untilText(action) {
  return {
    SuspendThenHibernate: C_('untiltext', 'suspend and hibernate'),
    HybridSleep: C_('untiltext', 'hybrid sleep'),
    Hibernate: C_('untiltext', 'hibernate'),
    Halt: C_('untiltext', 'halt'),
    Suspend: C_('untiltext', 'suspend'),
    PowerOff: C_('untiltext', 'shutdown'),
    Reboot: C_('untiltext', 'reboot'),
    wake: C_('untiltext', 'wakeup'),
  }[action];
}

export function mapLegacyAction(action) {
  return action in ACTIONS || ['wake', ''].includes(action)
    ? action
    : {
        poweroff: 'PowerOff',
        shutdown: 'PowerOff',
        reboot: 'Reboot',
        suspend: 'Suspend',
      }[action] ??
        {
          p: 'PowerOff',
          r: 'Reboot',
          s: 'Suspend',
          h: 'SuspendThenHibernate',
        }[action[0].toLowerCase()];
}
