# Troubleshooting & FAQ

---

## ❓ Frequently Asked Questions

### 1. Where are settings and saved chats stored?
- User settings: `~/.config/linux-dashboard/settings.json`
- Chat history: `~/.config/linux-dashboard/chats/`
- AI configuration: `~/.config/linux-dashboard/ai.json`
- Cached data & logs: `~/.cache/linux-dashboard/`

### 2. The app doesn't open on first click
Check the startup log:
```bash
cat ~/.cache/linux-dashboard/app.log
```
Usually this happens if required system libraries (`gir1.2-webkit-6.0` on Debian/Ubuntu or `webkitgtk-6.0` on Arch/Fedora) are missing. Run the installer script with `--yes` to auto-install missing packages:
```bash
bash linux-dashboard-install.sh --yes
```

### 3. The assistant says "Connect an AI first"
The dashboard does not bundle a paid cloud subscription. You can connect:
- A free Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).
- An Anthropic Claude API key from [Anthropic Console](https://console.anthropic.com/settings/keys).
- Or run completely free and locally using [Ollama](https://ollama.com/) with models like `qwen2.5:7b` or `llama3.2`.

### 4. How do I reset all settings?
In **Dashboard Settings → Behavior**, scroll down and click **Reset dashboard settings**.
Alternatively, via terminal:
```bash
rm -rf ~/.config/linux-dashboard/settings.json
```

---

## 🐛 Still having issues or need help?

If you encounter any bugs, crashes, or unexpected behavior:

> [!TIP]
> Please open an issue on the **[GitHub Issues Page](https://github.com/mumbo235/Linux-Dashboard/issues)**!
>
> When reporting an issue, please include:
> - **Distribution & Desktop**: (e.g. Linux Mint Cinnamon, Ubuntu GNOME, Arch KDE)
> - **Description**: What you expected to happen vs what actually happened
> - **Log output**: Check `~/.cache/linux-dashboard/app.log` (or run `cat ~/.cache/linux-dashboard/app.log`)

