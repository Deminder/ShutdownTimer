/**
    AUTHOR: Deminder
**/
const Me = imports.misc.extensionUtils.getCurrentExtension();
const logDebug = Me.imports.lib.Convenience.logDebug;

const { Gio, GLib } = imports.gi;
const ByteArray = imports.byteArray;

// A simple asynchronous read loop
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

async function readLines(stream, linesBuffer = null) {
  if (!linesBuffer) {
    linesBuffer = [];
  }
  return readLine(stream)
    .then((line) => {
      linesBuffer.push(line);
      return readLines(stream, linesBuffer);
    })
    .catch(() => linesBuffer);
}

function writeLine(stream, line) {
  return new Promise((resolve, reject) => {
    try {
      if (stream.put_string(line + "\n", null)) {
        resolve();
      } else {
        reject(new Error("Write to stream failed!"));
      }
    } catch (err) {
      reject(err);
    }
  });
}

async function readFile(path) {
  return new Promise((resolve, reject) => {
    try {
      const file = Gio.File.new_for_path(path);
      file.load_contents_async(null, (file, res) => {
        try {
          const [, contents] = file.load_contents_finish(res);
          resolve(ByteArray.toString(contents));
          GLib.free(contents);
        } catch (err) {
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function wakeInfo(rtc) {
  return readFile(`/sys/class/rtc/${rtc}/wakealarm`)
    .catch(() => "")
    .then((content) => {
      return { deadline: content !== "" ? parseInt(content) : -1 };
    });
}

async function shutdownInfo() {
  return readFile("/run/systemd/shutdown/scheduled")
    .then((content) => {
      const [usec, _warn, mode] = content
        .split("\n")
        .map((l) => l.split("=")[1]);
      resolve({
        mode,
        deadline: parseInt(usec) / 1000000,
      });
    })
    .catch(() => {
      return { deadline: -1 };
    });
}

function quoteEscape(str) {
  return str.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function execRootModeLoop(cancellable = null) {
  let cancelId = 0;
  try {
    let [, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
      // Working directory, passing %null to use the parent's
      null,
      // An array of arguments
      [
        "pkexec",
        "bash",
        "-c",
        `while IFS=$'\\n' read -r line; do bash -c "$line" > /dev/null; echo $?;done`,
      ],
      // Process ENV, passing %null to use the parent's
      null,
      // Flags; we need to use PATH so `ls` can be found and also need to know
      // when the process has finished to check the output and status.
      GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
      // Child setup function
      null
    );
    if (cancellable instanceof Gio.Cancellable) {
      const kill_path = GLib.find_program_in_path("kill");
      cancelId = cancellable.connect(() =>
        Gio.Subprocess.new(
          [kill_path, "-p", `${pid}`],
          Gio.SubprocessFlags.NONE
        )
      );
    }

    let stdinStream = new Gio.DataOutputStream({
      base_stream: new Gio.UnixOutputStream({
        fd: stdin,
        close_fd: true,
      }),
      close_base_stream: true,
    });

    // Okay, now let's get output stream for `stdout`
    let stdoutStream = new Gio.DataInputStream({
      base_stream: new Gio.UnixInputStream({
        fd: stdout,
        close_fd: true,
      }),
      close_base_stream: true,
    });

    // We want the real error from `stderr`, so we'll have to do the same here
    let stderrStream = new Gio.DataInputStream({
      base_stream: new Gio.UnixInputStream({
        fd: stderr,
        close_fd: true,
      }),
      close_base_stream: true,
    });
    let prevCmdLinePromise = Promise.resolve();

    return [
      async function runCommandLine(command_line) {
        await prevCmdLinePromise;
        await writeLine(stdinStream, command_line);
        const readExitStatus = async () => {
          return parseInt(await readLine(stdoutStream));
        };
        prevCmdLinePromise = readExitStatus();
        return prevCmdLinePromise;
      },
      new Promise((resolve, reject) => {
        // Watch for the process to finish, being sure to set a lower priority than
        // we set for the read loop, so we get all the output
        GLib.child_watch_add(GLib.PRIORITY_DEFAULT_IDLE, pid, (pid, status) => {
          if (status === 0) {
            logDebug(stdoutLines.join("\n"));
            resolve();
            stderrStream.close(null);
          } else {
            readLines(stderrStream).then((lines) => {
              stderrStream.close(null);
              logError(new Error(`stderr[${status}]:\n ${lines.join("\n")}`));
              reject(
                new Gio.IOErrorEnum({
                  code: Gio.io_error_from_errno(status),
                  message: GLib.strerror(status),
                })
              );
            });
          }

          // Ensure we close the remaining streams and process
          stdinStream.close(null);
          stdoutStream.close(null);
          GLib.spawn_close_pid(pid);
        });
      }),
    ];
  } catch (e) {
    logError(e, "execRootModeLoopError");
  } finally {
    if (cancelId > 0) {
      cancellable.disconnect(cancelId);
    }
  }
}

/**
 * Execute a command asynchronously and return the output from `stdout` on
 * success or throw an error with output from `stderr` on failure.
 *
 * If given, @input will be passed to `stdin` and @cancellable can be used to
 * stop the process before it finishes.
 *
 * @param {string[]} argv - a list of string arguments
 * @param {string} [input] - Input to write to `stdin` or %null to ignore
 * @param {Gio.Cancellable} [cancellable] - optional cancellable object
 * @returns {Promise<string>} - The process output
 */
async function execCommunicate(argv, input = null, cancellable = null) {
  let cancelId = 0;
  let flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;

  if (input !== null) flags |= Gio.SubprocessFlags.STDIN_PIPE;

  let proc = new Gio.Subprocess({
    argv: argv,
    flags: flags,
  });
  proc.init(cancellable);

  if (cancellable instanceof Gio.Cancellable) {
    cancelId = cancellable.connect(() => proc.force_exit());
  }

  return new Promise((resolve, reject) => {
    proc.communicate_utf8_async(input, null, (proc, res) => {
      try {
        let [, stdout, stderr] = proc.communicate_utf8_finish(res);
        let status = proc.get_exit_status();

        if (status !== 0) {
          throw new Gio.IOErrorEnum({
            code: Gio.io_error_from_errno(status),
            message: stderr ? stderr.trim() : GLib.strerror(status),
          });
        }

        resolve(stdout.trim());
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

/* ROOTMODE */
var RootMode = class {
  constructor() {
    this._cancel = null;
    this._runCommand = null;
    this._procPromise = null;
    this._rootTags = {};
    this._rtc = "rtc0";
    this._infoCallback = () => {};
    this._onRootModeToggled = () => {};
  }

  startScheduleInfoLoop(infoCallback, rootModeToggle) {
    this.updateScheduleInfo();
    this._infoCallback = infoCallback;
    this._onRootModeToggled = rootModeToggle;
  }

  _updateInfoLoop() {
    this._infoTimerId = new Promise((resolve, _) => {
      Promise.all([shutdownInfo(), wakeInfo(this._rtc)]).then(
        ([info, wakeInfo]) => {
          this._infoCallback(info, wakeInfo);
          const nextTimerId = GLib.timeout_add_seconds(
            GLib.LOW_PRIORITY,
            5,
            () => {
              this._updateInfoLoop();
              return GLib.SOURCE_REMOVE;
            }
          );
          resolve(nextTimerId);
        }
      );
    });
  }

  async wake(minutes) {
    const timestamp = GLib.DateTime.new_now_utc().to_unix() + minutes * 60;
    return this._maybeTryWithoutRoot(
      ["sh", "-c", `echo ${timestamp} > /sys/class/rtc/${this._rtc}/wakealarm`],
      "wake"
    ).catch(() => false);
  }

  async wakeCancel() {
    return this._maybeTryWithoutRoot(
      ["sh", "-c", `echo 0 > /sys/class/rtc/${this._rtc}/wakealarm`],
      "wake"
    ).catch(() => false);
  }

  isActive() {
    return this._cancel !== null;
  }

  _startRootProc() {
    if (this._cancel === null) {
      this._cancel = new Gio.Cancellable();
      this._onRootModeToggled();
      const [r, p] = execRootModeLoop(this._cancel);
      this._runCommand = r;
      this._procPromise = p;
    }
  }

  async _maybeTryWithoutRoot(cmd, tag) {
    if (!(tag in this._rootTags)) {
      try {
        return await execCheck(cmd, null, shell);
      } catch {
        logDebug(`Running ${tag} requires root!`);
        this._rootTags[tag] = true;
      }
    }
    const command_line = cmd.map((c) => `"${quoteEscape(c)}"`).join(" ");
    logDebug("Running: " + command_line);
    return this.runCommandLine(command_line);
  }

  async shutdown(minutes, reboot = false) {
    let cmd = ["shutdown", `${minutes}`];
    if (reboot) {
      cmd.splice(1, 0, "-r");
    }
    return this._maybeTryWithoutRoot(cmd, "shutdown");
  }

  async shutdownCancel() {
    return this._maybeTryWithoutRoot(["shutdown", "-c"], "shutdown");
  }

  // promise result is a successfully executed command line as root
  async runCommandLine(command_line) {
    this._startRootProc();
    return this._runCommand(command_line)
      .catch(async (err) => {
        logError(err, "RunCommandLineError");
        await this.stopRootProc().catch((stoperr) => {
          logError(stoperr, "KilledProc-RunCommandLineError");
        });
        throw err;
      })
      .then((status) => {
        if (status !== 0) {
          throw new Error(`Failure Exit Code: ${status} \n ${outputString}`);
        }
        return true;
      });
  }

  async stopRootProc() {
    if (this._cancel !== null) {
      this._cancel.cancel();
      this._cancel = null;
      this._onRootModeToggled();
      this._runCommand = null;
      const promise = this._procPromise;
      this._procPromise = null;
      return promise;
    }
    return Promise.resolve();
  }

  async stopScheduleInfoLoop(clean = true) {
    if (clean) {
      this._infoCallback = () => {};
      this._onRootModeToggled = () => {};
    }

    if (this._infoTimerId !== null) {
      GLib.Source.remove(await this._infoTimerId);
    }
    this._infoTimerId = null;
  }

  async updateScheduleInfo() {
    await this.stopScheduleInfoLoop(false);
    // restart loop
    return this._updateInfoLoop();
  }
};
