import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';
import 'package:mime/mime.dart';
import '../core/constants.dart';

class SharedFile {
  final String path;
  final String name;
  final int sizeInBytes;
  final String mimeType;

  SharedFile({
    required this.path,
    required this.name,
    required this.sizeInBytes,
    required this.mimeType,
  });

  bool get isSupported => AppConstants.supportedMimeTypes.contains(mimeType);

  String get formattedSize {
    if (sizeInBytes < 1024 * 1024) {
      return '${(sizeInBytes / 1024).toStringAsFixed(1)} KB';
    }
    return '${(sizeInBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

class ShareNotifier extends StateNotifier<List<SharedFile>> {
  ShareNotifier() : super([]);

  Future<void> setSharedMedia(List<SharedMediaFile> mediaFiles) async {
    final List<SharedFile> list = [];
    for (final media in mediaFiles) {
      final file = File(media.path);
      int size = 0;
      try {
        if (await file.exists()) {
          size = await file.length();
        }
      } catch (_) {}

      final name = media.path.split('/').last.split('\\').last;
      final detectedMime = lookupMimeType(media.path) ?? 'application/pdf';

      list.add(SharedFile(
        path: media.path,
        name: name,
        sizeInBytes: size,
        mimeType: detectedMime,
      ));
    }
    state = list;
  }

  void clear() {
    state = [];
  }
}

final shareProvider = StateNotifierProvider<ShareNotifier, List<SharedFile>>((ref) {
  return ShareNotifier();
});
