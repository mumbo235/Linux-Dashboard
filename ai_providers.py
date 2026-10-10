"""Which AI answers the assistant: Claude with your Anthropic API key, or another provider's key.

Claude goes through Anthropic's official Python SDK (installed into a small private Python
environment, since most distributions don't package it). OpenAI, Gemini, OpenRouter, Groq,
Mistral, xAI, DeepSeek, a local Ollama and any other OpenAI-compatible server are spoken to
directly over HTTPS. API keys are kept in the system keyring (KWallet / GNOME Keyring),
or in a file only you can read if there is no keyring; they never go to the web page.
"""
import glob
import importlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "linux-dashboard"
AI_FILE = CONFIG_DIR / "ai.json"
KEYS_FILE = CONFIG_DIR / "keys.json"  # only used when there's no keyring
PYENV = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "linux-dashboard" / "pyenv"

PROVIDERS = {
    "anthropic": {"name": "Claude", "by": "Anthropic", "base": "https://api.anthropic.com", "keys": "https://console.anthropic.com/settings/keys",
                  "hint": "sk-ant-…", "default": "claude-opus-5-5", "prefer": [r"^claude-opus-5-5$", r"^claude-sonnet-5-5$", r"opus", r"sonnet"]},
    "openai": {"name": "ChatGPT models", "by": "OpenAI", "base": "https://api.openai.com/v1", "keys": "https://platform.openai.com/api-keys",
               "hint": "sk-…", "prefer": [r"^gpt-5(\.\d+)?$", r"^gpt-5", r"^gpt-4\.1$", r"^gpt-4o$"]},
    "gemini": {"name": "Gemini", "by": "Google", "base": "https://generativelanguage.googleapis.com/v1beta/openai", "keys": "https://aistudio.google.com/apikey",
               "hint": "AIza…", "prefer": [r"gemini-[\d.]+-pro$", r"gemini-[\d.]+-flash$", r"gemini.*pro", r"gemini.*flash"]},
    "openrouter": {"name": "OpenRouter", "by": "Hundreds of models, one key", "base": "https://openrouter.ai/api/v1", "keys": "https://openrouter.ai/keys",
                   "hint": "sk-or-…", "prefer": [r"^anthropic/claude-opus", r"^anthropic/claude-sonnet", r"^openai/gpt-5"]},
    "groq": {"name": "Groq", "by": "Very fast open models", "base": "https://api.groq.com/openai/v1", "keys": "https://console.groq.com/keys",
             "hint": "gsk_…", "prefer": [r"llama.*70b", r"gpt-oss-120b", r"llama"]},
    "mistral": {"name": "Mistral", "by": "Mistral AI", "base": "https://api.mistral.ai/v1", "keys": "https://console.mistral.ai/api-keys",
                "hint": "", "prefer": [r"^mistral-large-latest$", r"^mistral-medium-latest$", r"large"]},
    "xai": {"name": "Grok", "by": "xAI", "base": "https://api.x.ai/v1", "keys": "https://console.x.ai", "hint": "xai-…", "prefer": [r"^grok-\d+$", r"grok"]},
    "deepseek": {"name": "DeepSeek", "by": "DeepSeek", "base": "https://api.deepseek.com/v1", "keys": "https://platform.deepseek.com/api_keys",
                 "hint": "sk-…", "prefer": [r"deepseek-chat", r"deepseek"]},
    "ollama": {"name": "Ollama", "by": "Free, runs on this computer", "base": "http://localhost:11434/v1", "keys": "https://ollama.com/download",
               "hint": "", "nokey": True, "prefer": [r"qwen.*\d\d+b", r"llama3", r"qwen", r"mistral", r"gemma"]},
    "custom": {"name": "Other", "by": "Any OpenAI-compatible server", "base": "", "keys": "", "hint": "", "custom": True, "prefer": []},
}
NOT_CHAT = re.compile(r"embed|tts|whisper|dall-e|image|audio|realtime|moderation|transcribe|search|babbage|davinci|guard|rerank|ocr|computer-use|vision-preview", re.I)
# Claude prices per million tokens (input, output), for the "what it cost" line
PRICES = {"claude-opus-5-5": (4, 20), "claude-sonnet-5-5": (2, 10), "claude-haiku-4-5": (1, 5), "claude-opus-5": (5, 25),
          "claude-sonnet-5": (3, 15), "claude-fable-5-1": (10, 50)}


