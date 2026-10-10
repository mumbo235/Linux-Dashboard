#!/usr/bin/env python3
"""Do-not-disturb: pauses desktop notifications for as long as this runs."""
from gi.repository import Gio, GLib

bus = Gio.bus_get_sync(Gio.BusType.SESSION)
bus.call_sync("org.freedesktop.Notifications", "/org/freedesktop/Notifications",
              "org.freedesktop.Notifications", "Inhibit",
              GLib.Variant("(ssa{sv})", ("linux-dashboard", "Do not disturb", {})),
              None, Gio.DBusCallFlags.NONE, -1, None)
GLib.MainLoop().run()
