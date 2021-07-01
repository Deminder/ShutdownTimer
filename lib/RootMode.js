/**
    AUTHOR: Deminder
**/

const {Gio, GLib} = imports.gi;
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
            return readLines(stream, linesBuffer)
        })
        .catch(() => linesBuffer);
}

function writeLine(stream, line) {
    return new Promise((resolve, reject) => {
        try {
            if (stream.put_string(line + '\n', null)) {
                resolve();
            } else {
                reject(new Error("Write to stream failed!"));
            }
        } catch (err) {
            reject(err);
        }
    });
}

async function shutdownInfo() {
    return new Promise((resolve, _) => {
        try {
            const file = Gio.File.new_for_path('/run/systemd/shutdown/scheduled');
            file.load_contents_async(null, (file, res) => {
                try {
                    const [, contents] = file.load_contents_finish(res);

                    const [usec, _warn, mode] = ByteArray.toString(contents)
                        .split('\n')
                        .map((l) => l.split('=')[1]);
                    resolve({
                        mode, deadline: (parseInt(usec) / 1000000)
                    });
                    GLib.free(contents);
                } catch (err) {
                    resolve({deadline: -1});
                }
            });
        } catch (err) {
            resolve({deadline: -1});
        }
    });
}


function execRootModeLoop(cancellable = null) {

    let cancelId = 0;
    try {
        let [, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
            // Working directory, passing %null to use the parent's
            null,
            // An array of arguments
            [ 'pkexec', 'bash', '-c', `while IFS=$'\\n' read -r line; do bash -c "$line" > /dev/null; echo "$?";done`],
            // Process ENV, passing %null to use the parent's
            null,
            // Flags; we need to use PATH so `ls` can be found and also need to know
            // when the process has finished to check the output and status.
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
            // Child setup function
            null
        );
        if (cancellable instanceof Gio.Cancellable) {
            const kill_path = GLib.find_program_in_path('kill');
            cancelId = cancellable.connect(() => Gio.Subprocess.new([kill_path, '-p', `${pid}`], Gio.SubprocessFlags.NONE));
        }

        let stdinStream = new Gio.DataOutputStream({
            base_stream: new Gio.UnixOutputStream({
                fd: stdin,
                close_fd: true
            }),
            close_base_stream: true
        });

        // Okay, now let's get output stream for `stdout`
        let stdoutStream = new Gio.DataInputStream({
            base_stream: new Gio.UnixInputStream({
                fd: stdout,
                close_fd: true
            }),
            close_base_stream: true
        });


        // We want the real error from `stderr`, so we'll have to do the same here
        let stderrStream = new Gio.DataInputStream({
            base_stream: new Gio.UnixInputStream({
                fd: stderr,
                close_fd: true
            }),
            close_base_stream: true
        });
        let prevCmdLinePromise = Promise.resolve();

        return [
            async function runCommandLine(command_line) {
                await prevCmdLinePromise;
                await writeLine(stdinStream, command_line.replaceAll("\\","\\\\").replaceAll('"', '\\"'));
                prevCmdLinePromise = readLine(stdoutStream).then((line) => parseInt(line));
                return prevCmdLinePromise;
            },
            new Promise((resolve, reject) => {
                // Watch for the process to finish, being sure to set a lower priority than
                // we set for the read loop, so we get all the output
                GLib.child_watch_add(GLib.PRIORITY_DEFAULT_IDLE, pid, (pid, status) => {
                    if (status === 0) {
                        log(stdoutLines.join('\n'));
                        resolve();
                    } else {
                        readLines(stderrStream)
                            .then((lines) => {
                                logError(new Error(`stderr[${status}]:\n ${lines.join('\n')}`));
                                reject( new Gio.IOErrorEnum({
                                    code: Gio.io_error_from_errno(status),
                                    message: GLib.strerror(status)
                                }));
                            });
                    }

                    // Ensure we close the remaining streams and process
                    stdinStream.close(null);
                    stdoutStream.close(null);
                    stderrStream.close(null);
                    GLib.spawn_close_pid(pid);
                });
            })
        ];
    } catch (e) {
        logError(e, 'execRootModeLoopError');
    } finally {
        if (cancelId > 0) {
            cancellable.disconnect(cancelId);
        }
    }
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
        argv = GLib.shell_parse_argv( argv )[1];
    }
    if (shell && argv instanceof Array) {
        argv = argv.map(c => `"${c.replaceAll('\\','\\\\').replaceAll('"', '\\"')}"`).join(' ');
    }
    let cancelId = 0;
    let proc = new Gio.Subprocess({
        argv: (shell ? ['/bin/sh', '-c'] : []).concat(argv),
        flags: Gio.SubprocessFlags.NONE
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
                        message: GLib.strerror(status)
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
class RootMode {
    constructor(infoCallback) {
        this._cancel = null;
        this._runCommand = null;
        this._procPromise =  null;
        this._infoCallback = infoCallback;
        this._requiresRootCmd = [];
        this._updateInfoLoop();
    }

    _updateInfoLoop() {
        this._infoTimerId = new Promise((resolve, _) => {
            shutdownInfo()
                .then((info) => {
                    this._infoCallback(info);
                    const nextTimerId = GLib.timeout_add_seconds(GLib.LOW_PRIORITY, 5, () => {
                                this._updateInfoLoop();
                                return GLib.SOURCE_REMOVE;
                            });
                    resolve(nextTimerId);
                });
        });
    }

    _startRootProc() {
        if (this._cancel === null) {
            this._cancel = new Gio.Cancellable()
            const [r, p] = execRootModeLoop(this._cancel);
            this._runCommand = r;
            this._procPromise = p;
        }
    }


    async _maybeTryWithoutRoot(cmd) {
        const name = cmd[0];
        if (this._requiresRootCmd.includes(name)) {
            return this.runCommandLine(cmd.join(' '));
        } else {
            return execCheck(cmd, null, false)
                .catch(() => {
                    this._requiresRootCmd.push(name);
                    return this.runCommandLine(cmd.join(' '));
                });
        }
    }

    async shutdown(minutes, reboot = false) {
        let cmd = ['shutdown', `${minutes}`];
        if (reboot) {
            cmd.splice(1, 0, '-r');
        }
        return this._maybeTryWithoutRoot(cmd);
    }

    async cancelShutdown() {
        return this._maybeTryWithoutRoot(['shutdown', '-c']);
    }

    // promise result is a successfully executed command line as root
    async runCommandLine(command_line) {
        this._startRootProc();
        return this._runCommand(command_line)
            .catch(async (err) => {
                logError(err, 'RunCommandLineError');
                await this.stopRootProc().catch(stoperr => {
                    logError(stoperr, 'KilledProc-RunCommandLineError');
                });
                throw err;
            })
            .then((status) => {
                if (status !== 0) {
                    throw new Error("Failure Exit Code:" + status);
                }
            });
    }

    async stopRootProc() {
        if (this._cancel !== null) {
            this._cancel.cancel();
            this._cancel = null;
            this._runCommand = null;
            const promise = this._procPromise;
            this._procPromise = null;
            return promise;
        }
        return Promise.resolve();
    }

    async stopScheduleInfoLoop() {
        if (this._infoTimerId !== null) {
            GLib.Source.remove(await this._infoTimerId);
        }
        this._infoTimerId = null;
    }

    async updateScheduleInfo() {
        await this.stopScheduleInfoLoop();
        // restart loop
        return this._updateInfoLoop();
    }
}

