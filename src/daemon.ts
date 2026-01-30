import {
  initializeCoco,
  getDecodedToken,
  ConsoleLogger,
  type WalletApi,
} from "coco-cashu-core";
import { SqliteRepositories } from "coco-cashu-sqlite3";
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Database } from "sqlite3";

const SOCKET_PATH = process.env.COCOD_SOCKET || "/tmp/cocod.sock";
const PID_FILE = process.env.COCOD_PID || "/tmp/cocod.pid";

// Route handler type
 type RouteHandler = (req: Request, wallet: WalletApi, mintUrl: string) => Promise<Response>;

// Handler registry - maps paths to their handlers
const routeHandlers: Record<string, { GET?: RouteHandler; POST?: RouteHandler }> = {
  "/ping": {
    GET: async () => Response.json({ output: "pong" }),
  },
  "/balance": {
    GET: async (_req, wallet, mintUrl) => {
      const balance = await wallet.getBalances();
      return Response.json({ output: balance[mintUrl] || 0 });
    },
  },
  "/receive": {
    POST: async (req, wallet) => {
      try {
        const body = (await req.json()) as { token: string };
        const token = body.token;
        const decoded = getDecodedToken(token);
        await wallet.receive(token);
        const total = decoded.proofs.reduce(
          (a: number, c: { amount: number }) => a + c.amount,
          0
        );
        return Response.json({ output: `Received ${total}` });
      } catch {
        return Response.json({ error: "Receive failed" });
      }
    },
  },
  // Mint subcommands
  "/mint/add": {
    POST: async (req, wallet) => {
      const body = (await req.json()) as { url: string };
      await wallet.addMint(body.url);
      return Response.json({ output: `Added mint: ${body.url}` });
    },
  },
  "/mint/list": {
    GET: async (_req, wallet) => {
      const mints = await wallet.getMints();
      return Response.json({ output: mints.join("\n") });
    },
  },
  "/mint/bolt11": {
    POST: async (req, wallet) => {
      const body = (await req.json()) as { amount: number };
      const invoice = await wallet.createBolt11Invoice(body.amount);
      return Response.json({ output: invoice });
    },
  },
};

// Build Bun routes from handler registry
function buildRoutes(
  wallet: WalletApi,
  mintUrl: string
): Record<string, { GET?: () => Promise<Response>; POST?: (req: Request) => Promise<Response> }> {
  const routes: Record<string, { GET?: () => Promise<Response>; POST?: (req: Request) => Promise<Response> }> = {};

  for (const [path, handlers] of Object.entries(routeHandlers)) {
    routes[path] = {};
    
    if (handlers.GET) {
      const handler = handlers.GET;
      routes[path]!.GET = async () => handler(new Request("http://localhost"), wallet, mintUrl);
    }
    
    if (handlers.POST) {
      const handler = handlers.POST;
      routes[path]!.POST = async (req: Request) => handler(req, wallet, mintUrl);
    }
  }

  return routes;
}

export async function startDaemon() {
  // Check if daemon is already running by trying to connect to the socket
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

  // Clean up any stale socket and PID files
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

  // Write PID file
  await Bun.write(PID_FILE, process.pid.toString());

  const MINT_URL = "https://mint.minibits.cash/Bitcoin";

  const mnem = generateMnemonic(wordlist);
  const seed = mnemonicToSeedSync(mnem);

  const repo = new SqliteRepositories({ database: new Database("./coco.db") });
  const coco = await initializeCoco({
    repo,
    seedGetter: async () => seed,
    logger: new ConsoleLogger("Coco", { level: "info" }),
  });

  await coco.mint.addMint(MINT_URL, { trusted: true });

  const routes = buildRoutes(coco.wallet, MINT_URL);

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
        { status: 404 }
      );
    },
  });

  console.log(`Daemon listening on ${SOCKET_PATH}`);

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
