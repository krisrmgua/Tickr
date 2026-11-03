import Foundation
import Security

/// Where the menu-bar app reads dailystocker positions from. The URL and mode are
/// plain preferences. The API key is a mode-600 file under Application Support.
///
/// Ad-hoc signing changes the app's signature on every rebuild, and macOS Keychain
/// access control is tied to that signature. Keychain reads therefore prompt on
/// every launch. The Keychain is only read once, to migrate an older key.
enum DailystockerSettings {
    static let baseURLKey = "dailystockerBaseURL"
    static let modeKey = "dailystockerMode"
    static let keychainService = "com.krsimmons.tickr.positions"
    static let keychainAccount = "api"

    static var baseURL: String {
        get { UserDefaults.standard.string(forKey: baseURLKey) ?? "" }
        set {
            UserDefaults.standard.set(
                newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: baseURLKey)
        }
    }

    /// "live" unless explicitly switched to "paper".
    static var mode: String {
        get { UserDefaults.standard.string(forKey: modeKey) == "paper" ? "paper" : "live" }
        set { UserDefaults.standard.set(newValue == "paper" ? "paper" : "live", forKey: modeKey) }
    }

    static var isConfigured: Bool { !baseURL.isEmpty && apiKey() != nil }

    static var keyFileURL: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory,
                                               in: .userDomainMask)[0]
        return support.appendingPathComponent("Tickr", isDirectory: true)
            .appendingPathComponent("positions-api-key")
    }

    static func apiKey() -> String? {
        if let key = readKeyFile() { return key }
        // One-time migration from the Keychain, then the Keychain is not read again.
        guard let legacy = readKeychainKey() else { return nil }
        guard writeKeyFile(legacy) else { return legacy }
        deleteKeychainKey()
        return legacy
    }

    /// Replaces the stored key. An empty string is ignored by the caller, not stored.
    @discardableResult
    static func setAPIKey(_ key: String) -> Bool {
        guard writeKeyFile(key) else { return false }
        deleteKeychainKey()
        return true
    }

    private static func readKeyFile() -> String? {
        guard let data = try? Data(contentsOf: keyFileURL),
              let key = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
              !key.isEmpty
        else { return nil }
        return key
    }

    @discardableResult
    private static func writeKeyFile(_ key: String) -> Bool {
        let dir = keyFileURL.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try Data(key.utf8).write(to: keyFileURL, options: [.atomic])
            try FileManager.default.setAttributes(
                [.posixPermissions: NSNumber(value: 0o600)],
                ofItemAtPath: keyFileURL.path)
            return true
        } catch {
            return false
        }
    }

    private static func readKeychainKey() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let key = String(data: data, encoding: .utf8),
              !key.isEmpty
        else { return nil }
        return key
    }

    private static func deleteKeychainKey() {
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
        SecItemDelete(identity as CFDictionary)
    }
}