# Model families per provider, smallest to biggest: (id, label, icon, what it's like, pattern)
TIERS = {
    "anthropic": [("haiku", "Haiku", "zap", "Fastest and cheapest, for simple questions", r"^claude-haiku"),
                  ("sonnet", "Sonnet", "gauge", "Fast and smart, the best value", r"^claude-sonnet"),
                  ("opus", "Opus", "brain", "Very capable, for tricky problems", r"^claude-opus"),
                  ("fable", "Fable", "sparkles", "The most capable, and the most expensive", r"^claude-fable")],
    "gemini": [("lite", "Flash Lite", "zap", "Fastest and cheapest", r"^gemini-[\d.]+-flash-lite"),
               ("flash", "Flash", "gauge", "Fast and capable, good for most things", r"^gemini-[\d.]+-flash(?!-lite)"),
               ("pro", "Pro", "brain", "Google's smartest, a bit slower", r"^gemini-[\d.]+-pro")],
    "openai": [("nano", "Nano", "zap", "Fastest and cheapest", r"^gpt-[\d.]+-nano$"),
               ("mini", "Mini", "gauge", "Fast and capable", r"^gpt-[\d.]+-mini$"),
               ("full", "Standard", "brain", "OpenAI's main model", r"^gpt-[\d.]+$"),
               ("pro", "Pro", "sparkles", "The most capable, slow and expensive", r"^gpt-[\d.]+-pro$")],
    "xai": [("mini", "Mini", "zap", "Fast and cheap", r"^grok-[\d.]+-mini$"), ("full", "Grok", "brain", "xAI's main model", r"^grok-[\d.]+$")],
    "mistral": [("small", "Small", "zap", "Fast and cheap", r"^mistral-small-latest$"), ("medium", "Medium", "gauge", "Balanced", r"^mistral-medium-latest$"),
                ("large", "Large", "brain", "Mistral's smartest", r"^mistral-large-latest$")],
    "deepseek": [("chat", "Chat", "zap", "Quick answers", r"^deepseek-chat$"), ("reasoner", "Reasoner", "brain", "Thinks longer first", r"^deepseek-reasoner$")],
}
ODD = re.compile(r"tts|image|audio|live|vision|embed|search|computer|customtools|thinking|-\d{4}-\d\d-\d\d$", re.I)  # special-purpose variants


def _version(mid):
    nums = re.findall(r"\d+(?:\.\d+)?", re.sub(r"\d{8}", "", mid))  # ignore release dates like 20251001
    return tuple(float(n) for n in nums)


def tiers(provider, models):
    """The newest model in each family this key can use, e.g. Gemini: Flash Lite, Flash, Pro."""
    ids = [m["id"] for m in models]
    out = []
    for tid, label, icon, desc, rx in TIERS.get(provider, []):
        cands = [i for i in ids if re.search(rx, i)]
        if not cands:
            continue
        # newest version wins; a preview only loses to a finished model of the same version
        best = max(cands, key=lambda i: (not ODD.search(i), _version(i), not re.search(r"preview|exp", i), not re.search(r"\d{8}", i), -len(i)))
        out.append({"id": tid, "label": label, "icon": icon, "desc": desc, "model": best})
    return out


def effort_ok(provider, model):
    """Does this model take a thinking level (Fast / Mid / Smart)?"""
    model = model or ""
    if provider == "anthropic":
        return not model.startswith("claude-haiku")
    if provider == "openai":
        return bool(re.match(r"^(o\d|gpt-5)", model))
    if provider == "gemini":
        return not re.match(r"gemini-(1|2\.0)", model)
    if provider == "xai":
        return "mini" in model
    return False


class AIError(Exception):
    def __init__(self, msg, code="error"):
        super().__init__(msg)
        self.code = code


# ---------- settings and keys ----------

