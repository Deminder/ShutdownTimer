// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { gettext as _ } from './translation.js';

import { logDebug } from './util.js';

function readLine(stream, cancellable) {
  return new Promise((resolve, reject) => {
    stream.read_line_async(0, cancellable, (s, res) => {
      try {
        const line = s.read_line_finish_utf8(res)[0];

        if (line !== null) {
          resolve(line);
        } else {
          reject(new Error('No line was read!'));
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

function quoteEscape(str) {
  return str.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

/**
 * Execute a command asynchronously and check the exit status.
 *
 * If given, @cancellable can be used to stop the process before it finishes.
 *
 * @param {string[] | string} argv - a list of string arguments or command line that will be parsed
 * @param {Gio.Cancellable} [cancellable] - optional cancellable object
 * @param {boolean} shell - run command as shell command
 * @param logFunc
 * @returns {Promise<void>} - The process success
 */
export function execCheck(
  argv,
  cancellable = null,
  shell = true,
  logFunc = undefined
) {
  if (!shell && typeof argv === 'string') {
    argv = GLib.shell_parse_argv(argv)[1];
  }

  const isRootProc = argv[0] && argv[0].endsWith('pkexec');

  if (shell && Array.isArray(argv)) {
    argv = argv.map(c => `"${quoteEscape(c)}"`).join(' ');
  }
  let cancelId = 0;
  let proc = new Gio.Subprocess({
    argv: (shell ? ['/bin/sh', '-c'] : []).concat(argv),
    flags:
      logFunc !== undefined
        ? Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        : Gio.SubprocessFlags.NONE,
  });
  proc.init(cancellable);

  if (cancellable instanceof Gio.Cancellable) {
    cancelId = cancellable.connect(() => {
      if (logFunc !== undefined) {
        if (isRootProc) {
          logFunc(`# ${_('Can not cancel root process!')}`);
        } else {
          logFunc(`[${_('CANCEL')}]`);
        }
      }
      proc.force_exit();
    });
  }
  let stdoutStream = null;
  let stderrStream = null;
  let readLineCancellable = null;

  if (logFunc !== undefined) {
    readLineCancellable = new Gio.Cancellable();
    stdoutStream = new Gio.DataInputStream({
      base_stream: proc.get_stdout_pipe(),
      close_base_stream: true,
    });

    stderrStream = new Gio.DataInputStream({
      base_stream: proc.get_stderr_pipe(),
      close_base_stream: true,
    });
    const readNextLine = async (stream, prefix) => {
      try {
        const line = await readLine(stream, readLineCancellable);
        logFunc(prefix + line);
        logDebug(line);
        await readNextLine(stream, prefix);
      } catch {
        if (!stream.is_closed()) {
          stream.close_async(0, null, (s, sRes) => {
            try {
              s.close_finish(sRes);
            } catch (e) {
              logDebug(`[StreamCloseError] ${e}`);
            }
          });
        }
      }
    };
    // read stdout and stderr asynchronously
    readNextLine(stdoutStream, '');
    readNextLine(stderrStream, '# ');
  }

  return new Promise((resolve, reject) => {
    proc.wait_check_async(null, (p, res) => {
      try {
        const success = p.wait_check_finish(res);
        if (!success) {
          let status = p.get_exit_status();

          throw new Gio.IOErrorEnum({
            code: Gio.io_error_from_errno(status),
            message: GLib.strerror(status),
          });
        }

        resolve();
      } catch (e) {
        reject(e);
      } finally {
        if (readLineCancellable) readLineCancellable.cancel();
        readLineCancellable = null;
        if (cancelId > 0) cancellable.disconnect(cancelId);
      }
    });
  });
}

export function installedScriptPath() {
  for (const name of [
    'shutdowntimerctl',
    `shutdowntimerctl-${GLib.get_user_name()}`,
  ]) {
    const standard = GLib.find_program_in_path(name);
    if (standard !== null) {
      return standard;
    }
    for (const bindir of ['/usr/local/bin/', '/usr/bin/']) {
      const path = bindir + name;
      logDebug(`Looking for: ${path}`);
      if (Gio.File.new_for_path(path).query_exists(null)) {
        return path;
      }
    }
  }
  return null;
}

function runWithScript(args, noScriptArgs) {
  const installedScript = installedScriptPath();
  if (installedScript !== null) {
    return execCheck(['pkexec', installedScript].concat(args), null, false);
  }
  if (noScriptArgs === undefined) {
    throw new Error(_('Privileged script installation required!'));
  }
  return execCheck(noScriptArgs, null, false);
}

function shutdown(minutes, reboot = false) {
  logDebug(`[root-shutdown] ${minutes} minutes, reboot: ${reboot}`);
  return runWithScript(
    [reboot ? 'reboot' : 'shutdown', `${minutes}`],
    ['shutdown', reboot ? '-r' : '-P', `${minutes}`]
  );
}

function shutdownCancel() {
  logDebug('[root-shutdown] cancel');
  return runWithScript(['shutdown-cancel'], ['shutdown', '-c']);
}

export function wake(minutes) {
  return runWithScript(['wake', `${minutes}`]);
}

export function wakeCancel() {
  return runWithScript(['wake-cancel']);
}

export async function stopRootModeProtection(info) {
  if (['poweroff', 'reboot'].includes(info.mode)) {
    await shutdownCancel();
  }
}
export async function startRootModeProtection(info) {
  if (['poweroff', 'reboot'].includes(info.mode)) {
    await shutdown(Math.max(0, info.minutes) + 1, info.mode === 'reboot');
  }
}
