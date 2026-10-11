#!/usr/bin/env python3
"""Linux Dashboard desktop app: a native window that hosts the dashboard UI.

The command server runs inside this process on a random localhost port and
stops when the window is closed. No web browser involved.
"""
import json
import os
import signal
import socket
import sys
import threading
from pathlib import Path

import gi


gi.require_version("Gdk", "4.0")
gi.require_version("Gtk", "4.0")
gi.require_version("WebKit", "6.0")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import batlog  # noqa: E402
import server  # noqa: E402

APP_ID = "io.github.jarvis.LinuxDashboard"
DATA_DIR = Path(GLib.get_user_data_dir()) / "linux-dashboard"
CACHE_DIR = Path(GLib.get_user_cache_dir()) / "linux-dashboard"


FIXED_PORT = 47615  # same address every launch, so the window keeps its saved state (open chat, theme, history)


def free_port():
    for port in (FIXED_PORT, 0):  # fall back to any free port if ours is taken
        with socket.socket() as s:
            # allow re-binding while the previous run's connections are still cooling down (TIME_WAIT),
            # exactly like the server itself does; otherwise we'd fall back to a random port
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                continue
            return s.getsockname()[1]


def start_server():
    server.ThreadingHTTPServer.allow_reuse_address = True
    for _ in range(5):
        server.PORT = free_port()
        try:
            httpd = server.ThreadingHTTPServer((server.HOST, server.PORT), server.Handler)
            break
        except OSError:
            continue
    else:
        server.PORT = 0
        httpd = server.ThreadingHTTPServer((server.HOST, server.PORT), server.Handler)
    httpd.daemon_threads = True
    batlog.start(server.notify, server.load_settings)  # battery history + low-battery alerts
    server.ADMIN.serve()  # remembered-password admin session (see rootsession.py)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.PORT}/"


