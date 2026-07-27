import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/share_provider.dart';
import '../providers/shop_provider.dart';
import '../providers/upload_provider.dart';
import '../widgets/file_preview_card.dart';
import '../widgets/multi_file_list.dart';
import '../widgets/options_bottom_sheet.dart';
import 'shop_picker_screen.dart';
import 'upload_screen.dart';

class ReceiveScreen extends ConsumerWidget {
  const ReceiveScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sharedFiles = ref.watch(shareProvider);
    final shopState = ref.watch(shopProvider);
    final favShop = shopState.favouriteShop;

    final hasUnsupported = sharedFiles.any((f) => !f.isSupported);

    return Scaffold(
      appBar: AppBar(
        title: const Text('AutoPrint Share'),
        automaticallyImplyLeading: false,
        actions: [
          IconButton(
            icon: const Icon(Icons.close_rounded),
            onPressed: () => ref.read(shareProvider.notifier).clear(),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Send Document to Print',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Select print options and choose your shop below.',
                style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13),
              ),
              const SizedBox(height: 20),

              // File preview section
              Expanded(
                child: SingleChildScrollView(
                  child: sharedFiles.length > 1
                      ? MultiFileList(files: sharedFiles)
                      : (sharedFiles.isNotEmpty
                          ? FilePreviewCard(file: sharedFiles.first)
                          : const SizedBox.shrink()),
                ),
              ),

              const SizedBox(height: 16),

              // Fast-Path: if favourite shop exists
              if (favShop != null && !hasUnsupported) ...[
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A1A22),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF6366F1).withValues(alpha: 0.5)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.star_rounded, color: Color(0xFFF59E0B), size: 22),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Favourite Shop',
                              style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 11),
                            ),
                            Text(
                              favShop.name,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 14,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      Text(
                        favShop.statusLabel,
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                ElevatedButton.icon(
                  onPressed: () {
                    showModalBottomSheet(
                      context: context,
                      isScrollControlled: true,
                      backgroundColor: Colors.transparent,
                      builder: (_) => OptionsBottomSheet(
                        shop: favShop,
                        fileCount: sharedFiles.length,
                        onConfirm: (options) {
                          ref.read(uploadProvider.notifier).submitJob(
                                shop: favShop,
                                files: sharedFiles,
                                options: options,
                              );
                          Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => const UploadScreen()),
                          );
                        },
                      ),
                    );
                  },
                  icon: const Icon(Icons.print_rounded),
                  label: Text('Print at ${favShop.name} →'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6366F1),
                  ),
                ),
                const SizedBox(height: 8),
                Center(
                  child: TextButton(
                    onPressed: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => ShopPickerScreen(sharedFiles: sharedFiles),
                        ),
                      );
                    },
                    child: const Text(
                      'Choose a different shop',
                      style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13),
                    ),
                  ),
                ),
              ] else ...[
                // Normal path: Pick Shop button
                ElevatedButton(
                  onPressed: hasUnsupported
                      ? null
                      : () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => ShopPickerScreen(sharedFiles: sharedFiles),
                            ),
                          );
                        },
                  child: const Text('Choose Shop & Print →'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
