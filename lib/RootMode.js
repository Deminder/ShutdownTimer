/**
    AUTHOR: Deminder
**/
const Me = imports.misc.extensionUtils.getCurrentExtension();
const logDebug = Me.imports.lib.Convenience.logDebug;

const { Gio, GLib } = imports.gi;
const ByteArray = imports.byteArray;

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
async function execCheck(argv, cancellable = null, shell = true) {
  if (!shell && typeof argv === "string") {
    argv = GLib.shell_parse_argv(argv)[1];
  }
  if (shell && argv instanceof Array) {
    argv = argv.map((c) => `"${quoteEscape(c)}"`).join(" ");
  }
  let cancelId = 0;
  let proc = new Gio.Subprocess({
    argv: (shell ? ["/bin/sh", "-c"] : []).concat(argv),
    flags: Gio.SubprocessFlags.NONE,
  });
  proc.init(cancellable);

  if (cancellable instanceof Gio.Cancellable) {
    cancelId = cancellable.connect(() => proc.force_exit());
  }

  return new Promise((resolve, reject) => {
    proc.wait_check_async(null, (proc, res) => {
      try {
        if (!proc.wait_check_finish(res)) {
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
        if (cancelId > 0) {
          cancellable.disconnect(cancelId);
        }
      }
    });
  });
}

function removeTailSlash(path) {
  return path.endsWith("/") ? path.substring(0, path.length - 1) : path;
}

function installedScriptPath(knownPrefix = "/usr") {
  knownPrefix = removeTailSlash(knownPrefix);
  for (const name of [
    "shutdowntimerctl",
    "shutdowntimerctl-" + GLib.get_user_name(),
  ]) {
    const standard = GLib.find_program_in_path(name);
    if (standard !== null) {
      return standard;
    }
    if (knownPrefix.startsWith("/")) {
      const path = knownPrefix + "/local/bin/" + name;
      logDebug("Looking for: " + path);
      if (Gio.File.new_for_path(path).query_exists(null)) {
        return path;
      }
    }
  }
  return null;
}

async function _runInstaller(prefix, suffix, action) {
  logDebug(
    `? installer.sh --prefix ${prefix} --tool-suffix ${suffix} ${action}`
  );
  return execCheck([
    "pkexec",
    Me.dir.get_child("tool").get_child("installer.sh").get_path(),
    "--prefix",
    prefix,
    "--tool-suffix",
    suffix,
    action,
  ]);
}

async function installScript(prefix) {
  prefix = removeTailSlash(prefix);
  const installedScript = installedScriptPath(prefix);
  if (installedScript !== null) {
    logDebug("Script already installed. Nothing to do.");
    return false;
  }
  // we are installed in the /home directory, let's handle tool installation
  const suffix = Me.dir.get_path().includes("/home/")
    ? GLib.get_user_name()
    : "";
  return _runInstaller(prefix, suffix, "install").then(() => true);
}

function scriptPathPrefix(path) {
  const indexLocal = path.indexOf("/local/bin/");
  const prefix =
    indexLocal > 0
      ? path.substring(0, indexLocal)
      : path.substring(0, path.indexOf("/bin/"));
  if (!prefix.startsWith("/")) {
    throw new Error("Could not determine prefix of:" + installedScript);
  }
  return prefix;
}

async function uninstallScript(knownPrefix) {
  const installedScript = installedScriptPath(knownPrefix);
  if (installedScript === null) {
    logDebug("Script already uninstalled. Nothing to do.");
    return false;
  }
  const prefix = scriptPathPrefix(installedScript);
  const scriptNameSplit = installedScript
    .substring(installedScript.lastIndexOf("/"))
    .split("-");
  const suffix = scriptNameSplit.length > 1 ? scriptNameSplit[1] : "";
  return _runInstaller(prefix, suffix, "uninstall").then(() => true);
}

async function runWithScript(args, noScriptArgs) {
  const installedScript = installedScriptPath();
  if (installedScript !== null) {
    return execCheck(["pkexec", installedScript].concat(args));
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
  const timestamp = GLib.DateTime.new_now_utc().to_unix() + minutes * 60;
  return runWithScript(
    ["wake", `${timestamp}`],
    ["sh", "-c", `echo ${timestamp} > /sys/class/rtc/rtc0/wakealarm`]
  );
}

async function wakeCancel() {
  return runWithScript(
    ["wake-cancel"],
    ["sh", "-c", `echo 0 > /sys/class/rtc/rtc0/wakealarm`]
  );
}
