// Tips, guided fixes and assistant suggestions. Plain data; app.js renders it.

// Tips: t = title, d = explanation (may contain <code>/<kbd>), cat = category,
// cmd = optional read-only command to try, page = optional dashboard page
const TIPS = [
  // keyboard & desktop
  { cat: "Desktop", t: "Open any app instantly", d: "Press <kbd>Alt</kbd>+<kbd>Space</kbd> and start typing an app name, a file, a calculation like <code>12*7</code>, or a unit conversion like <code>5 miles in km</code>." },
  { cat: "Desktop", t: "Clipboard history", d: "Press <kbd>Meta</kbd>+<kbd>V</kbd> to see everything you've copied recently and paste an older item. (<kbd>Meta</kbd> is the Windows/⌘ key.)" },
  { cat: "Desktop", t: "Snap windows to the side", d: "<kbd>Meta</kbd>+<kbd>←</kbd> or <kbd>→</kbd> snaps a window to half the screen. <kbd>Meta</kbd>+<kbd>↑</kbd> maximizes it." },
  { cat: "Desktop", t: "See all your windows", d: "<kbd>Meta</kbd>+<kbd>W</kbd> opens Overview: every window side by side, plus a search box." },
  { cat: "Desktop", t: "Screenshot a region", d: "<kbd>Meta</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> lets you drag a box to capture. <kbd>Print</kbd> opens the full screenshot tool.", page: "tools" },
  { cat: "Desktop", t: "Emoji picker", d: "<kbd>Meta</kbd>+<kbd>.</kbd> opens a searchable emoji picker in any app." },
  { cat: "Desktop", t: "Lock your screen fast", d: "<kbd>Meta</kbd>+<kbd>L</kbd> locks the screen when you step away." },
  { cat: "Desktop", t: "Open a terminal anywhere", d: "<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> opens Konsole. In Dolphin, <kbd>F4</kbd> shows a terminal already in the current folder." },
  { cat: "Desktop", t: "Find your mouse pointer", d: "Lost the cursor on a big screen? Shake the mouse and it grows.", page: "appearance" },
  { cat: "Desktop", t: "Frozen app?", d: "Press <kbd>Ctrl</kbd>+<kbd>Esc</kbd> for the system monitor, or use Running Programs here to end it.", page: "procs" },
  { cat: "Desktop", t: "Undo a closed tab or window position", d: "Most apps support <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> to reopen a closed tab. In Dolphin, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes moves and renames." },
  // terminal basics
  { cat: "Terminal", t: "Tab completes for you", d: "Type the first few letters of a file or command and press <kbd>Tab</kbd>. Press it twice to see all options. It saves typing and typos." },
  { cat: "Terminal", t: "Stop a running command", d: "<kbd>Ctrl</kbd>+<kbd>C</kbd> stops whatever is running in a terminal. It doesn't copy there; use <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> to copy." },
  { cat: "Terminal", t: "Search your command history", d: "In a terminal, press <kbd>Ctrl</kbd>+<kbd>R</kbd> and type part of an old command to find it again." },
  { cat: "Terminal", t: "Every command explains itself", d: "Add <code>--help</code> to almost any command for a quick summary, or run <code>man command</code> for the full manual.", cmd: "ls --help | head -25" },
  { cat: "Terminal", t: "~ means your home folder", d: "<code>~</code> is short for <code>/home/you</code>. <code>cd ~</code> takes you home, <code>cd ..</code> goes up a folder, <code>cd -</code> goes back.", cmd: "echo ~" },
  { cat: "Terminal", t: "Pipes chain commands", d: "<code>|</code> sends one command's output into the next. <code>ps aux | grep firefox</code> lists processes, then keeps only Firefox lines.", cmd: "ps aux | grep -i plasma | head -5" },
  { cat: "Terminal", t: "&& means 'then, if that worked'", d: "<code>cd Downloads && ls</code> only lists if the <code>cd</code> succeeded. <code>;</code> runs the next one regardless." },
  { cat: "Terminal", t: "Quote names with spaces", d: "Use quotes around file names with spaces: <code>cd \"My Files\"</code>. Without them the terminal sees two separate words." },
  { cat: "Terminal", t: "> saves output to a file", d: "<code>ls > list.txt</code> writes the output into a file (replacing it). <code>>></code> adds to the end instead." },
  { cat: "Terminal", t: "Upper and lower case matter", d: "On Linux <code>Photo.jpg</code> and <code>photo.jpg</code> are two different files, and commands are case-sensitive too." },
  // files & system
  { cat: "Files", t: "Hidden files start with a dot", d: "Files like <code>.bashrc</code> are hidden. In Dolphin press <kbd>Ctrl</kbd>+<kbd>H</kbd> to show them; in a terminal use <code>ls -a</code>.", cmd: "ls -a ~ | head -20" },
  { cat: "Files", t: "Where settings live", d: "Your app settings are in <code>~/.config</code>. System-wide settings are in <code>/etc</code>, which needs admin rights to change.", cmd: "ls ~/.config | head -30" },
  { cat: "Files", t: "Open anything from the terminal", d: "<code>xdg-open file.pdf</code> opens a file in its normal app, the same as double-clicking it." },
  { cat: "Files", t: "What's eating my disk?", d: "<code>du -sh *</code> shows the size of everything in the current folder.", cmd: "du -sh ~/* 2>/dev/null | sort -rh | head -10", page: "storage" },
  { cat: "Files", t: "Permissions in 10 seconds", d: "<code>ls -l</code> shows things like <code>-rwxr-xr--</code>: read, write, execute for owner, group, everyone. <code>chmod +x file</code> makes a script runnable.", cmd: "ls -l ~ | head -8" },
  { cat: "Files", t: "Everything is a file", d: "Even hardware shows up as files. <code>/proc/cpuinfo</code> describes your processor.", cmd: "grep -m1 'model name' /proc/cpuinfo" },
  // Arch specifics
  { cat: "Arch", t: "Update the whole system, not one app", d: "Arch expects everything updated together. Never run <code>pacman -Sy something</code> on its own (a 'partial upgrade'); use <b>Update everything</b> instead.", page: "apps" },
  { cat: "Arch", t: "Read the news before big updates", d: "archlinux.org/news posts when an update needs a manual step. The assistant can check it for you: ask “anything I should know before updating?”" },
  { cat: "Arch", t: "The Arch Wiki is gold", d: "wiki.archlinux.org is the best Linux documentation there is, even for other distros. Search it whenever something's confusing." },
  { cat: "Arch", t: "AUR = community packages", d: "The AUR has almost everything, built from recipes anyone can submit. Popular ones are fine; for obscure ones check the votes and comments first." },
  { cat: "Arch", t: "Official vs Flatpak", d: "Official packages update with your system. Flatpaks are sandboxed apps from Flathub that bring their own libraries. Both are fine; Flatpak is handy for apps like Spotify and Discord." },
  { cat: "Arch", t: "Who installed this file?", d: "<code>pacman -Qo /path/to/file</code> tells you which package a file came from.", cmd: "pacman -Qo /usr/bin/ls" },
  { cat: "Arch", t: "What did I install myself?", d: "<code>pacman -Qe</code> lists packages you installed on purpose (not ones pulled in automatically).", cmd: "pacman -Qeq | wc -l" },
  { cat: "Arch", t: "Your update history", d: "Every install, update and removal is logged in <code>/var/log/pacman.log</code>, which is handy after something breaks.", cmd: "grep -E 'upgraded|installed|removed' /var/log/pacman.log | tail -15" },
  // troubleshooting & safety
  { cat: "Fixing", t: "Logs explain most problems", d: "<code>journalctl -b -p err</code> lists errors since boot. Paste confusing ones into the assistant and it will explain them.", cmd: "journalctl -b -p err --no-pager | tail -15", page: "logs" },
  { cat: "Fixing", t: "Services are background programs", d: "<code>systemctl status NAME</code> shows if one is running and its recent messages.", cmd: "systemctl status NetworkManager --no-pager | head -12", page: "services" },
  { cat: "Fixing", t: "Restart fixes more than you'd think", d: "Sound, network and the panel can each be restarted on their own without rebooting. Look for the “Fix …” buttons.", page: "tools" },
  { cat: "Fixing", t: "Be careful with rm", d: "<code>rm</code> deletes immediately (no trash). Never run <code>rm -rf</code> on something you copied from the internet without understanding it." },
  { cat: "Fixing", t: "Don't pipe the internet into a shell", d: "Commands like <code>curl … | sh</code> run whatever a website sends. Prefer packages from pacman, the AUR or Flathub." },
  { cat: "Fixing", t: "Back up before big changes", d: "Before editing system files, copy them: <code>cp file file.bak</code>. Then you can always put the original back." },
  { cat: "Fixing", t: "Kernel updated? Restart soon", d: "After a kernel update some things (like new USB devices or VMs) can misbehave until you restart.", cmd: "uname -r; pacman -Q linux 2>/dev/null || pacman -Qs '^linux' | head -4" },
];

