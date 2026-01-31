import {
  initializeCoco,
  getDecodedToken,
  ConsoleLogger,
  type Manager,
} from "coco-cashu-core";
import { SqliteRepositories } from "coco-cashu-sqlite3";
import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Database } from "sqlite3";
import { NPCPlugin } from "coco-cashu-plugin-npc";
import { privateKeyFromSeedWords } from "nostr-tools/nip06";
import { finalizeEvent, nip19, type EventTemplate } from "nostr-tools";
import { homedir } from "node:os";

const CONFIG_DIR = `${homedir()}/.cocod`;
const SOCKET_PATH = process.env.COCOD_SOCKET || `${CONFIG_DIR}/cocod.sock`;
const PID_FILE = process.env.COCOD_PID || `${CONFIG_DIR}/cocod.pid`;
const CONFIG_FILE = `${CONFIG_DIR}/config.json`;
const SALT_FILE = `${CONFIG_DIR}/salt`;
const DB_FILE = `${CONFIG_DIR}/coco.db`;

// State machine types
interface UninitializedState {
  status: "UNINITIALIZED";
}

interface LockedState {
  status: "LOCKED";
  encryptedMnemonic: string;
  mintUrl: string;
}

interface UnlockedState {
  status: "UNLOCKED";
  manager: Manager;
  mintUrl: string;
  seed: Uint8Array;
}

interface ErrorState {
  status: "ERROR";
  message: string;
}

type DaemonState =
  | UninitializedState
  | LockedState
  | UnlockedState
  | ErrorState;

// Global state (mutable during daemon lifetime)
let daemonState: DaemonState = { status: "UNINITIALIZED" };

// Configuration structure
interface WalletConfig {
  version: number;
  mnemonic: string;
  encrypted: boolean;
  mintUrl: string;
  createdAt: string;
}

// Route handler type - now takes state instead of wallet directly
type RouteHandler = (req: Request, state: DaemonState) => Promise<Response>;

// Middleware to require UNLOCKED state
function requireUnlocked(
  handler: (req: Request, state: UnlockedState) => Promise<Response>,
): RouteHandler {
  return async (req: Request, state: DaemonState) => {
    if (state.status !== "UNLOCKED") {
      if (state.status === "LOCKED") {
        return Response.json(
          {
            error:
              "Wallet is locked. Run 'cocod unlock <passphrase>' to decrypt.",
          },
          { status: 403 },
        );
      }
      if (state.status === "UNINITIALIZED") {
        return Response.json(
          {
            error: "Wallet not initialized. Run 'cocod init [mnemonic]' first.",
          },
          { status: 503 },
        );
      }
      return Response.json({ error: "Wallet error" }, { status: 500 });
    }
    return handler(req, state as UnlockedState);
  };
}

// Middleware to require UNINITIALIZED state
function requireUninitialized(
  handler: (req: Request) => Promise<Response>,
): RouteHandler {
  return async (req: Request, state: DaemonState) => {
    if (state.status !== "UNINITIALIZED") {
      return Response.json(
        {
          error:
            "Wallet already initialized. Delete ~/.cocod/config.json to reset.",
        },
        { status: 409 },
      );
    }
    return handler(req);
  };
}

// Middleware to require LOCKED state
function requireLocked(
  handler: (req: Request, state: LockedState) => Promise<Response>,
): RouteHandler {
  return async (req: Request, state: DaemonState) => {
    if (state.status !== "LOCKED") {
      if (state.status === "UNINITIALIZED") {
        return Response.json(
          {
            error: "Wallet not initialized. Run 'cocod init [mnemonic]' first.",
          },
          { status: 503 },
        );
      }
      if (state.status === "UNLOCKED") {
        return Response.json(
          { error: "Wallet is already unlocked" },
          { status: 409 },
        );
      }
      return Response.json({ error: "Wallet error" }, { status: 500 });
    }
    return handler(req, state as LockedState);
  };
}

// Encryption utilities using Bun's built-in crypto
async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passphraseData = encoder.encode(passphrase);

  // Import passphrase as key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passphraseData,
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"],
  );

  // Derive AES-256-GCM key
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: Buffer.from(salt).buffer as ArrayBuffer,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptMnemonic(
  mnemonic: string,
  passphrase: string,
): Promise<{ ciphertext: string; salt: string }> {
  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(mnemonic);

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    plaintext,
  );

  // Combine IV + ciphertext
  const combined = new Uint8Array(
    iv.length + new Uint8Array(ciphertext).length,
  );
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return {
    ciphertext: Buffer.from(combined).toString("base64"),
    salt: Buffer.from(salt).toString("base64"),
  };
}