class DashboardApp(Gtk.Application):
    def __init__(self):
        # HANDLES_COMMAND_LINE: "linux-dashboard --page sound" (the desktop icon's right-click menu)
        # also reaches the window that's already open
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.window = None
        self.url = None
        self.start_page = os.environ.get("LINUX_DASHBOARD_PAGE")  # open straight on a page, e.g. "sound"

    def do_command_line(self, cmdline):
        args = cmdline.get_arguments()[1:]
        page = None
        for i, a in enumerate(args):
            if a == "--page" and i + 1 < len(args):
                page = args[i + 1]
            elif a.startswith("--page="):
                page = a.split("=", 1)[1]
        if self.window and page:
            self.view.evaluate_javascript(f"location.hash = {json.dumps(page)}", -1, None, None, None, None, None)
        elif page:
            self.start_page = page
        self.activate()
        return 0

    def do_activate(self):
        if self.window:  # second launch just brings the existing window forward
            self.window.present()
            return
        self.url = start_server()

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        session = WebKit.NetworkSession.new(str(DATA_DIR), str(CACHE_DIR))
        view = WebKit.WebView(network_session=session)
        view.get_settings().set_enable_developer_extras(False)
        view.get_settings().set_enable_back_forward_navigation_gestures(False)

        # Disable all native touchpad pinch-to-zoom and gesture zooming
        controllers = view.observe_controllers()
        for i in range(controllers.get_n_items()):
            c = controllers.get_item(i)
            if isinstance(c, Gtk.GestureZoom):
                view.remove_controller(c)

        # Intercept any pinch gestures in CAPTURE phase before WebKit handles them
        no_zoom = Gtk.GestureZoom.new()
        no_zoom.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        no_zoom.connect("scale-changed", lambda g, s: g.set_state(Gtk.EventSequenceState.CLAIMED))
        view.add_controller(no_zoom)

        # Intercept Ctrl+Scroll so touchpad pinch / Ctrl+wheel doesn't zoom natively
        scroll_ctl = Gtk.EventControllerScroll.new(Gtk.EventControllerScrollFlags.BOTH_AXES | Gtk.EventControllerScrollFlags.KINETIC)
        scroll_ctl.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        def on_scroll(ctl, dx, dy):
            state = ctl.get_current_event_state()
            if state & Gdk.ModifierType.CONTROL_MASK:
                return True
            return False
        scroll_ctl.connect("scroll", on_scroll)
        view.add_controller(scroll_ctl)

        # Lock WebKit's native zoom_level to 1.0 (zoom is safely handled via CSS layout zoom in settings)
        def on_zoom_change(wv, pspec):
            if wv.get_zoom_level() != 1.0:
                wv.set_zoom_level(1.0)
        view.connect("notify::zoom-level", on_zoom_change)

        view.connect("decide-policy", self.on_policy)
        self.inspector = False
        view.connect("context-menu", lambda *a: not self.inspector)  # no browser-style right-click menu (unless the developer inspector is on)
        # Lets the page open a native file chooser (e.g. "Choose image…" for the wallpaper)
        ucm = view.get_user_content_manager()
        ucm.register_script_message_handler("pick", None)
        ucm.connect("script-message-received::pick", self.on_pick)
        ucm.register_script_message_handler("dev", None)
        ucm.connect("script-message-received::dev", self.on_dev)
        self.view = view
        page = self.start_page
        view.load_uri(self.url + (f"#{page}" if page else ""))

        self.window = Gtk.ApplicationWindow(application=self, title="Linux Dashboard")
        prefs = server.load_settings()
        self.window.set_default_size(1280, 820)
        if prefs.get("maximized"):
            self.window.maximize()
        Gtk.Window.set_default_icon_name(APP_ID)
        self.window.set_icon_name(APP_ID)
        self.window.set_child(view)

        # Ctrl+R reloads, Ctrl+Q quits
        reload = Gio.SimpleAction.new("reload", None)
        reload.connect("activate", lambda *a: view.reload())
        self.add_action(reload)
        self.set_accels_for_action("app.reload", ["<Control>r", "F5"])
        quit_ = Gio.SimpleAction.new("quit", None)
        quit_.connect("activate", lambda *a: self.quit_cleanly())
        self.add_action(quit_)
        self.set_accels_for_action("app.quit", ["<Control>q"])

        self.window.connect("close-request", lambda *a: self.shutdown_page() or False)
        # pkill / logout send SIGTERM: close cleanly too
        try:  # newer PyGObject moved this to GLibUnix
            gi.require_version("GLibUnix", "2.0")
            from gi.repository import GLibUnix
            add_signal = GLibUnix.signal_add
        except (ImportError, ValueError, AttributeError):
            add_signal = GLib.unix_signal_add
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            add_signal(GLib.PRIORITY_DEFAULT, sig, self.quit_cleanly)

        self.window.present()

    def shutdown_page(self):
        """Stop the page's drawing process before we exit. Left to exit on its own, WebKit's
        graphics clean-up crashes inside the Mesa driver (dri_gbm.so) and leaves a crash report."""
        view = getattr(self, "view", None)
        if view is not None:
            try:
                view.terminate_web_process()
            except Exception:
                pass
            self.view = None

    def quit_cleanly(self, *_):
        self.shutdown_page()
        self.quit()
        return GLib.SOURCE_REMOVE

    def on_dev(self, _ucm, value):
        """Developer panel requests: turn the web inspector on/off, or restart the app."""
        try:
            req = json.loads(value.to_json(0))
            if isinstance(req, str):  # the page sends a JSON string
                req = json.loads(req)
        except Exception:
            return
        if not isinstance(req, dict):
            return
        if req.get("action") == "inspector":
            self.inspector = bool(req.get("on"))
            self.view.get_settings().set_enable_developer_extras(self.inspector)
            if self.inspector and req.get("open"):
                self.view.get_inspector().show()
        elif req.get("action") == "restart":
            import subprocess
            # the per-user command if there is one, else the system package's
            subprocess.Popen(["setsid", "sh", "-c", "sleep 1.2; [ -x ~/.local/bin/linux-dashboard ] && exec ~/.local/bin/linux-dashboard; exec linux-dashboard"],
                             start_new_session=True)
            self.quit_cleanly()

    def on_pick(self, _ucm, value):
        kind = value.to_string()
        dialog = Gtk.FileDialog(title={"font": "Choose a font file", "iso": "Choose an installer (.iso)"}.get(kind, "Choose an image"))
        if kind == "iso":
            f = Gtk.FileFilter(name="Installer images (.iso)")
            f.add_pattern("*.iso"); f.add_pattern("*.ISO")
            filters = Gio.ListStore.new(Gtk.FileFilter)
            filters.append(f)
            dialog.set_filters(filters)
            dialog.set_initial_folder(Gio.File.new_for_path(str(Path.home() / "Downloads")))
        if kind == "font":
            f = Gtk.FileFilter(name="Fonts")
            for pat in ("*.ttf", "*.otf", "*.ttc", "*.woff", "*.woff2", "*.TTF", "*.OTF"):
                f.add_pattern(pat)
            filters = Gio.ListStore.new(Gtk.FileFilter)
            filters.append(f)
            dialog.set_filters(filters)
            dialog.set_initial_folder(Gio.File.new_for_path(str(Path.home() / "Downloads")))
        if kind == "image":
            f = Gtk.FileFilter(name="Images")
            f.add_mime_type("image/*")
            filters = Gio.ListStore.new(Gtk.FileFilter)
            filters.append(f)
            dialog.set_filters(filters)
            pics = Path.home() / "Pictures"
            if pics.is_dir():
                dialog.set_initial_folder(Gio.File.new_for_path(str(pics)))

        def done(dlg, res):
            try:
                path = dlg.open_finish(res).get_path()
            except GLib.Error:
                return  # cancelled
            js = f"window.__picked({json.dumps(kind)}, {json.dumps(path)})"
            self.view.evaluate_javascript(js, -1, None, None, None, None, None)

        dialog.open(self.window, None, done)

    def on_policy(self, view, decision, kind):
        """Keep the app on its own page; open any outside link in the normal browser."""
        if kind in (WebKit.PolicyDecisionType.NAVIGATION_ACTION, WebKit.PolicyDecisionType.NEW_WINDOW_ACTION):
            uri = decision.get_navigation_action().get_request().get_uri()
            if not uri.startswith(self.url):
                Gio.AppInfo.launch_default_for_uri(uri, None)
                decision.ignore()
                return True
        return False


if __name__ == "__main__":
    sys.exit(DashboardApp().run(sys.argv))