def load():
    try:
        cfg = json.loads(AI_FILE.read_text())
    except Exception:
        cfg = {}
    return cfg if cfg.get("provider") in PROVIDERS else {}


def save(cfg):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    AI_FILE.write_text(json.dumps({k: cfg.get(k) for k in ("provider", "model", "base_url", "models", "models_at") if cfg.get(k) is not None}, indent=1))


def _secret():
    import gi
    gi.require_version("Secret", "1")
    from gi.repository import Secret
    schema = Secret.Schema.new("io.github.jarvis.LinuxDashboard.ApiKey", Secret.SchemaFlags.NONE,
                               {"provider": Secret.SchemaAttributeType.STRING})
    return Secret, schema


def _file_keys():
    try:
        return json.loads(KEYS_FILE.read_text())
    except Exception:
        return {}


def get_key(provider):
    try:
        Secret, schema = _secret()
        k = Secret.password_lookup_sync(schema, {"provider": provider}, None)
        if k:
            return k
    except Exception:
        pass
    return _file_keys().get(provider) or ""


def set_key(provider, key):
    """Keep the key in the keyring; returns where it went."""
    try:
        Secret, schema = _secret()
        if Secret.password_store_sync(schema, {"provider": provider}, Secret.COLLECTION_DEFAULT,
                                      f"Linux Dashboard: {PROVIDERS[provider]['name']} API key", key, None):
            _forget_file_key(provider)
            return "keyring"
    except Exception:
        pass
    keys = _file_keys()
    keys[provider] = key
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    old = os.umask(0o077)
    try:
        KEYS_FILE.write_text(json.dumps(keys))
    finally:
        os.umask(old)
    KEYS_FILE.chmod(0o600)
    return "file"


def _forget_file_key(provider):
    keys = _file_keys()
    if keys.pop(provider, None) is not None:
        KEYS_FILE.write_text(json.dumps(keys))


def forget_key(provider):
    try:
        Secret, schema = _secret()
        Secret.password_clear_sync(schema, {"provider": provider}, None)
    except Exception:
        pass
    _forget_file_key(provider)


def masked(key):
    return (key[:6] + "…" + key[-4:]) if len(key) > 14 else ("•" * 8 if key else "")


def base_url(cfg):
    return (cfg.get("base_url") or PROVIDERS[cfg["provider"]]["base"]).rstrip("/")


# ---------- Anthropic's SDK, from the private environment ----------

def sdk():
    try:
        return importlib.import_module("anthropic")
    except ImportError:
        for sp in glob.glob(str(PYENV / "lib" / "python*" / "site-packages")):
            if sp not in sys.path:
                sys.path.append(sp)
        importlib.invalidate_caches()
        try:
            return importlib.import_module("anthropic")
        except ImportError:
            return None


def sdk_install_cmd():
    py = "/usr/bin/python3" if Path("/usr/bin/python3").exists() else "python3"
    return (f"{py} -m venv --system-site-packages {PYENV} && {PYENV}/bin/pip install --quiet --upgrade --disable-pip-version-check anthropic "
            f"&& echo && echo \"Claude support installed: anthropic $({PYENV}/bin/python -c 'import anthropic; print(anthropic.__version__)')\"")


# ---------- status for the page ----------

def status():
    cfg = load()
    out = {"providers": {k: {kk: v[kk] for kk in ("name", "by", "keys", "hint", "base") if kk in v} | {"nokey": bool(v.get("nokey")), "custom": bool(v.get("custom"))}
                         for k, v in PROVIDERS.items()},
           "configured": False, "sdk": sdk() is not None, "sdkCmd": sdk_install_cmd()}
    if cfg:
        p = cfg["provider"]
        key = get_key(p)
        model = cfg.get("model") or PROVIDERS[p].get("default", "")
        out.update(tiers=tiers(p, cfg.get("models") or []), effort=effort_ok(p, model), modelsAt=cfg.get("models_at"))
        out.update(provider=p, model=model, base_url=cfg.get("base_url") or "",
                   key=masked(key), configured=bool(key or PROVIDERS[p].get("nokey")) and bool(cfg.get("model") or PROVIDERS[p].get("default")),
                   label=f"{PROVIDERS[p]['name']} · {cfg.get('model') or PROVIDERS[p].get('default', '')}")
    out["keys"] = {k: bool(get_key(k)) for k in PROVIDERS if not PROVIDERS[k].get("nokey")}
    return out


