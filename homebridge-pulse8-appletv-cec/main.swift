//
//  main.swift
//  homebridge-pulse8-appletv-cec
//
//  A macOS Swift diagnostic utility to inspect Pulse-Eight USB-CEC adapters,
//  scan the HDMI-CEC bus for Apple TV devices, and monitor live CEC frames.
//

import Foundation

struct Pulse8CecCLI {
    static func run() {
        let args = Array(CommandLine.arguments.dropFirst())

        if args.contains("-h") || args.contains("--help") || args.isEmpty {
            printUsage()
            return
        }

        var cecClientPath = "cec-client"
        var portPath: String?
        var mode = "list"

        var i = 0
        while i < args.count {
            let arg = args[i]
            switch arg {
            case "--cec-client":
                if i + 1 < args.count {
                    cecClientPath = args[i + 1]
                    i += 1
                }
            case "--port", "-p":
                if i + 1 < args.count {
                    portPath = args[i + 1]
                    i += 1
                }
            case "--list", "-l":
                mode = "list"
            case "--scan", "-s":
                mode = "scan"
            case "--monitor", "-m":
                mode = "monitor"
            default:
                break
            }
            i += 1
        }

        switch mode {
        case "list":
            runCecCommand(executable: cecClientPath, arguments: ["-l"], stdinText: nil)
        case "scan":
            var cmdArgs = ["-t", "a", "-d", "8"]
            if let port = portPath, !port.isEmpty {
                cmdArgs.append(port)
            }
            runCecCommand(executable: cecClientPath, arguments: cmdArgs, stdinText: "scan\nq\n")
        case "monitor":
            var cmdArgs = ["-t", "a", "-d", "8"]
            if let port = portPath, !port.isEmpty {
                cmdArgs.append(port)
            }
            print("Starting CEC Audio System monitor (\(cecClientPath) \(cmdArgs.joined(separator: " ")))... Press Ctrl+C to stop.")
            runCecCommand(executable: cecClientPath, arguments: cmdArgs, stdinText: nil)
        default:
            printUsage()
        }
    }

    static func runCecCommand(executable: String, arguments: [String], stdinText: String?) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [executable] + arguments

        if let input = stdinText {
            let stdinPipe = Pipe()
            process.standardInput = stdinPipe
            if let data = input.data(using: .utf8) {
                stdinPipe.fileHandleForWriting.write(data)
                try? stdinPipe.fileHandleForWriting.close()
            }
        }

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            print("Failed to launch \(executable): \(error.localizedDescription)")
        }
    }

    static func printUsage() {
        print("""
        Usage:
          homebridge-pulse8-appletv-cec [options]

        Options:
          --list, -l                List detected Pulse-Eight USB-CEC adapters (cec-client -l)
          --scan, -s                Scan the HDMI-CEC bus for Apple TV and other CEC devices
          --monitor, -m             Monitor live HDMI-CEC traffic as Audio System (Logical Address 5)
          --port, -p <path>         Optional serial device path (e.g. /dev/cu.usbmodemv121)
          --cec-client <path>       Path to cec-client binary (default: cec-client)
          --help, -h                Show this help message

        Homebridge Plugin Note:
          The Homebridge plugin source is located in the root repository (src/ & dist/).
          Press Cmd+B in Xcode to compile TypeScript (src/ -> dist/) and build this tool.
        """)
    }
}

Pulse8CecCLI.run()
