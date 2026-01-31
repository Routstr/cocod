import { mnemonicToSeedSync } from "@scure/bip39";
import { CONFIG_FILE, SOCKET_PATH, PID_FILE } from "./utils/config.js";
import { DaemonStateManager } from "./utils/state.js";
import { initializeWallet } from "./utils/wallet.js";
import { createRouteHandlers, buildRoutes } from "./routes.js";
import type { WalletConfig } from "./utils/config.js";

export async function startDaemon() {
  const stateManager = new DaemonStateManager();

  try {
    const testConn = await Bun.connect({
      unix: SOCKET_PATH,
      socket: {
        data() {},
        open() {},
        close() {},
        drain() {},
      },
    });
    testConn.end();
    console.error(`Error: Daemon is already running on ${SOCKET_PATH}`);
    process.exit(1);
  } catch {
    // Not running, safe to proceed
  }

  try {
    await Bun.write(PID_FILE, "");
    await Bun.file(PID_FILE).delete();
  } catch {
    // Directory creation failed or file didn't exist
  }

  try {
    await Bun.file(SOCKET_PATH).delete();
  } catch {
    // File might not exist
  }
  try {
    await Bun.file(PID_FILE).delete();
  } catch {
    // File might not exist
  }

  await Bun.write(PID_FILE, process.pid.toString());

  try {
    const configExists = await Bun.file(CONFIG_FILE).exists();
    if (configExists) {
      const configText = await Bun.file(CONFIG_FILE).text();
      const config: WalletConfig = JSON.parse(configText);

      if (config.encrypted) {
        stateManager.setLocked(config.mnemonic, config.mintUrl);
        console.log(
          "Wallet locked. Run 'cocod unlock <passphrase>' to decrypt.",
        );
      } else {
        const manager = await initializeWallet(config);
        const seed = mnemonicToSeedSync(config.mnemonic);
        stateManager.setUnlocked(manager, config.mintUrl, seed);
        console.log("Wallet auto-initialized (unencrypted).");
      }
    }
  } catch (error) {
    console.warn("Failed to load existing config:", error);
    stateManager.setError(String(error));
  }

  const routeHandlers = createRouteHandlers(stateManager);
  const routes = buildRoutes(routeHandlers, () => stateManager.getState());

  const server = Bun.serve({
    unix: SOCKET_PATH,
    routes: {
      ...routes,
      "/stop": {
        POST: async () => {
          console.log("\nShutting down daemon...");
          setTimeout(async () => {
            server.stop();
            try {
              await Bun.file(PID_FILE).delete();
            } catch {
              // File might not exist
            }
            process.exit(0);
          }, 100);
          return Response.json({ output: "Daemon stopping" });
        },
      },
    },
    async fetch(req) {
      return Response.json(
        { error: `Unknown endpoint: ${req.url}` },
        { status: 404 },
      );
    },
  });

  console.log(`Daemon listening on ${SOCKET_PATH}`);
  if (stateManager.isUninitialized()) {
    console.log(
      "Wallet not initialized. Run 'cocod init [mnemonic]' to set up.",
    );
  }

  const cleanup = async () => {
    console.log("\nShutting down daemon...");
    server.stop();
    try {
      await Bun.file(PID_FILE).delete();
    } catch {
      // File might not exist
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