# ---------- talking to the providers ----------

def _http(url, body=None, key="", timeout=180, extra=None):
    headers = {"Content-Type": "application/json", "User-Agent": "LinuxDashboard/0.1"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    if "openrouter.ai" in url:
        headers.update({"HTTP-Referer": "https://github.com/linux-dashboard", "X-Title": "Linux Dashboard"})
    headers.update(extra or {})
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers,
                                 method="POST" if body is not None else "GET")
    for attempt in range(4):  # busy servers (overloaded, 5xx) usually answer if asked again a moment later
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            if e.code in (500, 502, 503, 504, 529) and attempt < 3:
                time.sleep((2, 4, 8)[attempt])
                continue
            return _raise_http(e)
        except urllib.error.URLError as e:
            raise AIError(f"Couldn't reach {url.split('/')[2]} ({e.reason}). Are you online?" if "localhost" not in url
                          else "Ollama isn't running on this computer. Install it from ollama.com, then start it.", "offline")
        except TimeoutError:
            raise AIError("The AI took too long to answer. Try again, or pick Fast.", "timeout")


def _raise_http(e):
    """Turn an HTTP error into a plain-English one, using the provider's own message."""
    detail = e.read().decode("utf-8", "replace")[:600]
    try:
        j = json.loads(detail)
        j = j[0] if isinstance(j, list) and j else j
        detail = (j.get("error") or {}).get("message") if isinstance(j.get("error"), dict) else j.get("error") or j.get("message") or detail
    except Exception:
        pass
    raise _status_error(e.code, str(detail))


def _status_error(code, detail):
    if code in (401, 403):
        return AIError("The API key was refused. Check it was copied completely, and that the account is active.", "auth")
    if code == 404:
        return AIError(f"That model isn't available with this key. Pick another in Dashboard settings → Assistant. ({detail[:160]})", "model")
    if code == 429:
        return AIError("The AI provider says slow down, or the account is out of credit. Wait a minute, or check your plan.", "limit")
    if code == 402:
        return AIError("The AI account is out of credit. Add some on the provider's website.", "limit")
    if code >= 500:
        busy = re.search(r"demand|overload|capacity|unavailable|busy", detail, re.I)
        return AIError((f"This model is overloaded right now: lots of people are using it. I tried 4 times. Wait a minute and try again, "
                        f"or pick a different model in Dashboard settings → Assistant." if busy else
                        f"The AI provider is having trouble right now (error {code}: {detail[:200]}). I tried 4 times; try again in a bit."), "server")
    return AIError(f"The AI provider didn't accept the request ({code}): {detail[:300]}", f"http{code}")


def list_models(provider, key=None, base=None):
    """The models this key can use, best guesses first."""
    p = PROVIDERS[provider]
    key = key if key is not None else get_key(provider)
    if provider == "anthropic":
        a = sdk()
        if not a:
            raise AIError("Claude support isn't installed yet.", "sdk")
        try:
            ids = [(m.id, m.display_name) for m in a.Anthropic(api_key=key, max_retries=1, timeout=20).models.list()]
        except a.AuthenticationError:
            raise AIError("The API key was refused. Check it was copied completely.", "auth")
        except a.APIConnectionError:
            raise AIError("Couldn't reach Anthropic. Are you online?", "offline")
        except a.APIStatusError as e:
            raise _status_error(e.status_code, str(e.message))
    else:
        url = (base or p["base"]).rstrip("/")
        if not url:
            raise AIError("Type the server's address first, e.g. http://localhost:8080/v1", "base")
        data = _http(url + "/models", key=key, timeout=20)
        ids = [(m["id"].removeprefix("models/"), m.get("name") or m.get("display_name") or "") for m in data.get("data", []) if isinstance(m, dict) and m.get("id")]
        ids = [(i, n) for i, n in ids if not NOT_CHAT.search(i)]
    rank = lambda i: next((n for n, rx in enumerate(p.get("prefer", [])) if re.search(rx, i)), 99)
    ids.sort(key=lambda x: (rank(x[0]), x[0]))
    return [{"id": i, "name": n if n and n != i else ""} for i, n in ids]


