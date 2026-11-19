# JNA (UniFFI's bridge to libhermes_iroh.so) works through reflection and references desktop-only AWT.
-dontwarn java.awt.**
-keep class com.sun.jna.** { *; }
-keepclassmembers class * extends com.sun.jna.** { public *; }
# Generated UniFFI bindings: structures and callbacks are looked up by name from native code.
-keep class uniffi.hermes_iroh.** { *; }
