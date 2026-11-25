#!/usr/bin/env python3
"""Patched copy of libc for iOS builds (written to rust/target/ios-patches/).

iroh 1.4.1 → netwatch 0.19 uses BSD routing-socket constants (net/route.h: RTM_*, RTAX_*, RTF_*) and
netdev 0.46 uses `in6_ifreq` on every Apple OS, but current libc (0.2.191) exposes them for macOS
only, so iroh no longer compiles for iOS. The values are the same on iOS (same xnu kernel), so the
copy lifts those cfg gates in libc. Nothing in the
repo changes; build-ios.sh passes the copy to cargo with --config patch.crates-io.*.
Drop this once upstream builds for iOS again.
"""
import json, pathlib, re, shutil, subprocess, sys

root = pathlib.Path(__file__).resolve().parent.parent / "rust"
out = root / "target" / "ios-patches"
meta = json.loads(subprocess.check_output(["cargo", "metadata", "--format-version", "1"], cwd=root))
src = {p["name"] + "@" + p["version"]: pathlib.Path(p["manifest_path"]).parent for p in meta["packages"]}

def copy(key):
    dest = out / key.split("@")[0]
    shutil.rmtree(dest, ignore_errors=True)
    shutil.copytree(src[key], dest)
    return dest

libc_key = next(k for k in src if k.startswith("libc@0.2."))

libc = copy(libc_key)
bsd = libc / "src/unix/bsd/mod.rs"
s = bsd.read_text()
s2 = re.sub(r'if #\[cfg\(not\(any\(\s*target_os = "ios",\s*target_os = "tvos",\s*target_os = "watchos",\s*target_os = "visionos",\s*\)\)\)\] \{\s*// net/route\.h', 'if #[cfg(all())] {\n        // net/route.h (hermes-ui: also on iOS)', s, count=1)
assert s2 != s, "libc bsd/mod.rs: net/route.h gate not found"
bsd.write_text(s2)
apple = libc / "src/unix/bsd/apple/mod.rs"
s = apple.read_text()
s2 = re.sub(r'if #\[cfg\(target_os = "macos"\)\] \{\s*// net/route\.h', 'if #[cfg(all())] {\n        // net/route.h (hermes-ui: also on iOS)', s, count=1)
for name in ("in6_addrlifetime", "in6_ifstat", "icmp6_ifstat", "in6_ifreq"):
    s2 = re.sub(r'#\[cfg\(target_os = "macos"\)\]\s*\n(\s*)pub struct ' + name + r'\b', r'\1pub struct ' + name, s2, count=1)
s2 = re.sub(r'if #\[cfg\(target_os = "macos"\)\] \{(\s*s_no_extra_traits2! \{\s*#\[unsafe\(union_default_via_zeroed\)\]\s*pub union __c_anonymous_ifr_ifru6)', r'if #[cfg(all())] {\1', s2, count=1)
assert s2 != s, "libc apple/mod.rs: gates not found"
apple.write_text(s2)

print(libc)
