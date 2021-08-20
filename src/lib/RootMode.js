/*
  AUTHOR: Deminder
*/
/* exported shutdown, shutdownCancel, wake, wakeCancel, installScript, uninstallScript */
const Me = imports.misc.extensionUtils.getCurrentExtension();
const logDebug = Me.imports.lib.Convenience.logDebug;

const { Gio, GLib } = imports.gi;

// translations
const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;

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
 * @returns {Promise<void>} - The process success
 */
function execCheck(argv, cancellable = null, shell = true, logFunc = undefined) {
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
          logFunc('# ' + _('Can not cancel root process!'));
        } else {
          logFunc(`[${_('CANCEL')}]`);
        }
      }
      proc.force_exit();
    });
  }
  let stdoutStream = null;
  let stderrStream = null;
  let stdCancel = null;

  if (logFunc !== undefined) {
    stdoutStream = new Gio.DataInputStream({
      base_stream: proc.get_stdout_pipe(),
      close_base_stream: true,
    });

    stderrStream = new Gio.DataInputStream({
      base_stream: proc.get_stderr_pipe(),
      close_base_stream: true,
    });
    const readNextLine = async (stream, prefix) => {
      stdCancel = new Gio.Cancellable();
      const line = await readLine(stream, stdCancel);
      logFunc(prefix + line);
      logDebug(line);
      return readNextLine(stream, prefix);
    };
    // read stdout and stderr asynchronously
    readNextLine(stdoutStream, '').catch(() => {});
    readNextLine(stderrStream, '# ').catch(() => {});
  }

  return new Promise((resolve, reject) => {
    proc.wait_check_async(null, (p, res) => {
      try {
        const success = p.wait_check_finish(res);
        if (stdCancel !== null) {
          stdCancel.cancel();
        }
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
        const maybeCloseStream = stream => {
          if (stream !== null && !stream.is_closed()) {
            stream.close_async(0, null, (s, sRes) => {
              try {
                s.close_finish(sRes);
              } catch (e) {
                logError(e, 'StreamCloseError');
              }
            });
          }
        };
        maybeCloseStream(stdoutStream);
        maybeCloseStream(stderrStream);
        if (cancelId > 0) {
          cancellable.disconnect(cancelId);
        }
      }
    });
  });
}

function installedScriptPath() {
  for (const name of [
    'shutdowntimerctl',
    'shutdowntimerctl-' + GLib.get_user_name(),
  ]) {
    const standard = GLib.find_program_in_path(name);
    if (standard !== null) {
      return standard;
    }
    for (const bindir of ['/usr/local/bin/', '/usr/bin/']) {
      const path = bindir + name;
      logDebug('Looking for: ' + path);
      if (Gio.File.new_for_path(path).query_exists(null)) {
        return path;
      }
    }
  }
  return null;
}

function _runInstaller(action, cancellable, logFunc) {
  const user = GLib.get_user_name();
  logDebug(`? installer.sh --tool-user ${user} ${action}`);
  return execCheck(
    [
      'pkexec',
      Me.dir.get_child('tool').get_child('installer.sh').get_path(),
      '--tool-user',
      user,
      action,
    ],
    cancellable,
    false,
    logFunc
  );
}

async function installScript(cancellable, logFunc) {
  // install for user if installed in the /home directory
  await _runInstaller('install', cancellable, logFunc);
  return true;
}

async function uninstallScript(cancellable, logFunc) {
  await _runInstaller('uninstall', cancellable, logFunc);
  return true;
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
  return runWithScript(
    [reboot ? 'reboot' : 'shutdown', `${minutes}`],
    ['shutdown', reboot ? '-r' : '-P', `${minutes}`]
  );
}

function shutdownCancel() {
  return runWithScript(['shutdown-cancel'], ['shutdown', '-c']);
}

function wake(minutes) {
  return runWithScript(['wake', `${minutes}`]);
}

function wakeCancel() {
  return runWithScript(['wake-cancel']);
}
