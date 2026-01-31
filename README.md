# cocod

A Cashu wallet CLI and daemon built with Bun and TypeScript.

## Overview

`cocod` is a [Cashu](https://cashu.space/) e-cash wallet with a client-daemon architecture. It provides a command-line interface for managing Cashu tokens while a background daemon handles all wallet operations, state management, and mint communication.

### Features

- **Wallet Management**: Initialize with BIP39 mnemonics, optional passphrase encryption
- **Token Operations**: Receive Cashu tokens, check balances across mints
- **Lightning Integration**: Create BOLT11 invoices to mint new tokens
- **Nostr Payment Codes**: NPC addresses for receiving payments
- **Transaction History**: View and paginate wallet history
- **Real-time Updates**: SSE endpoint for live event streaming
- **Multi-mint Support**: Add and manage multiple Cashu mints

## Installation

```bash
bun install
```

## Usage

### Quick Start

```bash
# Check daemon status
bun src/index.ts status

# Initialize wallet (generates mnemonic automatically)
bun src/index.ts init

# Or initialize with your own mnemonic
bun src/index.ts init "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

# Unlock encrypted wallet (if passphrase was set)
bun src/index.ts unlock "your-passphrase"

# Check balance
bun src/index.ts balance
```

### Available Commands

#### Wallet Operations

| Command               | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `status`              | Check daemon and wallet status                                  |
| `init [mnemonic]`     | Initialize wallet (generates mnemonic if not provided)          |
| `unlock <passphrase>` | Unlock encrypted wallet                                         |
| `balance`             | Get wallet balance across all mints                             |
| `receive <token>`     | Receive a Cashu token                                           |
| `history`             | View wallet history (supports `--offset`, `--limit`, `--watch`) |

#### Mint Management

| Command                | Description                             |
| ---------------------- | --------------------------------------- |
| `mint add <url>`       | Add a new mint URL                      |
| `mint list`            | List configured mints                   |
| `mint bolt11 <amount>` | Create Lightning invoice to mint tokens |

#### NPC (npub.cash)

| Command       | Description                            |
| ------------- | -------------------------------------- |
| `npc address` | Get NPC address for receiving payments |

#### Daemon Control

| Command  | Description                            |
| -------- | -------------------------------------- |
| `ping`   | Test daemon connectivity               |
| `stop`   | Stop the background daemon             |
| `daemon` | Start the background daemon explicitly |

### Examples

```bash
# Add a mint
bun src/index.ts mint add https://mint.example.com

# Create a Lightning invoice for 1000 sats
bun src/index.ts mint bolt11 1000

# Receive a Cashu token
bun src/index.ts receive "cashuAeyJ0b2tlbiI6W3sicHJvb2ZzIjpbeyJ..."

# View last 10 history entries
bun src/index.ts history --limit 10

# Watch history in real-time
bun src/index.ts history --watch
```

## Architecture

### Client-Daemon Model

- **CLI** (`src/cli.ts`): Thin client that sends HTTP requests to the daemon via Unix socket
- **Daemon** (`src/daemon.ts`): Background service using `Bun.serve()` that handles all wallet operations

The CLI automatically starts the daemon if it's not already running.

### IPC Communication

Communication happens over a Unix domain socket:

- Default: `~/.cocod/cocod.sock`
- Configurable via `COCOD_SOCKET` environment variable

## Configuration

### Environment Variables

| Variable       | Default               | Description      |
| -------------- | --------------------- | ---------------- |
| `COCOD_SOCKET` | `~/.cocod/cocod.sock` | Unix socket path |
| `COCOD_PID`    | `~/.cocod/cocod.pid`  | PID file path    |

### Files

- **Config**: `~/.cocod/config.json`
- **Database**: `./coco.db` (SQLite, auto-generated)
- **PID file**: Tracks running daemon process

## Development

### Commands

```bash
# Run CLI
bun src/index.ts --help

# Run with npm-style script
bun run start -- --help

# Start daemon explicitly
bun run daemon

# Type check
bun run lint
# or
bunx tsc --noEmit

# Build bundle
bun build src/index.ts --outdir dist --target bun
```

### Project Structure

```
src/
├── index.ts          # CLI entrypoint (shebang: #!/usr/bin/env bun)
├── cli.ts            # Commander-based CLI commands
├── cli-shared.ts     # IPC utilities
├── daemon.ts         # Bun.serve() daemon setup
├── routes.ts         # HTTP route handlers
└── utils/
    ├── config.ts     # Config management
    ├── state.ts      # Daemon state machine
    ├── wallet.ts     # Wallet initialization
    └── crypto.ts     # Mnemonic encryption
```

## Dependencies

- **Bun**: Runtime and built-in APIs (`Bun.serve()`, `fetch()`, `bun:sqlite`)
- **Cashu**: `coco-cashu-core`, `coco-cashu-sqlite3`, `coco-cashu-plugin-npc`
- **CLI**: `commander` for argument parsing
- **Crypto**: `@scure/bip39` for mnemonics, `nostr-tools` for NPC

## License

[Add your license here]
