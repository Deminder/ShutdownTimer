/**
    AUTHOR: Deminder
**/

const {Gio, GLib} = imports.gi;


// A simple asynchronous read loop
async function readLine(stream) {
    return new Promise((result, reject) => {
        stream.read_line_async(0, null, (stream, res) => {
            try {
                let line = stream.read_line_finish_utf8(res)[0];

                if (line !== null) {
                    result(line);
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
    return new Promise((result, reject) => {
        try {
            if (stream.put_string(line + '\n', null)) {
                result();
            } else {
                reject(new Error("Write to stream failed!"));
            }
        } catch (err) {
            reject(err);
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
                await writeLine(stdinStream, command_line.replaceAll('"', '\\"'));
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

/* ROOTMODE */
class RootMode {
    constructor() {
        this._cancel = null;
        this._runCommand = null;
        this._procPromise =  null;
    }

    _startRootProc() {
        if (this._cancel === null) {
            this._cancel = new Gio.Cancellable()
            const [r, p] = execRootModeLoop(this._cancel);
            this._runCommand = r;
            this._procPromise = p;
        }
    }

    async runCommandLine(command_line) {
        this._startRootProc();
        return this._runCommand(command_line)
            .catch(async (err) => {
                logError(err, 'RunCommandLineError');
                await this._stopRootProc().catch(stoperr => {
                    logError(stoperr, 'KilledProc-RunCommandLineError');
                });
                throw err;
            });
    }

    async _stopRootProc() {
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

    async cleanup() {
        return this._stopRootProc();
    }
}