// Guided fixes: ready-made step lists (no AI needed). risk: read | change | danger
const GUIDES = [
  { id: "slow", t: "My computer feels slow", i: "gauge", c: "orange", d: "Find what's hogging the CPU, memory or disk", steps: [
    { title: "How busy is it?", cmd: "uptime", why: "The three 'load average' numbers show how busy the CPU has been over 1, 5 and 15 minutes. Compare them to your number of cores.", risk: "read" },
    { title: "Memory", cmd: "free -h", why: "If 'available' is very low, the computer is short on RAM and has to slow down.", risk: "read" },
    { title: "Top programs", cmd: "ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -12", why: "The programs using the most CPU right now, with their memory share.", risk: "read" },
    { title: "Disk space", cmd: "df -h / /home 2>/dev/null | uniq", why: "A nearly full disk slows everything down.", risk: "read" },
    { title: "Temperatures", cmd: "sensors 2>/dev/null | grep -E 'Package|Core 0|edge|Composite' ", why: "A hot CPU slows itself down to cool off (throttling).", risk: "read" },
  ] },
  { id: "sound", t: "No sound", i: "volume", c: "red", d: "Check the output device and restart audio", steps: [
    { title: "Audio devices", cmd: "wpctl status | sed -n '/Audio/,/Video/p' | head -40", why: "Lists speakers and mics. The one marked with * is the current default.", risk: "read" },
    { title: "Volume and mute", cmd: "wpctl get-volume @DEFAULT_AUDIO_SINK@", why: "Shows the volume of the default output and whether it's muted.", risk: "read" },
    { title: "Is the sound system running?", cmd: "systemctl --user is-active pipewire pipewire-pulse wireplumber", why: "PipeWire is the program that handles all sound. All three should say 'active'.", risk: "read" },
    { title: "Restart the sound system", cmd: "systemctl --user restart pipewire pipewire-pulse wireplumber && sleep 1 && wpctl status | head -25", why: "Restarting PipeWire fixes most 'no sound' problems. Apps may need to restart their playback.", risk: "change" },
  ] },
  { id: "net", t: "Internet isn't working", i: "wifi", c: "cyan", d: "Find out which part of the connection is broken", steps: [
    { title: "Network adapters", cmd: "ip -br addr", why: "Shows each network adapter and its address. 'UP' with an address like 192.168.x.x means it's connected to your router.", risk: "read" },
    { title: "Reach the internet", cmd: "ping -c 3 -W 2 1.1.1.1", why: "Tests the internet connection without needing name lookups (DNS).", risk: "read" },
    { title: "Name lookups (DNS)", cmd: "getent hosts archlinux.org", why: "Tests turning names like archlinux.org into addresses. If ping works but this fails, it's a DNS problem.", risk: "read" },
    { title: "NetworkManager status", cmd: "nmcli general status", why: "The service that manages Wi-Fi and Ethernet. 'connected' is good.", risk: "read" },
    { title: "Restart networking", cmd: "pkexec systemctl restart NetworkManager && sleep 4 && nmcli general status", why: "Restarts the network service, which fixes most 'connected but no internet' cases.", risk: "change" },
  ] },
  { id: "space", t: "Free up disk space", i: "disk", c: "amber", d: "See what's big and clear the safe stuff", steps: [
    { title: "How full is the disk?", cmd: "df -h /", why: "Size, used and available space on the system drive.", risk: "read" },
    { title: "Biggest folders in home", cmd: "du -h -d1 ~ 2>/dev/null | sort -rh | head -12", why: "Which folders in your home take the most space.", risk: "read" },
    { title: "Cache and logs", cmd: "du -sh ~/.cache /var/cache/pacman/pkg 2>/dev/null; journalctl --disk-usage", why: "App cache, old package downloads and system logs: all safe to shrink.", risk: "read" },
    { title: "Clear app cache", cmd: "rm -rf ~/.cache/* && echo 'Cache cleared'", why: "Apps rebuild this as needed. Close your browser first.", risk: "danger" },
    { title: "Remove old package downloads", cmd: "pkexec pacman -Sc --noconfirm --color never", why: "Deletes cached installers for packages that are no longer installed or out of date.", risk: "change" },
  ] },
  { id: "recent", t: "What changed recently?", i: "history", c: "violet", d: "See recent installs and updates", steps: [
    { title: "Recent package changes", cmd: "grep -E 'installed|upgraded|removed' /var/log/pacman.log | tail -30", why: "The last 30 installs, updates and removals with dates, useful when something just broke.", risk: "read" },
    { title: "Last full update", cmd: "grep 'starting full system upgrade' /var/log/pacman.log | tail -3", why: "When you last updated everything.", risk: "read" },
  ] },
  { id: "lock", t: "“Unable to lock database”", i: "lock", c: "slate", d: "Fix pacman's stuck lock file safely", steps: [
    { title: "Is an update still running?", cmd: "pgrep -a 'pacman|yay|pamac' || echo 'No package manager is running'", why: "The lock exists while pacman runs. If one is still running, wait for it instead.", risk: "read" },
    { title: "Is the lock file there?", cmd: "ls -l /var/lib/pacman/db.lck 2>/dev/null || echo 'No lock file. Nothing to fix'", why: "A leftover lock (from a crash or closed window) blocks all installs.", risk: "read" },
    { title: "Remove the stale lock", cmd: "pgrep -x pacman >/dev/null && echo 'pacman is running. Not touching the lock' || pkexec rm -f /var/lib/pacman/db.lck", why: "Only deletes the lock when no pacman is running. Deleting it during an update could damage the package database.", risk: "danger" },
  ] },
  { id: "who-net", t: "What's using the internet?", i: "network", c: "teal", d: "List programs with open connections", steps: [
    { title: "Open connections", cmd: "ss -tunp state established | head -30", why: "Each line is a live connection: your address, the remote address and the program (shown for your own programs).", risk: "read" },
    { title: "Listening services", cmd: "ss -tulpn | head -20", why: "Programs waiting for incoming connections. On a desktop there should be few.", risk: "read" },
  ] },
  { id: "hw", t: "What hardware do I have?", i: "cpu", c: "blue", d: "CPU, memory, graphics, disks", steps: [
    { title: "Processor", cmd: "lscpu | grep -E 'Model name|^CPU\\(s\\)|Thread|MHz' ", why: "CPU model and how many cores/threads it has.", risk: "read" },
    { title: "Memory", cmd: "free -h | head -2", why: "Total and available RAM.", risk: "read" },
    { title: "Graphics, sound, network chips", cmd: "lspci | grep -iE 'vga|3d|display|audio|network|ethernet'", why: "The main chips plugged into the motherboard.", risk: "read" },
    { title: "Drives", cmd: "lsblk -d -o NAME,SIZE,MODEL,ROTA -e7,11", why: "Your disks. ROTA 0 means an SSD (fast), 1 means a spinning hard drive.", risk: "read" },
  ] },
  { id: "crash", t: "Something crashed", i: "bug", c: "red", d: "Find recent crashes and errors", steps: [
    { title: "Recent crashes", cmd: "coredumpctl list --no-pager 2>/dev/null | tail -10 || echo 'No crash records'", why: "Programs that crashed hard leave a record here, with time and name.", risk: "read" },
    { title: "Errors since boot", cmd: "journalctl -b -p err --no-pager | tail -30", why: "Error messages from this session.", risk: "read" },
    { title: "Failed services", cmd: "systemctl --failed --no-legend; systemctl --user --failed --no-legend", why: "Background services that didn't start properly.", risk: "read" },
  ] },
  { id: "update", t: "Update safely", i: "download", c: "green", d: "Check the news, see what's coming, then update", steps: [
    { title: "Latest Arch news", cmd: "curl -s --max-time 10 https://archlinux.org/feeds/news/ | grep -oP '(?<=<title>).*?(?=</title>)' | sed -n '2,6p'", why: "Recent headlines. If one mentions 'manual intervention', ask the assistant before updating.", risk: "read" },
    { title: "Disk space for the update", cmd: "df -h / | tail -1", why: "Updates need a few GB free.", risk: "read" },
    { title: "Update everything", cmd: "yay -Syu --noconfirm --color never --sudo pkexec --answerdiff None --answerclean None --removemake && flatpak update -y --noninteractive", why: "Updates official packages, AUR packages and Flatpak apps together. Don't turn the computer off while it runs.", risk: "change" },
  ] },
];

