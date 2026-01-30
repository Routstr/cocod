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
import { commands } from "./commands";

const SOCKET_PATH = process.env.COCOD_SOCKET || "/tmp/cocod.sock";

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
  "/help": {
    GET: async () => {
      const commandList = commands
        .map((c) => `  ${c.name} - ${c.description}`)
        .join("\n");
      return Response.json({
        output: `Available commands:\n${commandList}`,
      });
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
  try {
    await Bun.file(SOCKET_PATH).delete();
  } catch {
    // File might not exist
  }

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
    routes,
    async fetch(req) {
      return Response.json(
        { error: `Unknown endpoint: ${req.url}` },
        { status: 404 }
      );
    },
  });

  console.log(`Daemon listening on ${SOCKET_PATH}`);

  process.on("SIGINT", () => {
    console.log("\nShutting down daemon...");
    server.stop();
    process.exit(0);
  });
}
