// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export const debugMode = false;

/**
 * Log debug message if debug is enabled .
 *
 * @param {...any} args log arguments
 */
export function logDebug(...args) {
  if ('logDebug' in globalThis) {
    globalThis.logDebug(...args);
  } else if (debugMode) {
    console.log('[SDT]', ...args);
  }
}

export async function proxyPromise(
  ProxyTypeOrName,
  session,
  dest,
  objectPath,
  cancellable = null
) {
  if (typeof ProxyTypeOrName === 'string') {
    try {
      ProxyTypeOrName = Gio.DBusProxy.makeProxyWrapper(
        await loadInterfaceXML(ProxyTypeOrName, cancellable)
      );
    } catch (err) {
      throw new Error('Failed to load proxy interface!', { cause: err });
    }
  }
  const p = await new Promise((resolve, reject) => {
    new ProxyTypeOrName(
      session,
      dest,
      objectPath,
      (proxy, error) => {
        if (error) {
          reject(error);
        } else {
          resolve(proxy);
        }
      },
      cancellable
    );
  });
  return p;
}

export class Idle {
  #idleSourceId = null;
  #idleResolves = [];

  destroy() {
    // Ensure that promises are resolved
    for (const resolve of this.#idleResolves) {
      resolve();
    }
    this.#idleResolves = [];
    if (this.#idleSourceId) {
      GLib.Source.remove(this.#idleSourceId);
    }
    this.#idleSourceId = null;
  }

  /**
   * Resolves when event loop is idle
   */
  guiIdle() {
    return new Promise(resolve => {
      this.#idleResolves.push(resolve);
      if (!this.#idleSourceId) {
        this.#idleSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          for (const res of this.#idleResolves) {
            res();
          }
          this.#idleResolves = [];
          this.#idleSourceId = null;
          return GLib.SOURCE_REMOVE;
        });
      }
    });
  }
}

/**
 * Calls to `event` are delayed (throttled).
 * Call `cancel` drop last event.
 *
 * @param {Function} timeoutFunc called function after delay
 * @param {number} delayMillis delay in milliseconds
 * @returns [event, cancel]
 */
export function throttleTimeout(timeoutFunc, delayMillis) {
  let current = null;
  return [
    () => {
      if (current === null) {
        current = setTimeout(() => {
          current = null;
          timeoutFunc();
        }, delayMillis);
      }
    },
    () => {
      if (current) {
        clearTimeout(current);
        current = null;
      }
    },
  ];
}

export function extensionDirectory() {
  const utilModulePath = /(.*)@file:\/\/(.*):\d+:\d+$/.exec(
    new Error().stack.split('\n')[1]
  )[2];
  const extOrModuleDir = GLib.path_get_dirname(
    GLib.path_get_dirname(utilModulePath)
  );
  // This file is either at /modules/util.js or /modules/sdt/util.js
  return GLib.path_get_basename(extOrModuleDir) === 'modules'
    ? GLib.path_get_dirname(extOrModuleDir)
    : extOrModuleDir;
}

export function readFileAsync(pathOrFile, cancellable = null) {
  return new Promise((resolve, reject) => {
    try {
      const file =
        typeof pathOrFile === 'string'
          ? Gio.File.new_for_path(pathOrFile)
          : pathOrFile;
      file.load_contents_async(cancellable, (f, res) => {
        try {
          const [, contents] = f.load_contents_finish(res);
          const decoder = new TextDecoder('utf-8');
          resolve(decoder.decode(contents));
        } catch (err) {
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

export async function loadInterfaceXML(iface, cancellable = null) {
  const readPromises = [
    Gio.File.new_for_path(
      `${extensionDirectory()}/dbus-interfaces/${iface}.xml`
    ),
    Gio.File.new_for_uri(
      `resource:///org/gnome/shell/dbus-interfaces/${iface}.xml`
    ),
  ].map(async file => {
    try {
      return await readFileAsync(file, cancellable);
    } catch (err) {
      return '';
    }
  });
  for await (const xml of readPromises) {
    if (xml) return xml;
  }
  throw new Error(
    `Failed to load D-Bus interface '${iface}'${
      cancellable && cancellable.is_cancelled() ? ' (canceled)' : ''
    }`
  );
}