const SUGGESTIONS = [
  // apps & updates
  "Install VLC for me", "Install Steam", "Install Discord", "Install a good photo editor", "Install OBS so I can record my screen",
  "Is my system up to date?", "Update everything", "What did the last update change?", "Remove apps I never use",
  "Which apps did I install myself?", "Install Google Chrome", "Is Firefox installed from Flatpak or pacman?",
  "Find an app that can open .docx files", "Install a PDF editor", "What's the difference between Flatpak and pacman?",
  // speed & storage
  "Why is my computer slow?", "What's using my RAM?", "What's using my CPU right now?", "How much space do I have left?",
  "Find my biggest files", "Clean up junk files", "What's taking up space in Downloads?", "How long has my computer been on?",
  "Why is my fan so loud?", "Is my CPU overheating?", "How healthy is my SSD?", "Clear old package downloads",
  // sound, display, devices
  "My sound isn't working", "Switch my audio to my headset", "Make my microphone louder", "Test my microphone",
  "Turn on night light in the evening", "Make text bigger on my screen", "Change my screen resolution",
  "My Bluetooth headphones won't connect", "Is my webcam working?", "Which graphics card do I have?",
  "Show my USB devices", "Why won't my USB drive show up?", "Safely eject my USB drive", "Is my printer detected?",
  // network
  "Why is my Wi-Fi slow?", "Am I connected to the internet?", "What's my IP address?", "Test my internet speed",
  "What's using my internet?", "Show saved Wi-Fi passwords", "Turn on SSH so I can log in remotely",
  "Is my firewall on?", "Which ports are open on my computer?",
  // files & backups
  "Find all PDFs in my Downloads", "Back up my Documents to a USB drive", "Set up a folder backup to a USB drive",
  "Find a file I saved yesterday", "Find duplicate photos", "Zip up my Pictures folder", "Recover something I deleted",
  "Show hidden files in my home folder", "Rename a bunch of photos at once", "Which folder are my screenshots in?",
  // desktop & looks
  "Make my desktop dark", "Change my wallpaper every day", "Make windows open faster", "Add an app to my taskbar",
  "Which apps start when I log in?", "Stop an app from starting at login", "Set up keyboard shortcuts",
  "Move my taskbar to the top", "Make my mouse pointer bigger", "Change my keyboard layout",
  // power & security
  "Stop my screen from turning off", "Make my computer sleep sooner", "Is my system secure?",
  "Who is logged in to my computer?", "Check for failed login attempts", "Lock my screen automatically",
  // problems
  "Something crashed, what happened?", "Show errors from today", "Why did my computer restart?",
  "Fix \"unable to lock database\"", "My panel disappeared", "An app is frozen, close it", "Why is boot slow?",
  // learning
  "What does `chmod 755` mean?", "Explain what pacman does", "What is the AUR?", "What's a kernel?",
  "Teach me 5 terminal commands", "What does sudo do?", "How do file permissions work?", "What is systemd?",
  "Explain `ls -la` to me", "What's the difference between /home and /?", "How do I read a man page?",
  "What does `grep` do?", "What's a package manager?", "What is Wayland?",
  // virtual machines & more
  "Start my Windows virtual machine", "How much RAM do my VMs use?", "Schedule a task to run every night",
  "Show my system info", "Which kernel am I running?", "How many updates are waiting?",
];

