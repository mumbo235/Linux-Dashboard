# Customization & Display Settings

Linux Dashboard is highly customizable and designed to integrate seamlessly into modern Linux desktop environments.

---

## 🎨 Themes & Colors

Located in **Dashboard Settings → Appearance**:

- **Themes**:
  - `System` (auto follows desktop dark/light mode)
  - `Dark`
  - `Light`
  - `Retro` (amber terminal CRT vibe)
- **OLED Pure Black**: Enables absolute `#000000` backgrounds for OLED and power savings.
- **Accent Colors**: Custom color picker or curated presets (Blue, Purple, Emerald, Rose, Amber, etc.).
- **Background Tinting**: Subtle, Strong, or Bold washes that tint container surfaces with your accent color.

---

## 🔍 Interface Zoom & Scaling

To ensure clean layout on high-DPI displays or small laptop screens without breaking layout:

- **Zoom Presets**: Found in **Settings → Layout** and **Settings → Font & text size**:
  - **80%**, **90%**, **100%**, **110%**, **125%**
- **Keyboard Shortcuts**:
  - <kbd>Ctrl</kbd> + <kbd>+</kbd> / <kbd>=</kbd>: Zoom in
  - <kbd>Ctrl</kbd> + <kbd>-</kbd>: Zoom out
  - <kbd>Ctrl</kbd> + <kbd>0</kbd>: Reset zoom to 100%

---

## 🛡️ Touchpad & Gesture Protection

On Linux laptops, accidental pinch gestures on the trackpad normally trigger browser viewport zooming, which can crop fixed sidebars and composers off-screen.

Linux Dashboard protects against this at both the GTK4 widget layer and web rendering layer:
- GTK4 `GtkGestureZoom` controller is detached from the WebView.
- Web viewport is locked (`user-scalable=no`).
- CSS `touch-action: pan-x pan-y` allows smooth two-finger scrolling while blocking pinch-zoom.
- Window scaling remains clean and accessible via Settings and <kbd>Ctrl</kbd>+<kbd>+</kbd>/<kbd>-</kbd>.
