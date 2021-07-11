/**
    AUTHOR: Deminder
**/
const Me = imports.misc.extensionUtils.getCurrentExtension();
const logDebug = Me.imports.lib.Convenience.logDebug;

const { Gio, GLib } = imports.gi;

async function readLine(stream) {
  return new Promise((resolve, reject) => {
    stream.read_line_async(0, null, (stream, res) => {
      try {
        let line = stream.read_line_finish_utf8(res)[0];

        if (line !== null) {
          resolve(line);
        } else {
          reject(new Error("No line was read!"));
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

function quoteEscape(str) {
  return str.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
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
async function execCheck(
  argv,
  cancellable = null,
  shell = true,
  logFunc = null
) {
  if (!shell && typeof argv === "string") {
    argv = GLib.shell_parse_argv(argv)[1];
  }
  if (shell && argv instanceof Array) {
    argv = argv.map((c) => `"${quoteEscape(c)}"`).join(" ");
  }
  let cancelId = 0;
  let proc = new Gio.Subprocess({
    argv: (shell ? ["/bin/sh", "-c"] : []).concat(argv),
    flags:
      logFunc !== null
        ? Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        : Gio.SubprocessFlags.NONE,
  });
  proc.init(cancellable);

  if (cancellable instanceof Gio.Cancellable) {
    cancelId = cancellable.connect(() => proc.force_exit());
  }
  let stdoutStream = null;
  let stderrStream = null;
  let stdoutPromise = Promise.resolve();
  let stderrPromise = Promise.resolve();

  if (logFunc !== null) {
    stdoutStream = new Gio.DataInputStream({
      base_stream: proc.get_stdout_pipe(),
      close_base_stream: true,
    });

    stderrStream = new Gio.DataInputStream({
      base_stream: proc.get_stderr_pipe(),
      close_base_stream: true,
    });
    const readNextLine = async (stream, prefix) => {
      const line = await readLine(stream);
      logFunc(prefix + line);
      logDebug(line);
      return readNextLine(stream, prefix);
    };
    // read stdout and stderr asynchronously
    stdoutPromise = readNextLine(stdoutStream, "");
    stderrPromise = readNextLine(stderrStream, "# ");
  }

  return new Promise((resolve, reject) => {
    proc.wait_check_async(null, async (proc, res) => {
      try {
        const success = proc.wait_check_finish(res);
        await stdoutPromise.catch(() => {});
        await stderrPromise.catch(() => {});
        if (!success) {
          let status = proc.get_exit_status();

          throw new Gio.IOErrorEnum({
            code: Gio.io_error_from_errno(status),
            message: GLib.strerror(status),
          });
        }

        resolve();
      } catch (e) {
        reject(e);
      } finally {
        if (stdoutStream !== null) {
          stdoutStream.close(null);
        }
        if (stderrStream !== null) {
          stderrStream.close(null);
        }
        if (cancelId > 0) {
          cancellable.disconnect(cancelId);
        }
      }
    });
  });
}

function installedScriptPath() {
  for (const name of [
    "shutdowntimerctl",
    "shutdowntimerctl-" + GLib.get_user_name(),
  ]) {
    const standard = GLib.find_program_in_path(name);
    if (standard !== null) {
      return standard;
    }
    for (const bindir of ["/usr/local/bin/", "/usr/bin/"]) {
      const path = bindir + name;
      logDebug("Looking for: " + path);
      if (Gio.File.new_for_path(path).query_exists(null)) {
        return path;
      }
    }
  }
  return null;
}

async function _runInstaller(suffix, action, cancellable, logFunc) {
  logDebug(`? installer.sh --tool-suffix ${suffix} ${action}`);
  return execCheck(
    [
      "pkexec",
      Me.dir.get_child("tool").get_child("installer.sh").get_path(),
      "--tool-suffix",
      suffix,
      action,
    ],
    cancellable,
    false,
    logFunc
  );
}

async function installScript(cancellable, logFunc) {
  const installedScript = installedScriptPath();
  if (installedScript !== null) {
    logFunc("Nothing to do.");
    logDebug("Script already installed. Nothing to do.");
    return false;
  }
  // we are installed in the /home directory, let's handle tool installation
  const suffix = Me.dir.get_path().includes("/home/")
    ? GLib.get_user_name()
    : "";
  return _runInstaller(suffix, "install", cancellable, logFunc).then(
    () => true
  );
}

async function uninstallScript(cancellable, logFunc) {
  const installedScript = installedScriptPath();
  if (installedScript === null) {
    logFunc("Nothing to do.");
    logDebug("Script already uninstalled. Nothing to do.");
    return false;
  }
  const scriptNameSplit = installedScript
    .substring(installedScript.lastIndexOf("/"))
    .split("-");
  const suffix = scriptNameSplit.length > 1 ? scriptNameSplit[1] : "";
  return _runInstaller(suffix, "uninstall", cancellable, logFunc).then(
    () => true
  );
}

async function runWithScript(args, noScriptArgs) {
  const installedScript = installedScriptPath();
  if (installedScript !== null) {
    return execCheck(["pkexec", installedScript].concat(args), null, false);
  }
  return execCheck(noScriptArgs, null, false);
}

async function shutdown(minutes, reboot = false) {
  return runWithScript(
    [reboot ? "reboot" : "shutdown", `${minutes}`],
    ["shutdown", reboot ? "-r" : "-P", `${minutes}`]
  );
}

async function shutdownCancel() {
  return runWithScript(["shutdown-cancel"], ["shutdown", "-c"]);
}

async function wake(minutes) {
  return runWithScript(["wake", `${minutes}`], ["false"]);
}

async function wakeCancel() {
  return runWithScript(["wake-cancel"], ["false"]);
}