// Phrases for live autocomplete in the assistant box (combined with SUGGESTIONS and your past questions)
const COMPLETE_APPS = ["Firefox", "Chromium", "Google Chrome", "VLC", "Steam", "Discord", "GIMP", "Krita", "Inkscape", "Blender",
  "OBS Studio", "Spotify", "LibreOffice", "Thunderbird", "Telegram", "VS Code", "Kdenlive", "Audacity", "qBittorrent", "Zoom",
  "Signal", "Obsidian", "htop", "fastfetch", "Wine", "Lutris", "Prism Launcher", "VirtualBox", "Docker", "Python", "Node.js", "Git",
  "Kate", "Okular", "Gwenview", "Elisa", "KDE Connect", "Timeshift", "Bottles", "Heroic Games Launcher", "Brave", "Vivaldi"];
const COMPLETE_THINGS = ["Wi-Fi", "internet", "sound", "microphone", "Bluetooth", "computer", "screen", "fan", "keyboard", "mouse",
  "printer", "webcam", "USB drive", "headset", "speakers", "trackpad", "taskbar", "clock", "SSD", "graphics card"];
const COMPLETE_PHRASES = [
  ...COMPLETE_APPS.flatMap(a => [`Install ${a}`, `Uninstall ${a}`, `Update ${a}`, `Is ${a} installed?`, `How do I use ${a}?`]),
  ...COMPLETE_THINGS.flatMap(t => [`Why is my ${t} not working?`, `Why is my ${t} so slow?`, `Fix my ${t}`, `Check my ${t}`]),
  ...["take a screenshot", "change my wallpaper", "update everything", "free up disk space", "install apps", "uninstall an app",
      "open a terminal", "find a file", "check my IP address", "set up a printer", "connect to Wi-Fi", "change my password",
      "make a backup", "see my hardware", "check my temperatures", "stop an app from starting at login", "use the terminal",
      "copy files to a USB drive", "zip a folder", "mount a drive", "format a USB drive", "add a user", "change my keyboard layout",
      "make text bigger", "turn on dark mode", "share files with my phone", "record my screen", "schedule a task",
      "run a .sh script", "install an AppImage", "edit a config file", "restart the sound system", "check what's using my internet"]
    .map(x => `How do I ${x}?`),
  ...["pacman", "the AUR", "Flatpak", "systemd", "Wayland", "KDE Plasma", "a kernel", "sudo", "pkexec", "a package manager", "swap",
      "zram", "a terminal", "bash", "root", "/etc", "GRUB", "a service", "a daemon", "a mount point", "an AppImage", "PipeWire", "btrfs"]
    .map(x => `What is ${x}?`),
  ...["ls -la", "cd ..", "grep", "chmod +x", "chmod 755", "sudo", "pacman -Syu", "pacman -Rns", "rm -rf", "df -h", "du -sh", "top",
      "ps aux", "systemctl", "journalctl", "yay", "kill -9", "ln -s", "tar -xzf", "find", "curl", "ssh"]
    .map(x => `What does \`${x}\` do?`),
  ...["my IP address", "my disk space", "my RAM usage", "running programs", "my hardware", "errors from today", "my kernel version",
      "my Wi-Fi networks", "my USB devices", "my temperatures", "my installed apps", "my startup apps", "my open ports"]
    .map(x => `Show ${x}`),
];
COMPLETE_PHRASES.push(
  ...["my Wi-Fi", "my sound", "Bluetooth", "my screen resolution", "my microphone", "my webcam", "my printer", "a frozen app", "slow boot",
      "screen tearing", "high CPU usage", "my keyboard layout", "dual monitors", "my USB drive", "sleep and wake up", "the clock being wrong"]
    .map(x => `How do I fix ${x}?`),
  ...["a printer", "dual monitors", "a VPN", "automatic backups", "SSH", "a firewall", "Steam with Proton", "KDE Connect with my phone",
      "a shared folder", "Bluetooth headphones", "a game controller", "night light", "a second user account", "Flatpak"]
    .map(x => `Set up ${x}`),
  ...["my wallpaper", "my keyboard shortcuts", "the default browser", "my screen timeout", "my mouse speed", "the panel position",
      "my computer name", "the time zone", "the login screen", "my icon theme", "the font size", "my default apps"]
    .map(x => `Change ${x}`),
  ...["my computer", "boot time", "Firefox", "the desktop animations", "file searches", "my internet", "gaming performance"]
    .map(x => `Speed up ${x}`),
  ...["my Downloads folder", "old packages", "my home folder", "the package cache", "old logs", "unused Flatpaks", "my desktop"]
    .map(x => `Clean up ${x}`),
  ...["to delete ~/.cache", "to use the AUR", "to update right now", "to remove orphaned packages", "to run curl | sh", "to disable the firewall",
      "to install this AppImage", "to stop this service", "to run my fans at full speed", "to force stop my fans"]
    .map(x => `Is it safe ${x}?`),
  ...["the computer won't wake from sleep", "an update breaks something", "I delete a system file", "my disk fills up", "I close the terminal mid-update"]
    .map(x => `What happens if ${x}?`),
  ...["my screenshots saved", "the trash", "my apps installed", "my settings stored", "my downloads", "the system logs", "my fonts"]
    .map(x => `Where are ${x}?`),
);
const COMPLETE_WORDS = ["pacman", "flatpak", "systemctl", "journalctl", "bluetooth", "headphones", "microphone", "permissions",
  "terminal", "directory", "folder", "download", "downloads", "documents", "install", "installed", "uninstall", "update", "updates",
  "upgrade", "kernel", "driver", "drivers", "graphics", "network", "internet", "wireless", "ethernet", "screenshot", "wallpaper",
  "keyboard", "shortcut", "shortcuts", "partition", "backup", "restore", "password", "process", "processes", "memory", "storage",
  "temperature", "performance", "service", "services", "startup", "settings", "display", "resolution", "brightness", "notification",
  "notifications", "virtual", "machine", "printer", "scanner", "webcam", "speakers", "volume", "configuration", "repository",
  "dependencies", "package", "packages", "application", "applications", "computer", "properly", "working", "connect", "connection",
  "disconnect", "slow", "frozen", "crashed", "error", "errors", "something", "running", "remove", "delete", "explain", "difference"];

