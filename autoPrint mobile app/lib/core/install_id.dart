import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

const _storage = FlutterSecureStorage();
const _key = 'autoprint_install_id';

/// Stored securely on device using flutter_secure_storage.
/// Intended to remain stable across normal app updates.
/// If lost (e.g., after a clean uninstall), a new ID is generated automatically.
/// This ID is used only for rate limiting — not for authentication or identity.
Future<String> getInstallId() async {
  try {
    final existing = await _storage.read(key: _key);
    if (existing != null && existing.isNotEmpty) {
      return existing;
    }
    final newId = const Uuid().v4();
    await _storage.write(key: _key, value: newId);
    return newId;
  } catch (_) {
    // Fallback if secure storage encounters platform issues
    return const Uuid().v4();
  }
}