def _clean_schema(s):
    """Drop length/count limits that some providers' structured output doesn't support."""
    if isinstance(s, dict):
        return {k: _clean_schema(v) for k, v in s.items() if k not in ("maxItems", "minItems", "maxLength", "minLength", "minimum", "maximum", "pattern", "format")}
    if isinstance(s, list):
        return [_clean_schema(x) for x in s]
    return s


def _fill(schema, value):
    """Make sure every field the app expects is there, even if a model skipped some."""
    t = schema.get("type")
    if t == "object":
        value = value if isinstance(value, dict) else {}
        return {k: _fill(sub, value.get(k)) for k, sub in schema.get("properties", {}).items()} | {k: v for k, v in value.items() if k not in schema.get("properties", {})}
    if t == "array":
        return [_fill(schema.get("items", {}), v) for v in value] if isinstance(value, list) else []
    if t == "boolean":
        return bool(value) if value is not None else False
    if t in ("integer", "number"):
        return value if isinstance(value, (int, float)) else 0
    if "enum" in schema and value not in schema["enum"]:
        return schema["enum"][0]
    return value if isinstance(value, str) else ("" if value is None else str(value))


def _parse_json(text):
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        a, b = text.find("{"), text.rfind("}")
        if a >= 0 and b > a:
            try:
                return json.loads(text[a:b + 1])
            except json.JSONDecodeError:
                pass
    raise AIError("The AI's answer wasn't in the expected format. Try again, or pick a bigger model.", "format")


def _ask_anthropic(cfg, key, system, prompt, schema, effort, max_tokens):
    a = sdk()
    if not a:
        raise AIError("Claude support isn't installed yet. Open Dashboard settings → Assistant to install it (one click).", "sdk")
    client = a.Anthropic(api_key=key, timeout=240, max_retries=4)  # the SDK retries overloaded/5xx answers itself
    model = cfg.get("model") or PROVIDERS["anthropic"]["default"]
    kwargs = dict(model=model, max_tokens=max_tokens, system=system, messages=[{"role": "user", "content": prompt}],
                  cache_control={"type": "ephemeral"},  # the long instructions are reused, so later answers are cheaper
                  output_config={"format": {"type": "json_schema", "schema": _clean_schema(schema)}} | ({"effort": effort} if effort_ok("anthropic", model) else {}))
    for attempt in range(2):
        try:
            resp = client.messages.create(**kwargs)
            break
        except a.BadRequestError as e:
            if attempt == 0 and "effort" in str(e.message).lower():  # older/smaller models don't take an effort level
                kwargs["output_config"].pop("effort", None)
                continue
            raise AIError(f"Claude didn't accept the request: {e.message}", "http400")
        except a.AuthenticationError:
            raise AIError("Anthropic refused the API key. Check it in Dashboard settings → Assistant.", "auth")
        except a.PermissionDeniedError:
            raise AIError("This API key isn't allowed to use that model.", "auth")
        except a.NotFoundError:
            raise AIError(f"The model {model} isn't available with this key. Pick another in Dashboard settings → Assistant.", "model")
        except a.RateLimitError:
            raise AIError("Anthropic says slow down, or the account is out of credit. Wait a minute, or check console.anthropic.com.", "limit")
        except a.APIConnectionError:
            raise AIError("Couldn't reach Anthropic. Are you online?", "offline")
        except a.APIStatusError as e:
            raise _status_error(e.status_code, str(e.message))
    if resp.stop_reason == "refusal":
        raise AIError("Claude declined to answer that one.", "refusal")
    if resp.stop_reason == "max_tokens":
        raise AIError("The answer got too long and was cut off. Try asking for less at once.", "format")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    u = resp.usage
    tokens = (u.input_tokens or 0) + (u.cache_read_input_tokens or 0) + (u.cache_creation_input_tokens or 0) + (u.output_tokens or 0)
    price = next((v for k, v in PRICES.items() if resp.model.startswith(k)), None)
    cost = None
    if price:
        cost = ((u.input_tokens or 0) + 0.1 * (u.cache_read_input_tokens or 0) + 1.25 * (u.cache_creation_input_tokens or 0)) * price[0] / 1e6 \
            + (u.output_tokens or 0) * price[1] / 1e6
    return _parse_json(text), {"cost": cost, "tokens": tokens, "model": resp.model}


