import { initializeCoco } from "coco-cashu-core";
import { handlers } from "./commands/index";
import { SqliteRepositories } from "coco-cashu-sqlite3";
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Database } from "sqlite3";

const SOCKET_PATH = process.env.COCOD_SOCKET || "/tmp/cocod.sock";

interface CommandRequest {
  command: string;
  args?: string[];
}

export async function startDaemon() {
  try {
    await Bun.file(SOCKET_PATH).delete();
  } catch {
    // File might not exist
  }

  const MINT_URL = "https://mint.minibits.cash/Bitcoin";

  const mnem = generateMnemonic(wordlist);
  const seed = mnemonicToSeedSync(mnem);

  const repo = new SqliteRepositories({ database: new Database("./coco.db") });
  const coco = await initializeCoco({ repo, seedGetter: async () => seed });

  await coco.mint.addMint(MINT_URL, { trusted: true });

  const server = Bun.serve({
    unix: SOCKET_PATH,
    async fetch(req) {
      try {
        const body = (await req.json()) as CommandRequest;
        const { command, args = [] } = body;
        console.log(body);
        if (command === "balance") {
          console.log("Getting balance...");
          const balance = await coco.wallet.getBalances();
          const res = { output: balance[MINT_URL] || 0 };
          console.log("res", res);
          return Response.json(res);
        }

        const handler = handlers[command];

        if (!handler) {
          return Response.json(
            { error: `Unknown command: ${command}` },
            { status: 404 },
          );
        }

        const result = await handler(args);
        return Response.json(result);
      } catch (error) {
        return Response.json(
          {
            error: error instanceof Error ? error.message : "Unknown error",
          },
          { status: 500 },
        );
      }
    },
  });

  console.log(`Daemon listening on ${SOCKET_PATH}`);

  process.on("SIGINT", () => {
    console.log("\nShutting down daemon...");
    server.stop();
    process.exit(0);
  });
}