// ---------- fit the tips, fixes and suggestions to this system ----------
// The lists above were written for Arch + KDE Plasma. On other systems, the parts that
// don't apply are swapped for their equivalents or left out.
(() => {
  const P = (typeof window.PLATFORM === "object" && window.PLATFORM) || {}, pkg = P.pkg || {};
  const fam = P.family || "arch", kde = (P.desktop || "kde") === "kde", gnome = P.desktop === "gnome";
  const fill = (tpl, x) => (tpl || "").replaceAll("{pkg}", x).replaceAll("{file}", x);
  const keep = (arr, ok) => { const k = arr.filter(ok); arr.length = 0; arr.push(...k); };
  const KDE_ONLY = /Alt<\/kbd>\+<kbd>Space|Meta<\/kbd>\+<kbd>(V|W|Shift|\.)|Konsole|Dolphin/;
  const ARCH_WORDS = /pacman|\bAUR\b|\byay\b|\bArch\b|archlinux/;
  const KDE_WORDS = /KDE Plasma|Konsole|Dolphin|\bPlasma\b/;

  // tips
  keep(TIPS, t => (fam === "arch" || t.cat !== "Arch") && (kde || !KDE_ONLY.test(t.d)));
  TIPS.forEach(t => {
    if (/pipe the internet/.test(t.t)) t.d = "Commands like <code>curl … | sh</code> run whatever a website sends. Prefer apps from your system's own software or Flathub.";
    if (/Kernel updated/.test(t.t)) t.cmd = "echo \"Running: $(uname -r)\"; echo 'Installed:'; ls /lib/modules 2>/dev/null | sort -V | tail -3";
  });
  if (gnome) TIPS.unshift(
    { cat: "Desktop", t: "Open any app instantly", d: "Press <kbd>Super</kbd> (the Windows/⌘ key) and start typing an app name, a file or a calculation like <code>12*7</code>." },
    { cat: "Desktop", t: "Screenshots", d: "<kbd>Print</kbd> opens the screenshot tool: drag a box, pick a window, or record the screen.", page: "tools" },
    { cat: "Desktop", t: "Notifications and calendar", d: "<kbd>Super</kbd>+<kbd>V</kbd> shows your notifications and the calendar." },
    { cat: "Desktop", t: "Hidden files", d: "In Files, press <kbd>Ctrl</kbd>+<kbd>H</kbd> to show files that start with a dot. In a terminal use <code>ls -a</code>.", cmd: "ls -a ~ | head -20" });
  const PKG_TIPS = {
    debian: [
      { cat: "Packages", t: "Update everything together", d: "<code>apt update</code> only refreshes the list of what's available; <code>apt upgrade</code> installs the updates. <b>Update everything</b> does both.", page: "apps" },
      { cat: "Packages", t: "Who installed this file?", d: "<code>dpkg -S /path/to/file</code> tells you which package a file came from.", cmd: "dpkg -S /usr/bin/ls" },
      { cat: "Packages", t: "What did I install myself?", d: "<code>apt-mark showmanual</code> lists packages installed on purpose.", cmd: "apt-mark showmanual | wc -l" },
      { cat: "Packages", t: "Your update history", d: "Every install, update and removal is logged in <code>/var/log/apt/history.log</code>.", cmd: "grep -E '^(Start-Date|Commandline)' /var/log/apt/history.log | tail -10" },
      { cat: "Packages", t: "System packages vs Flatpak and Snap", d: "System packages update with your system. Flatpaks and Snaps are sandboxed apps that bring their own libraries. All are fine; pick whichever has the app you want." },
    ],
    fedora: [
      { cat: "Packages", t: "Undo an update", d: "<code>dnf history</code> lists every install and update, and <code>dnf history undo ID</code> can roll one back.", cmd: "dnf history list 2>/dev/null | head -12" },
      { cat: "Packages", t: "Who installed this file?", d: "<code>rpm -qf /path/to/file</code> tells you which package a file came from.", cmd: "rpm -qf /usr/bin/ls" },
      { cat: "Packages", t: "Extra software (RPM Fusion)", d: "Fedora leaves out some codecs and drivers (like NVIDIA's). The RPM Fusion repositories add them; ask the assistant to set it up." },
      { cat: "Packages", t: "Recently installed", d: "<code>rpm -qa --last</code> lists packages newest first.", cmd: "rpm -qa --last | head -15" },
    ],
    suse: [
      { cat: "Packages", t: "Snapshots save you", d: "openSUSE takes a snapshot before every update. If one breaks something, pick an older snapshot from the boot menu." },
      { cat: "Packages", t: "Who installed this file?", d: "<code>rpm -qf /path/to/file</code> tells you which package a file came from.", cmd: "rpm -qf /usr/bin/ls" },
      { cat: "Packages", t: "Recently installed", d: "<code>rpm -qa --last</code> lists packages newest first.", cmd: "rpm -qa --last | head -15" },
    ],
  }[fam] || [];
  TIPS.push(...PKG_TIPS);

  // guided fixes
  const g = id => GUIDES.find(x => x.id === id);
  if (!P.pipewire && P.desktop) {
    const s = g("sound");
    if (s) s.steps = [
      { title: "Audio devices", cmd: "pactl list short sinks; pactl get-default-sink", why: "Lists speakers and headsets, then the current default.", risk: "read" },
      { title: "Volume and mute", cmd: "pactl get-sink-volume @DEFAULT_SINK@; pactl get-sink-mute @DEFAULT_SINK@", why: "The default output's volume and whether it's muted.", risk: "read" },
      { title: "Restart the sound system", cmd: "pulseaudio -k; sleep 2; pactl info | head -5", why: "Restarting the sound server fixes most 'no sound' problems.", risk: "change" },
    ];
  }
  if (fam !== "arch") {
    const sp = g("space");
    if (sp) sp.steps = sp.steps.flatMap(s => /pacman -Sc/.test(s.cmd) ? (pkg.cache_clean ? [{ ...s, cmd: pkg.cache_clean }] : [])
      : /pacman\/pkg/.test(s.cmd) ? [{ ...s, cmd: `du -sh ~/.cache ${pkg.cache_dir || ""} 2>/dev/null; journalctl --disk-usage` }] : [s]);
    const rc = g("recent");
    if (rc) rc.steps = fam === "debian" ? [
      { title: "Recent package changes", cmd: "grep -E ' (install|upgrade|remove) ' /var/log/dpkg.log | tail -30", why: "The last 30 installs, updates and removals with dates, useful when something just broke.", risk: "read" },
      { title: "Recent update runs", cmd: "grep -E '^(Start-Date|Commandline)' /var/log/apt/history.log | tail -8", why: "When updates and installs were run, and the command used.", risk: "read" },
    ] : [{ title: "Recently installed or updated", cmd: "rpm -qa --last | head -30", why: "Packages with the date they were installed or updated, newest first.", risk: "read" }];
    const lk = g("lock");
    if (lk && fam === "debian") Object.assign(lk, { t: "“Could not get lock”", d: "Fix apt's stuck lock safely", steps: [
      { title: "Is an update still running?", cmd: "pgrep -a 'apt|dpkg|unattended-upgr' || echo 'No package manager is running'", why: "Ubuntu and Debian update in the background. If one is running, wait for it to finish.", risk: "read" },
      { title: "Finish any interrupted install", cmd: "pgrep -x 'apt|apt-get|dpkg' >/dev/null && echo 'Still running. Try again in a few minutes' || pkexec dpkg --configure -a", why: "If an install was cut off, this completes it and releases the lock properly.", risk: "change" },
    ] });
    else if (lk) GUIDES.splice(GUIDES.indexOf(lk), 1);
    const up = g("update");
    if (up) up.steps = up.steps.filter(s => !/archlinux\.org/.test(s.cmd)).map(s => /-Syu/.test(s.cmd) ? { ...s, cmd: pkg.update || s.cmd, why: "Updates your system packages" + (P.flatpak ? " and Flatpak apps" : "") + " together. Don't turn the computer off while it runs." } : s);
  } else if (!P.aur) {
    const up = g("update"); if (up) up.steps.forEach(s => { if (/-Syu/.test(s.cmd)) s.cmd = pkg.update || s.cmd; });
  }

  // suggestions and autocomplete
  if (fam !== "arch") {
    const mgr = { debian: "apt", fedora: "dnf", suse: "zypper" }[fam] || "the package manager";
    const fix = s => s.replace(/\bpacman\b/g, mgr);
    [SUGGESTIONS, COMPLETE_PHRASES, COMPLETE_WORDS].forEach(a => { const k = a.filter(s => !/\bAUR\b|\byay\b|\bArch\b|pacman -\w/.test(s)).map(fix); a.length = 0; a.push(...k); });
  }
  if (!kde) [SUGGESTIONS, COMPLETE_PHRASES].forEach(a => keep(a, s => !KDE_WORDS.test(s)));
})();
