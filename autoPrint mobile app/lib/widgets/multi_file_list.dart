import 'package:flutter/material.dart';
import '../providers/share_provider.dart';
import 'file_preview_card.dart';

class MultiFileList extends StatelessWidget {
  final List<SharedFile> files;

  const MultiFileList({super.key, required this.files});

  @override
  Widget build(BuildContext context) {
    int totalBytes = files.fold(0, (sum, f) => sum + f.sizeInBytes);
    String totalFormatted = totalBytes < 1024 * 1024
        ? '${(totalBytes / 1024).toStringAsFixed(1)} KB'
        : '${(totalBytes / (1024 * 1024)).toStringAsFixed(1)} MB';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              '${files.length} Files Selected',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 15,
              ),
            ),
            Text(
              'Total: $totalFormatted',
              style: const TextStyle(
                color: Color(0xFF9CA3AF),
                fontSize: 13,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: files.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (context, index) {
            return FilePreviewCard(file: files[index]);
          },
        ),
      ],
    );
  }
}
