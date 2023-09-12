// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { bindtextdomain } from 'gettext';

import { ShutdownTimerDBus, ShutdownTimerName } from './shutdown-timer-dbus.js';
import {
  extensionDirectory,
  readFileAsync,
  proxyPromise,
  getDBusServiceFile,
  logDebug,
} from '../modules/util.js';

async function main() {
  const loop = new GLib.MainLoop(null, false);

  // Provide a format function which replaces %s
  if (!String.prototype.format) {
    String.prototype.format = function (...args) {
      let i = 0;
      return this.replace(/%s/g, () => args[i++]);
    };
  }

  const dir = extensionDirectory();
  const metaData = JSON.parse(await readFileAsync(`${dir}/metadata.json`));

  // Initialize translations
  bindtextdomain(metaData['gettext-domain'], `${dir}/locale`);

  const sdt = new ShutdownTimerDBus({
    settings: new Gio.Settings({
      settings_schema: Gio.SettingsSchemaSource.new_from_directory(
        `${dir}/schemas`,
        Gio.SettingsSchemaSource.get_default(),
        false
      ).lookup(metaData['settings-schema'], true),
    }),
    daemon: true,
  });
  sdt.connect('destroy', () => loop.quit());

  // Stop when gnome shell is not running
  Gio.DBus.watch_name(
    Gio.BusType.SESSION,
    'org.gnome.Shell',
    Gio.BusNameWatcherFlags.NONE,
    null,
    () => sdt.destroy()
  );

  // Stop when extension is disabled longer than 100ms
  const shellProxy = await proxyPromise(
    'org.gnome.Shell.Extensions',
    Gio.DBus.session,
    'org.gnome.Shell.Extensions',
    '/org/gnome/Shell/Extensions'
  );
  const checkEnabled = async () => {
    const [info] = await shellProxy.GetExtensionInfoAsync(metaData['uuid']);
    logDebug('[main] extension state: ', info.state.unpack());
    return info.state.unpack() === /* ENABLED */ 1;
  };
  let destroyTimeoutId = 0;
  shellProxy.connectSignal(
    'ExtensionStateChanged',
    (_, __, [uuid, extensionInfo]) => {
      if (uuid === metaData['uuid']) {
        if (destroyTimeoutId) {
          clearTimeout(destroyTimeoutId);
          destroyTimeoutId = 0;
        }
        const state = extensionInfo.state.unpack();
        logDebug('[main] changed extension state:', state);
        if (state !== /* ENABLED */ 1) {
          destroyTimeoutId = setTimeout(() => sdt.destroy(), 100);
        }
      }
    }
  );
  // Stop when extension is not enabled on startup
  if (!(await checkEnabled())) {
    logDebug(`[main] Extension is ${metaData['uuid']} not enabled!`);
    sdt.destroy();
  } else {
    await loop.runAsync();
  }
  logDebug('[main] Quit.');
}

try {
  await main();
} finally {
  // Cleanup dbus service file
  const dbusServiceFile = getDBusServiceFile(ShutdownTimerName);
  try {
    await new Promise((resolve, reject) =>
      dbusServiceFile.delete_async(GLib.PRIORITY_DEFAULT, null, (f, res) => {
        try {
          f.delete_finish(res);
          resolve();
        } catch (err) {
          reject(err);
        }
      })
    );
    logDebug(
      `[main] Deleted dbus service file: ${dbusServiceFile.get_path()}.`
    );
  } catch (err) {
    console.warn(
      `[main] Failed to delete dbus service file: ${dbusServiceFile.get_path()}`,
      err
    );
  }
}