def _ask_openai_style(cfg, key, system, prompt, schema, effort, max_tokens):
    url = base_url(cfg) + "/chat/completions"
    model = cfg.get("model")
    if not model:
        raise AIError("Pick a model in Dashboard settings → Assistant.", "model")
    body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "answer", "schema": _clean_schema(schema), "strict": False}}}
    if effort_ok(cfg["provider"], model):
        body["reasoning_effort"] = effort
    for attempt in range(4):  # step down to what this server understands
        try:
            data = _http(url, body, key=key, timeout=240)
            break
        except AIError as e:
            if not e.code.startswith("http4") or attempt == 3:
                raise
            if "reasoning_effort" in body:
                body.pop("reasoning_effort")
            elif body.get("response_format", {}).get("type") == "json_schema":
                body["response_format"] = {"type": "json_object"}
                body["messages"][0]["content"] = system + "\n\nAnswer with ONLY a JSON object matching this JSON schema:\n" + json.dumps(_clean_schema(schema))
            else:
                body.pop("response_format", None)
    choice = (data.get("choices") or [{}])[0]
    text = (choice.get("message") or {}).get("content") or ""
    if isinstance(text, list):  # some servers return content parts
        text = "".join(p.get("text", "") for p in text if isinstance(p, dict))
    if choice.get("finish_reason") == "length":
        raise AIError("The answer got too long and was cut off. Try asking for less at once.", "format")
    u = data.get("usage") or {}
    return _parse_json(text), {"cost": None, "tokens": (u.get("prompt_tokens") or 0) + (u.get("completion_tokens") or 0), "model": data.get("model") or model}


def refresh_models():
    """Remember which models this key can use (for the model menu)."""
    cfg = load()
    if not cfg:
        return status()
    cfg["models"] = list_models(cfg["provider"], base=cfg.get("base_url") or None)
    cfg["models_at"] = time.strftime("%Y-%m-%d %H:%M")
    save(cfg)
    return status()


def set_model(model):
    cfg = load()
    if not cfg or not re.fullmatch(r"[\w.:/@+-]{1,120}", model or ""):
        raise AIError("That isn't a model name.", "model")
    cfg["model"] = model
    save(cfg)
    return status()


def ask_json(system, prompt, schema, effort="medium", max_tokens=16000):
    """One request to whichever AI is set up. Returns (dict matching schema, info)."""
    cfg = load()
    if not cfg:
        raise AIError("No AI is connected yet. Open Dashboard settings → Assistant and add an API key.", "setup")
    p = cfg["provider"]
    key = get_key(p)
    if not key and not PROVIDERS[p].get("nokey"):
        raise AIError(f"Add your {PROVIDERS[p]['name']} API key in Dashboard settings → Assistant.", "setup")
    effort = effort if effort in ("low", "medium", "high") else "medium"
    t = time.time()
    fn = _ask_anthropic if p == "anthropic" else _ask_openai_style
    out, info = fn(cfg, key, system, prompt, schema, effort, max_tokens)
    info["seconds"] = round(time.time() - t, 1)
    return _fill(schema, out), info


def test(cfg, key):
    """A tiny request, to check the key and model work before saving."""
    old = load()
    save(cfg)
    try:
        fn = _ask_anthropic if cfg["provider"] == "anthropic" else _ask_openai_style
        out, info = fn(cfg, key, "Reply with JSON only.", 'Say {"ok": true}.',
                       {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}, "low", 2000)
        return info
    finally:
        if old:
            save(old)
        else:
            AI_FILE.unlink(missing_ok=True)