async function decryptMnemonic(
  ciphertext: string,
  passphrase: string,
  salt: string,
): Promise<string> {
  const combined = Buffer.from(ciphertext, "base64");
  const saltBytes = Buffer.from(salt, "base64");

  const key = await deriveKey(passphrase, saltBytes);

  // Extract IV and ciphertext
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encrypted,
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// Initialize wallet from config and optional passphrase
async function initializeWallet(
  config: WalletConfig,
  passphrase?: string,
): Promise<Manager> {
  let mnemonic: string;

  if (config.encrypted) {
    if (!passphrase) {
      throw new Error("Passphrase required for encrypted wallet");
    }
    const salt = await Bun.file(SALT_FILE).text();
    mnemonic = await decryptMnemonic(config.mnemonic, passphrase, salt);
  } else {
    mnemonic = config.mnemonic;
  }

  const seed = mnemonicToSeedSync(mnemonic);

  const repo = new SqliteRepositories({ database: new Database(DB_FILE) });
  const logger = new ConsoleLogger("Coco", { level: "info" });
  const sk = privateKeyFromSeedWords(mnemonic);
  const signer = async (t: EventTemplate) => finalizeEvent(t, sk);
  const npcPlugin = new NPCPlugin("https://npuby.cash", signer, {
    useWebsocket: true,
    logger,
  });
  const coco = await initializeCoco({
    repo,
    seedGetter: async () => seed,
    logger,
  });

  coco.use(npcPlugin);

  await coco.mint.addMint(config.mintUrl, { trusted: true });

  return coco;
}

// Handler registry - maps paths to their handlers
const routeHandlers: Record<
  string,
  { GET?: RouteHandler; POST?: RouteHandler }
> = {
  "/ping": {
    GET: async () => Response.json({ output: "pong" }),
  },
  "/status": {
    GET: async (_req, state) => {
      // Return status without sensitive data
      return Response.json({ output: state.status });
    },
  },
  "/init": {
    POST: requireUninitialized(async (req: Request) => {
      try {
        const body = (await req.json()) as {
          mnemonic?: string;
          passphrase?: string;
          mintUrl?: string;
        };

        // Generate or validate mnemonic
        let mnemonic: string;
        if (body.mnemonic) {
          if (!validateMnemonic(body.mnemonic, wordlist)) {
            return Response.json(
              { error: "Invalid mnemonic" },
              { status: 400 },
            );
          }
          mnemonic = body.mnemonic;
        } else {
          mnemonic = generateMnemonic(wordlist, 256); // 24 words
        }

        const mintUrl = body.mintUrl || "https://mint.minibits.cash/Bitcoin";
        const encrypted = !!body.passphrase;

        // Ensure config directory exists
        await Bun.write(CONFIG_FILE, ""); // This creates parent dirs in Bun
        await Bun.file(CONFIG_FILE).delete();

        let config: WalletConfig;

        if (encrypted && body.passphrase) {
          // Encrypt the mnemonic
          const { ciphertext, salt } = await encryptMnemonic(
            mnemonic,
            body.passphrase,
          );

          // Save salt separately
          await Bun.write(SALT_FILE, salt);

          config = {
            version: 1,
            mnemonic: ciphertext,
            encrypted: true,
            mintUrl,
            createdAt: new Date().toISOString(),
          };

          // Update state to LOCKED
          daemonState = {
            status: "LOCKED",
            encryptedMnemonic: ciphertext,
            mintUrl,
          };
        } else {
          config = {
            version: 1,
            mnemonic,
            encrypted: false,
            mintUrl,
            createdAt: new Date().toISOString(),
          };

          // Initialize wallet immediately
          const manager = await initializeWallet(config);
          const seed = mnemonicToSeedSync(mnemonic);
          daemonState = { status: "UNLOCKED", manager, mintUrl, seed };
        }

        // Save config
        await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));

        const output = encrypted
          ? `Initialized (locked). Mnemonic: ${mnemonic}\nIMPORTANT: Write down this mnemonic and keep it safe!`
          : `Initialized. Mnemonic: ${mnemonic}\nIMPORTANT: Write down this mnemonic and keep it safe!`;

        return Response.json({ output });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json(
          { error: `Init failed: ${message}` },
          { status: 500 },
        );
      }
    }),
  },
  "/unlock": {
    POST: requireLocked(async (req: Request, state: LockedState) => {
      try {
        const body = (await req.json()) as { passphrase: string };

        if (!body.passphrase) {
          return Response.json(
            { error: "Passphrase required" },
            { status: 400 },
          );
        }

        const salt = await Bun.file(SALT_FILE).text();
        const mnemonic = await decryptMnemonic(
          state.encryptedMnemonic,
          body.passphrase,
          salt,
        );

        const config: WalletConfig = {
          version: 1,
          mnemonic,
          encrypted: false,
          mintUrl: state.mintUrl,
          createdAt: new Date().toISOString(),
        };

        const manager = await initializeWallet(config);
        const seed = mnemonicToSeedSync(mnemonic);

        daemonState = {
          status: "UNLOCKED",
          manager,
          mintUrl: state.mintUrl,
          seed,
        };

        return Response.json({ output: "Unlocked" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json(
          { error: `Unlock failed: ${message}` },
          { status: 401 },
        );
      }
    }),
  },
  "/npc/address": {
    GET: requireUnlocked(async (_req, state) => {
      const info = await state.manager.ext.npc.getInfo();
      if (info.name) {
        return Response.json({ output: `${info.name}@npuby.cash` });
      }
      const npub = nip19.npubEncode(info.pubkey);
      return Response.json({ output: `${npub}@npuby.cash` });
    }),
  },

  "/balance": {
    GET: requireUnlocked(async (_req, state) => {
      const balance = await state.manager.wallet.getBalances();
      return Response.json({ output: balance });
    }),
  },
  "/receive": {
    POST: requireUnlocked(async (req, state) => {
      try {
        const body = (await req.json()) as { token: string };
        const token = body.token;
        const decoded = getDecodedToken(token);
        await state.manager.wallet.receive(token);
        const total = decoded.proofs.reduce(
          (a: number, c: { amount: number }) => a + c.amount,
          0,
        );
        return Response.json({ output: `Received ${total}` });
      } catch {
        return Response.json({ error: "Receive failed" });
      }
    }),
  },
  // Mint subcommands
  "/mint/add": {
    POST: requireUnlocked(async (req, state) => {
      const body = (await req.json()) as { url: string };
      await state.manager.mint.addMint(body.url, { trusted: true });
      return Response.json({ output: `Added mint: ${body.url}` });
    }),
  },
  "/mint/list": {
    GET: requireUnlocked(async (_req, state) => {
      const mints = await state.manager.mint.getAllMints();
      return Response.json({ output: mints.join("\n") });
    }),
  },
  "/mint/bolt11": {
    POST: requireUnlocked(async (req, state) => {
      const body = (await req.json()) as { amount: number };
      const quote = await state.manager.quotes.createMintQuote(
        state.mintUrl,
        body.amount,
      );
      return Response.json({ output: quote.request });
    }),
  },
};

// Build Bun routes from handler registry
function buildRoutes(): Record<
  string,
  { GET?: () => Promise<Response>; POST?: (req: Request) => Promise<Response> }
> {
  const routes: Record<
    string,
    {
      GET?: () => Promise<Response>;
      POST?: (req: Request) => Promise<Response>;
    }
  > = {};

  for (const [path, handlers] of Object.entries(routeHandlers)) {
    routes[path] = {};

    if (handlers.GET) {
      const handler = handlers.GET;
      routes[path]!.GET = async () =>
        handler(new Request("http://localhost"), daemonState);
    }

    if (handlers.POST) {
      const handler = handlers.POST;
      routes[path]!.POST = async (req: Request) => handler(req, daemonState);
    }
  }

  return routes;
}

export async function startDaemon() {
  // Check if daemon is already running
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

  // Ensure config directory exists
  try {
    await Bun.write(PID_FILE, "");
    await Bun.file(PID_FILE).delete();
  } catch {
    // Directory creation failed or file didn't exist
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

  // Check for existing configuration and auto-initialize if possible
  try {
    const configExists = await Bun.file(CONFIG_FILE).exists();
    if (configExists) {
      const configText = await Bun.file(CONFIG_FILE).text();
      const config: WalletConfig = JSON.parse(configText);

      if (config.encrypted) {
        // Set to LOCKED state, waiting for unlock
        daemonState = {
          status: "LOCKED",
          encryptedMnemonic: config.mnemonic,
          mintUrl: config.mintUrl,
        };
        console.log(
          "Wallet locked. Run 'cocod unlock <passphrase>' to decrypt.",
        );
      } else {
        // Auto-initialize with plaintext mnemonic
        const manager = await initializeWallet(config);
        const seed = mnemonicToSeedSync(config.mnemonic);
        daemonState = {
          status: "UNLOCKED",
          manager,
          mintUrl: config.mintUrl,
          seed,
        };
        console.log("Wallet auto-initialized (unencrypted).");
      }
    }
  } catch (error) {
    console.warn("Failed to load existing config:", error);
    daemonState = { status: "ERROR", message: String(error) };
  }

  const routes = buildRoutes();

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
  if (daemonState.status === "UNINITIALIZED") {
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
