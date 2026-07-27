import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import '../core/constants.dart';
import '../core/install_id.dart';
import '../core/job_id.dart';
import '../models/shop.dart';
import '../models/print_options.dart';
import 'share_provider.dart';

enum UploadState {
  idle,
  validating,     // Step 1: RPC validate_print_job (dry run)
  preparingFile,  // Step 2: Read bytes / compress image
  uploadingFile,  // Step 3: Bytes -> Supabase Storage
  registeringJob, // Step 4: RPC submit_print_job (validate + rate limit + insert)
  success,
  error,
}

class UploadStatus {
  final UploadState state;
  final String? errorMessage;
  final String? confirmedJobId;
  final String? shopName;

  UploadStatus({
    this.state = UploadState.idle,
    this.errorMessage,
    this.confirmedJobId,
    this.shopName,
  });

  bool get isProcessing =>
      state == UploadState.validating ||
      state == UploadState.preparingFile ||
      state == UploadState.uploadingFile ||
      state == UploadState.registeringJob;
}

class UploadNotifier extends StateNotifier<UploadStatus> {
  UploadNotifier() : super(UploadStatus());

  void reset() {
    state = UploadStatus(state: UploadState.idle);
  }

  Future<void> submitJob({
    required Shop shop, // MUST be real UUID shop
    required List<SharedFile> files,
    required PrintOptions options,
  }) async {
    // Prevent double tap
    if (state.isProcessing) return;
    if (files.isEmpty) return;

    final mainFile = files.first;
    final String jobId = generateJobId();

    try {
      final installId = await getInstallId();

      // Step 1: Validate (RPC dry run — no DB write)
      state = UploadStatus(state: UploadState.validating);

      final dynamic validationRes = await Supabase.instance.client
          .rpc('validate_print_job', params: {
        'p_shop_id': shop.id, // Real UUID
        'p_copies': options.copies,
        'p_color_mode': options.colorMode,
        'p_paper_size': options.paperSize,
        'p_page_range': options.pageRange,
        'p_install_id': installId,
      });

      if (validationRes != null && validationRes['ok'] == false) {
        throw validationRes['error']?.toString() ?? 'Validation failed';
      }

      // Step 2: Prepare file (read / compress if image > 45MB)
      state = UploadStatus(state: UploadState.preparingFile);
      final fileObj = File(mainFile.path);
      if (!await fileObj.exists()) {
        throw 'File no longer exists on device';
      }

      Uint8List bytes = await fileObj.readAsBytes();
      if (bytes.length > 45 * 1024 * 1024 && mainFile.mimeType.startsWith('image/')) {
        final compressed = await FlutterImageCompress.compressWithList(
          bytes,
          quality: 75,
        );
        if (compressed.isNotEmpty) {
          bytes = compressed;
        }
      }

      if (bytes.length > 100 * 1024 * 1024) {
        throw 'File exceeds maximum 100MB limit.';
      }

      // Step 3: Upload to storage with 30s timeout and upsert: false
      state = UploadStatus(state: UploadState.uploadingFile);
      final ext = mainFile.name.contains('.') ? mainFile.name.split('.').last : 'pdf';
      final storagePath = '${shop.id}/$jobId.$ext';

      try {
        await Supabase.instance.client.storage
            .from(AppConstants.storageBucket)
            .uploadBinary(
              storagePath,
              bytes,
              fileOptions: FileOptions(
                contentType: mainFile.mimeType,
                upsert: false,
              ),
            )
            .timeout(
              const Duration(seconds: 30),
              onTimeout: () => throw TimeoutException('Upload timed out. Check internet connection.'),
            );
      } on StorageException catch (se) {
        // 409 conflict means file already uploaded on previous attempt — skip re-upload
        if (se.statusCode != '409' && !se.message.contains('Duplicate')) {
          rethrow;
        }
      }

      // Step 4: RPC submit_print_job (validate + rate limit + insert atomically)
      state = UploadStatus(state: UploadState.registeringJob);

      final dynamic submitRes = await Supabase.instance.client
          .rpc('submit_print_job', params: {
        'p_job_id': jobId,
        'p_shop_id': shop.id,
        'p_file_path': storagePath,
        'p_file_name': mainFile.name,
        'p_install_id': installId,
        'p_copies': options.copies,
        'p_color_mode': options.colorMode,
        'p_duplex': options.duplex,
        'p_paper_size': options.paperSize,
        'p_page_range': options.pageRange,
      });

      if (submitRes != null && submitRes['ok'] == false) {
        throw submitRes['error']?.toString() ?? 'Failed to queue job';
      }

      // Step 5: Confirmed Success
      final shortJobId = jobId.substring(0, 8).toUpperCase();
      state = UploadStatus(
        state: UploadState.success,
        confirmedJobId: shortJobId,
        shopName: shop.name,
      );
    } catch (err) {
      state = UploadStatus(
        state: UploadState.error,
        errorMessage: err.toString().replaceAll('Exception: ', ''),
      );
    }
  }
}

final uploadProvider = StateNotifierProvider<UploadNotifier, UploadStatus>((ref) {
  return UploadNotifier();
});
