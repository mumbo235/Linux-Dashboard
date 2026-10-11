"""Spot commands that could cause harm, digital or physical, and explain it in plain words.

The dashboard shows these before running anything, wherever the command came from
(buttons, the assistant, the Terminal page). Read-only commands never get warnings.
"""
import re

from assistant import classify

# (kind, pattern, plain-language warning). Kinds: data, system, security, privacy, physical, interrupt
RULES = [
    # losing data
    ("data", r"\brm\s+(-\w*[rR]\w*|--recursive)", "Deletes whole folders permanently. They don't go to the trash."),
    ("data", r"\brm\b(?!\s+-\w*[rR])", "Deletes files permanently. They don't go to the trash."),
    ("data", r"\bfind\b.*\s-delete\b", "Deletes every file it finds, permanently."),
    ("data", r"\b(shred|wipefs|blkdiscard)\b|\bnvme\s+(format|sanitize)\b", "Erases data so it can't be recovered."),
    ("data", r"\bdd\b.*\bof=", "Writes raw data over a disk or file. One wrong letter can wipe a whole drive."),
    ("data", r"\bmkfs(\.\w+)?\b", "Formats a drive or partition, erasing everything on it."),
    ("data", r"\b(fdisk|sfdisk|cfdisk|gdisk|sgdisk|parted)\b", "Changes disk partitions. Mistakes can lose everything on the drive."),
    ("data", r"(?<![0-9&>])>\s*(~|\$HOME|/home/|(\.\.?/)?[A-Za-z0-9_][A-Za-z0-9_.-]*(\s|$|;|&))", "Replaces the contents of one of your files."),
    ("data", r"\bkill(all)?\s+-(9|KILL)\b|\bpkill\s+-9\b", "Force-quits a program. Anything unsaved in it is lost."),
    ("data", r"\bvirsh\b.*\b(destroy|undefine)\b", "Pulls the plug on a virtual machine (or deletes it). Unsaved work inside is lost."),
    # breaking the system
    ("system", r"\b(pacman|yay|paru)\s+-R|\b(apt|apt-get)\s+(-\S+\s+)*(remove|purge|autoremove)\b|\bdnf5?\s+(-\S+\s+)*(remove|erase|autoremove)\b|"
               r"\bzypper\s+(-\S+\s+)*(rm|remove)\b|\bdpkg\s+(-r|-P|--remove|--purge)\b|\bsnap\s+remove\b|\brpm\s+-e\b",
     "Removes software. Other programs that rely on it may stop working."),
    ("system", r"\bflatpak\s+(uninstall|remove)\b", "Removes an app and its data."),
    ("system", r"\b(pacman|yay)\s+-S\w*y(?!\w*u)\b", "Refreshes the package list without updating everything (a “partial upgrade”). On Arch this can break programs."),
    ("system", r"--(force(?!-conf)|overwrite)\b|\s-(R|S)\w*dd\b|--nodeps\b|--allow-downgrades\b", "Skips safety checks that normally protect your system."),
    ("system", r"\bdo-release-upgrade\b|\bdnf5?\s+system-upgrade\b|\bzypper\s+(-\S+\s+)*dup\b.*--from", "Upgrades to a whole new version of the system. It takes a while; don't turn the computer off."),
    ("system", r"/etc/(fstab|sudoers|passwd|shadow|group|pacman\.conf|mkinitcpio|default/grub|crypttab|apt/sources\.list|yum\.repos\.d|zypp/repos\.d)", "Changes a core system file. A mistake can stop Linux from starting."),
    ("system", r"\b(grub-install|grub-mkconfig|grub2-mkconfig|grub2-install|update-grub|update-initramfs|mkinitcpio|bootctl|efibootmgr|dracut)\b", "Changes how the computer starts up. A mistake can make it unbootable."),
    ("system", r"\b(fwupdmgr|flashrom)\b", "Updates or rewrites device firmware. If interrupted, the device may stop working."),
    ("system", r"systemctl\s+(--user\s+)?(stop|disable|mask)\s+\S*(sddm|gdm|display-manager|NetworkManager|[Nn]etwork|systemd-|dbus|polkit|plasma)", "Stops a part of the system you rely on (login screen, network or desktop)."),
    ("system", r"\brm\b.*\s(/(usr|etc|boot|bin|lib|var)\b|/\s|/\*|/$)", "Deletes from system folders."),
    ("data", r"\brm\b.*\s(~|\$HOME|/home/\w+)/?(\s|$|\*)", "Targets your entire home folder."),
    # security
    ("security", r"(curl|wget)\b[^|]*\|\s*(sudo\s+|pkexec\s+)?(ba|z|da)?sh\b", "Runs a script straight from the internet without checking it first."),
    ("security", r"\bchmod\s+(-\w+\s+)*([0-7]?777|a\+w|o\+w)\b", "Lets every user and program change these files."),
    ("security", r"\bchmod\s+-\w*R|\bchown\s+-\w*R", "Changes permissions on everything inside a folder at once."),
    ("security", r"systemctl\s+(enable|start)\b.*\bsshd?\b|svc_sshd", "Lets other computers log in to this one over the network."),
    ("security", r"\b(ufw\s+disable|iptables\s+-F|nft\s+flush|systemctl\s+(stop|disable)\s+(firewalld|ufw|nftables))", "Turns off the firewall."),
    ("security", r"\b(passwd|userdel|usermod|useradd|chpasswd)\b", "Changes user accounts or passwords."),
    ("security", r"\b(yay|paru)\s+-S(?!\w*[sic])", "Installs from the AUR. Those packages are made by the community and not checked by Arch."),
    # privacy
    ("privacy", r"\bcurl\b.*\s(-T|--upload-file|-F|--form|-d\s*@|--data(-binary)?\s*@)", "Sends a file or data from your computer to the internet."),
    ("privacy", r"\b(scp|rsync)\b.*\S+@\S+:", "Copies files to another computer."),
    # physical
    ("physical", r"echo T=\d+ > /etc/linux-dashboard-fans", "Runs the fans faster than normal: very loud, and it wears the fan bearings sooner."),
    ("physical", r"--find-limit", "Spins the fans up to their limit for about a minute. It will be very loud."),
    ("physical", r"always_full_speed=true|fanmode:max", "Keeps the fans at full speed all the time: loud, and more wear on the fans."),
    ("physical", r"fanmode:stop|--stop", "Forces the fans to stop: the computer may get hot if running heavy work without cooling."),
    ("physical", r"\becho\s+performance\b.*scaling_governor", "Keeps the CPU at full speed: more heat, more power use and louder fans."),
    ("physical", r"\b(stress(-ng)?|s-tui|mprime|prime95|furmark|gputest)\b", "Pushes the hardware to 100% on purpose. It will get hot and loud."),
    ("physical", r"echo\s+\S+\s*>\s*/sys/(class|devices)/(hwmon|thermal|backlight|leds|power_supply)", "Writes directly to hardware controls (fans, power or sensors)."),
    ("physical", r"\bhdparm\b.*\s-(B|S|W|M)\b", "Changes low-level drive power settings."),
    # interrupts
    ("interrupt", r"\b(reboot|poweroff|shutdown|halt)\b|systemctl\s+(reboot|poweroff|halt|kexec)|Shutdown\.logout|--firmware-setup", "Restarts or turns off the computer. Unsaved work in open apps is lost."),
    ("interrupt", r"systemctl\s+suspend|systemctl\s+hibernate", "Puts the computer to sleep."),
]
COMPILED = [(k, re.compile(p), t) for k, p, t in RULES]  # case matters: -f and -F mean different things


def report(cmd):
    """Warnings for a command: [{kind, text}], most serious first. Read-only commands get none."""
    cmd = str(cmd or "")
    if not cmd.strip() or classify(cmd, "read") == "read":
        return {"level": "none", "warnings": []}
    seen, out = set(), []
    for kind, rx, text in COMPILED:
        if rx.search(cmd) and text not in seen:
            seen.add(text)
            out.append({"kind": kind, "text": text})
    order = ["data", "system", "security", "privacy", "physical", "interrupt"]
    out.sort(key=lambda w: order.index(w["kind"]))
    level = "danger" if any(w["kind"] in ("data", "system", "security", "privacy") for w in out) else "caution" if out else "none"
    return {"level": level, "warnings": out[:6], "admin": "pkexec" in cmd or "sudo" in cmd}
