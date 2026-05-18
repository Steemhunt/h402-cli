export async function promptHidden(question: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Passphrase prompt requires an interactive terminal. Set H402_WALLET_PASSPHRASE for non-interactive use.");
  }

  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = stdin.isRaw;
    const wasPaused = stdin.isPaused();
    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      if (stdin.isTTY) {
        stdin.setRawMode(wasRaw);
      }
      if (wasPaused) {
        stdin.pause();
      }
      stdin.removeAllListeners("keypress");
    };

    const finish = () => {
      stdout.write("\n");
      cleanup();
      resolve(value);
    };

    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") {
          stdout.write("\n");
          cleanup();
          reject(new Error("Interrupted"));
          return;
        }

        if (char === "\r" || char === "\n") {
          finish();
          return;
        }

        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }

        value += char;
      }
    };

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

export async function promptPassphrase(options: { confirm: boolean }) {
  const passphrase = await promptHidden("Wallet passphrase: ");
  if (!passphrase) {
    throw new Error("Wallet passphrase cannot be empty.");
  }

  if (!options.confirm) {
    return passphrase;
  }

  const confirmation = await promptHidden("Confirm wallet passphrase: ");
  if (passphrase !== confirmation) {
    throw new Error("Wallet passphrases do not match.");
  }

  return passphrase;
}
