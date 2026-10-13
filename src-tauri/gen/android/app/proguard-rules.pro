# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# The `media` Tauri plugin: Tauri instantiates `MediaPlugin` by reflection
# (register_android_plugin → Class.forName), dispatches its `@Command`
# methods by name, and Jackson materialises the `@InvokeArg` classes — none
# of which R8 can see. The package is tiny; keep all of it.
-keep class com.z44d.carmen.media.** { *; }

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
