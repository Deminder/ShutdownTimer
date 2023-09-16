// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { loadInterfaceXML, logDebug } from '../modules/util.js';
import { Timer } from './timer.js';

export const ShutdownTimerName = 'org.gnome.Shell.Extensions.ShutdownTimer';
export const ShutdownTimerObjectPath =
  '/org/gnome/Shell/Extensions/ShutdownTimer';
export const ShutdownTimerIface = await loadInterfaceXML(ShutdownTimerName);

const Signals = imports.signals;

export class ShutdownTimerDBus {
  constructor({ settings, daemon }) {
    this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(
      ShutdownTimerIface,
      this
    );

    this._timer = new Timer({ settings });
    this._timer.connect('message', (_, msg) => {
      logDebug('[shutdown-timer-dbus] msg', msg);
      this._dbusImpl.emit_signal('OnMessage', new GLib.Variant('(s)', [msg]));
    });
    this._timer.connect('change', () => {
      logDebug('[shutdown-timer-dbus] state', this._timer.state);
      this._dbusImpl.emit_signal(
        'OnStateChange',
        new GLib.Variant('(s)', [this._timer.state])
      );
    });
    this._timer.connect('change-external', () => {
      this._dbusImpl.emit_signal('OnExternalChange', null);
    });
    if (daemon) {
      Gio.DBus.session.own_name(
        ShutdownTimerName,
        Gio.BusNameOwnerFlags.NONE,
        () => {
          logDebug(`[sdt-dbus] bus aquired`);
          this.register();
        },
        () => {
          logDebug('[sdt-dbus] name aquired');
        },
        () => {
          logDebug('[sdt-dbus] name lost');
          this.destroy();
        }
      );
    }
  }

  register() {
    this._dbusImpl.export(Gio.DBus.session, ShutdownTimerObjectPath);
  }

  unregister() {
    this._dbusImpl.unexport();
  }

  async ScheduleShutdownAsync(parameters, invocation) {
    const [shutdown, action] = parameters;
    logDebug(
      '[sdt-dbus] [ScheduleShutdownAsync] shutdown',
      shutdown,
      'action',
      action
    );
    await this._timer.toggleShutdown(shutdown, action);
    invocation.return_value(null);
  }

  async ScheduleWakeAsync(parameters, invocation) {
    const [wake] = parameters;
    logDebug('[sdt-dbus] [ScheduleWakeAsync] wake', wake);
    await this._timer.toggleWake(wake);
    invocation.return_value(null);
  }

  GetStateAsync(_, invocation) {
    logDebug('[sdt-dbus] [GetStateAsync]');
    invocation.return_value(new GLib.Variant('(s)', [this._timer.state]));
    return Promise.resolve();
  }

  destroy() {
    logDebug('[sdt-dbus] destroy');
    if (this._timer !== null) {
      this._timer.destroy();
      this._timer = null;
    }
    this.emit('destroy');
  }
}
Signals.addSignalMethods(ShutdownTimerDBus.prototype);
