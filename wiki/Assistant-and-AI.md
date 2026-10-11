# Assistant & AI Integration

The Linux Dashboard assistant is an interactive system copilot designed specifically for desktop Linux administration, fixing issues, and automating terminal commands.

---

## 🔒 The Safe Planning Architecture

Unlike tools that blindly execute commands in your shell, Linux Dashboard uses a strict dual-layer safety architecture:

1. **AI Only Plans**:
   - The AI model does **not** have shell execution access or terminal tools.
   - It only outputs structured step proposals with explanations in plain English.
2. **Dashboard Verifies and Classifies**:
   - Each proposed step is checked against the internal safety ruleset (`harm.py` and `assistant.py`).
   - Risk levels:
     - 🟢 **Read-only**: Safe checks (e.g. `df -h`, `ip a`). Can be configured to run automatically if "Auto-check" is enabled.
     - 🟡 **System Change**: Modifies packages, services, or files. Requires explicit confirmation before executing.
     - 🔴 **Danger**: Potential data loss or destructive actions. Emphasized with high-visibility warnings.
   - Root commands automatically use `pkexec` rather than unsafe `sudo` prompts.

---

## 🛑 Stopping AI Generation in Real Time

If you want to stop the AI response mid-thought or cancel ongoing auto-checks:

- **Send Button → Stop**: While generating, the primary button changes into a red **Stop** button. Click to halt immediately.
- **Inline Button**: Click the `Stop generating` button located right under the typing dots in the chat.
- **Keyboard Shortcut**: Press <kbd>Esc</kbd> at any time.

---

## 🤖 Supported AI Providers

Connect your API key in **Settings → Assistant**:

| Provider | Supported Models | Notes |
|---|---|---|
| **Google Gemini** | `gemini-3.7-flash`, `gemini-3.5-pro` | Ultra fast response speed |
| **Anthropic Claude** | `claude-sonnet-5-5`, `claude-opus-5-5` | Deep reasoning & planning |
| **OpenAI** | `gpt-4o`, `gpt-4.1` | Native OpenAI support |
| **OpenRouter** | Any OpenRouter model ID | Multi-provider routing |
| **Groq** | `llama-3.3-70b-versatile` | Blazing-fast inference |
| **Ollama** | Local models (`qwen`, `llama3`, `mistral`) | 100% offline & private |
| **Custom** | Any OpenAI-compatible endpoint | Custom local or enterprise endpoints |

API keys are securely stored in your desktop's system keyring (**KWallet** / **GNOME Keyring**) and are never sent anywhere except the chosen AI provider.
