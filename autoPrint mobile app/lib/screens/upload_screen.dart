import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/upload_provider.dart';
import '../providers/share_provider.dart';
import 'home_screen.dart';

class UploadScreen extends ConsumerWidget {
  const UploadScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(uploadProvider);

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (status.isProcessing) ...[
                  const SizedBox(
                    width: 64,
                    height: 64,
                    child: CircularProgressIndicator(
                      strokeWidth: 4,
                      color: Color(0xFF6366F1),
                    ),
                  ),
                  const SizedBox(height: 32),
                  Text(
                    _getProcessingMessage(status.state),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Do not close the app while uploading.',
                    style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13),
                  ),
                ] else if (status.state == UploadState.success) ...[
                  Container(
                    width: 72,
                    height: 72,
                    decoration: const BoxDecoration(
                      color: Color(0xFF10B981),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.check_rounded, color: Colors.white, size: 44),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Sent to',
                    style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 14),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    status.shopName ?? 'Print Shop',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Your document is in the print queue!',
                    style: TextStyle(color: Color(0xFF10B981), fontSize: 14, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  if (status.confirmedJobId != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1A1A22),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        'Ref ID: #${status.confirmedJobId}',
                        style: const TextStyle(
                          color: Color(0xFF6B7280),
                          fontFamily: 'monospace',
                          fontSize: 12,
                        ),
                      ),
                    ),
                  const SizedBox(height: 40),
                  ElevatedButton(
                    onPressed: () {
                      ref.read(shareProvider.notifier).clear();
                      ref.read(uploadProvider.notifier).reset();
                      Navigator.pushAndRemoveUntil(
                        context,
                        MaterialPageRoute(builder: (_) => const HomeScreen()),
                        (route) => false,
                      );
                    },
                    child: const Text('Done'),
                  ),
                ] else if (status.state == UploadState.error) ...[
                  Container(
                    width: 72,
                    height: 72,
                    decoration: const BoxDecoration(
                      color: Color(0xFFEF4444),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.close_rounded, color: Colors.white, size: 44),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Upload Failed',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    status.errorMessage ?? 'An unexpected error occurred.',
                    style: const TextStyle(color: Color(0xFFFCA5A5), fontSize: 13, height: 1.4),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 40),
                  ElevatedButton(
                    onPressed: () {
                      ref.read(uploadProvider.notifier).reset();
                      Navigator.pop(context);
                    },
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEF4444)),
                    child: const Text('Try Again'),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () {
                      ref.read(shareProvider.notifier).clear();
                      ref.read(uploadProvider.notifier).reset();
                      Navigator.pushAndRemoveUntil(
                        context,
                        MaterialPageRoute(builder: (_) => const HomeScreen()),
                        (route) => false,
                      );
                    },
                    child: const Text('Discard', style: TextStyle(color: Color(0xFF9CA3AF))),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _getProcessingMessage(UploadState state) {
    return switch (state) {
      UploadState.validating => 'Checking with shop...',
      UploadState.preparingFile => 'Preparing document...',
      UploadState.uploadingFile => 'Uploading document...',
      UploadState.registeringJob => 'Registering in print queue...',
      _ => 'Processing...',
    };
  }
}
