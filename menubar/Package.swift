// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Tickr",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "Tickr", targets: ["Tickr"]),
        .library(name: "TickrCore", targets: ["TickrCore"]),
    ],
    targets: [
        .target(
            name: "TickrCore",
            path: "Sources/TickrCore"
        ),
        .executableTarget(
            name: "Tickr",
            dependencies: ["TickrCore"],
            path: "Sources/Tickr"
        ),
        .testTarget(
            name: "TickrCoreTests",
            dependencies: ["TickrCore"],
            path: "Tests/TickrCoreTests"
        ),
    ]
)
