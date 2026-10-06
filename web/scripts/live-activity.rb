# Adds KavLive, the widget extension that draws a trip on the lock screen and in the Dynamic Island,
# to the Xcode project, and embeds it in the app. Run on a Mac after `cap sync ios`; running it again
# changes nothing. Needs the xcodeproj gem: `gem install xcodeproj`.
require "xcodeproj"

project_path = File.expand_path("../ios/App/App.xcodeproj", __dir__)
project = Xcodeproj::Project.open(project_path)

if project.targets.any? { |t| t.name == "KavLive" }
  puts "KavLive is already in the project"
  exit 0
end

app = project.targets.find { |t| t.name == "App" } or abort "No App target"

ext = project.new_target(:app_extension, "KavLive", :ios, "16.2", nil, :swift)

group = project.main_group.find_subpath("KavLive", true)
group.set_source_tree("<group>")
group.set_path("KavLive")
widget = group.new_reference("KavLiveWidget.swift")
trip = group.new_reference("KavTrip.swift")
group.new_reference("Info.plist")

# The trip's shape is shared: the app starts and updates it, the extension draws it.
ext.add_file_references([widget, trip])
app.add_file_references([trip])
ext.add_system_frameworks(%w[WidgetKit SwiftUI ActivityKit])

ext.build_configurations.each do |c|
  s = c.build_settings
  s["INFOPLIST_FILE"] = "KavLive/Info.plist"
  s["GENERATE_INFOPLIST_FILE"] = "NO"
  s["PRODUCT_BUNDLE_IDENTIFIER"] = "com.gilsamedia.kav.KavLive"
  s["PRODUCT_NAME"] = "$(TARGET_NAME)"
  s["SWIFT_VERSION"] = "5.0"
  s["TARGETED_DEVICE_FAMILY"] = "1,2"
  s["IPHONEOS_DEPLOYMENT_TARGET"] = "16.2"
  s["SKIP_INSTALL"] = "YES"
  s["APPLICATION_EXTENSION_API_ONLY"] = "YES"
  s["LD_RUNPATH_SEARCH_PATHS"] = ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"]
  s["MARKETING_VERSION"] = "1.0"
  s["CURRENT_PROJECT_VERSION"] = "1"
end

# The app still runs on iOS 15, where ActivityKit isn't there: link it weakly.
app.build_configurations.each do |c|
  flags = Array(c.build_settings["OTHER_LDFLAGS"] || ["$(inherited)"])
  flags += ["-weak_framework", "ActivityKit"] unless flags.include?("ActivityKit")
  c.build_settings["OTHER_LDFLAGS"] = flags
end

app.add_dependency(ext)
embed = app.copy_files_build_phases.find { |p| p.name == "Embed Foundation Extensions" } ||
  app.new_copy_files_build_phase("Embed Foundation Extensions")
embed.symbol_dst_subfolder_spec = :plug_ins
embed.add_file_reference(ext.product_reference, true).settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }

project.save
puts "KavLive added and embedded in App"
