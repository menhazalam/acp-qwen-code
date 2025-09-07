# acp-qwen-code

ACP (Agent Client Protocol) bridge for [Qwen Code](https://github.com/QwenLM/qwen-code).

This bridge allows you to use Qwen Code with ACP-compatible editors like Zed.

## Installation

### Prerequisites

1. Install [Qwen Code](https://github.com/QwenLM/qwen-code):
   ```bash
   npm install -g @qwen-code/qwen-code@latest
   ```

2. Authenticate Qwen Code:
   ```bash
   qwen auth
   ```

### Install ACP Bridge

```bash
git clone https://github.com/menhazalam/acp-qwen-code.git
cd acp-qwen-code
npm install
npm run build
npm install -g .
```

## Usage

### Zed Editor

Add to your Zed settings (`~/.config/zed/settings.json`):

```json
{
  "agent_servers": {
    "Qwen Code": {
      "command": "acp-qwen-code",
      "env": {
        "ACP_PERMISSION_MODE": "acceptEdits"
      }
    }
  }
}
```

Restart Zed and you'll see "Qwen Code" available in the agent panel.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ACP_PATH_TO_QWEN_CODE_EXECUTABLE` | `qwen` | Path to Qwen CLI |
| `ACP_PERMISSION_MODE` | `default` | Permission mode |
| `ACP_DEBUG` | `false` | Enable debug logging |

Permission modes:
- `default` - Ask for permission on operations
- `acceptEdits` - Auto-approve file edits
- `bypassPermissions` - Auto-approve all operations

## Development

```bash
git clone https://github.com/menhazalam/acp-qwen-code.git
cd acp-qwen-code
npm install
npm run build
npm run dev  # for development with tsx
```

## Credits

This project builds upon the excellent work of:

- [Qwen Team](https://github.com/QwenLM) for the powerful Qwen Code CLI
- [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) which Qwen Code is based on
- [Zed Industries](https://github.com/zed-industries) for the Agent Client Protocol
- [acp-claude-code](https://github.com/Xuanwo/acp-claude-code) for inspiration and reference

