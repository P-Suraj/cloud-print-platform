import 'package:flutter/material.dart';
import '../providers/share_provider.dart';
import '../core/constants.dart';

class FilePreviewCard extends StatelessWidget {
  final SharedFile file;

  const FilePreviewCard({super.key, required this.file});

  IconData _getIconForMime(String mime) {
    if (mime.contains('pdf')) return Icons.picture_as_pdf_rounded;
    if (mime.startsWith('image/')) return Icons.image_rounded;
    if (mime.contains('word') || mime.contains('document')) return Icons.description_rounded;
    return Icons.insert_drive_file_rounded;
  }

  Color _getColorForMime(String mime) {
    if (mime.contains('pdf')) return const Color(0xFFEF4444);
    if (mime.startsWith('image/')) return const Color(0xFF10B981);
    if (mime.contains('word') || mime.contains('document')) return const Color(0xFF3B82F6);
    return const Color(0xFF6B7280);
  }

  @override
  Widget build(BuildContext context) {
    final icon = _getIconForMime(file.mimeType);
    final color = _getColorForMime(file.mimeType);
    final isSupported = file.isSupported;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A22),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isSupported ? const Color(0xFF2A2A36) : const Color(0xFFEF4444).withValues(alpha: 0.5),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: color, size: 24),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      file.name,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      file.formattedSize,
                      style: const TextStyle(
                        color: Color(0xFF9CA3AF),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (!isSupported) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFEF4444).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  const Icon(Icons.info_outline, color: Color(0xFFEF4444), size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      AppConstants.getUnsupportedMessage(file.mimeType),
                      style: const TextStyle(
                        color: Color(0xFFFCA5A5),
                        fontSize: 12,
                        height: 1.3,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
