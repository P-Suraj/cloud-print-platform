import 'package:uuid/uuid.dart';

const _uuid = Uuid();

/// Generates a client-side UUID for idempotency
String generateJobId() {
  return _uuid.v4();
}
