#!/usr/bin/env python3
"""publish.py must be self-sufficient about the Android build environment.

Run: python3 tools/test_publish_env.py

The build needs a JDK 17 (the default JDK 27 dies in AGP's JdkImageTransform) and
the SDK root exported. Before configure_build_env() existed, publish.py inherited
whatever the caller's shell had, so a plain `python3 tools/publish.py` half-built
and failed. These assertions pin the self-sufficiency and the loud failures.
"""
import importlib.util
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("publish_mod", HERE / "publish.py")
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)

passed = failed = 0


def check(label, cond, extra=""):
    global passed, failed
    if cond:
        print(f"  OK   {label}")
        passed += 1
    else:
        print(f"  FAIL {label}  {extra}")
        failed += 1


print("=== find_java17 rejects the JDK 27 default ===")
saved = os.environ.get("JAVA_HOME")
try:
    os.environ["JAVA_HOME"] = "/usr/lib/jvm/java-27-openjdk"
    got = pub.find_java17()
    check("does not pick JDK 27 even when JAVA_HOME points at it",
          got is not None and "17" in got, f"got={got!r}")
    rel = pathlib.Path(got, "release").read_text(errors="replace")
    check("the chosen JVM really is version 17", 'JAVA_VERSION="17' in rel)

    print("=== configure_build_env exports both ===")
    for k in ("JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT"):
        os.environ.pop(k, None)
    pub.configure_build_env()
    jh = os.environ.get("JAVA_HOME", "")
    check("JAVA_HOME exported to a 17 JDK", "17" in jh and pathlib.Path(jh, "bin/java").exists(), jh)
    check("ANDROID_HOME is the SDK root", os.environ.get("ANDROID_HOME") == str(pub.SDK_ROOT), os.environ.get("ANDROID_HOME"))
    check("ANDROID_SDK_ROOT matches ANDROID_HOME", os.environ.get("ANDROID_SDK_ROOT") == os.environ.get("ANDROID_HOME"))
    check("the SDK root has a platforms/ dir", (pub.SDK_ROOT / "platforms").is_dir())
    check("JAVA_HOME/bin precedes the rest of PATH", os.environ["PATH"].startswith(str(pathlib.Path(jh, "bin"))))

    print("=== missing JDK fails loudly, not half-built ===")
    real_find = pub.find_java17
    pub.find_java17 = lambda: None
    try:
        pub.configure_build_env()
        check("a missing JDK 17 aborts", False, "no SystemExit raised")
    except SystemExit as e:
        check("a missing JDK 17 aborts with FATAL", "FATAL" in str(e) and "17" in str(e), str(e))
    finally:
        pub.find_java17 = real_find

    print("=== missing SDK fails loudly ===")
    real_sdk = pub.SDK_ROOT
    pub.SDK_ROOT = pathlib.Path("/nonexistent/sdk/root")
    try:
        pub.configure_build_env()
        check("a missing SDK root aborts", False, "no SystemExit raised")
    except SystemExit as e:
        check("a missing SDK root aborts with FATAL", "FATAL" in str(e) and "SDK" in str(e), str(e))
    finally:
        pub.SDK_ROOT = real_sdk
finally:
    if saved is None:
        os.environ.pop("JAVA_HOME", None)
    else:
        os.environ["JAVA_HOME"] = saved

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
