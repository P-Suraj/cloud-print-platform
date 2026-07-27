import 'package:flutter/material.dart';
import '../providers/pending_jobs_provider.dart';

class PendingJobsCard extends StatelessWidget {
  final PendingJobItem item;
  final VoidCallback onRetry;
  final VoidCallback onDiscard;

  const PendingJobsCard({
    super.key,
    required this.item,
    required this.onRetry,
    required this.onDiscard,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1F1E1B),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFF59E0B).withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.pause_circle_outline_rounded, color: Color(0xFFF59E0B), size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  item.fileName,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Text(
                'Pending Upload',
                style: TextStyle(color: const Color(0xFFF59E0B).withValues(alpha: 0.9), fontSize: 11, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Target Shop: ${item.shopName}',
            style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh_rounded, size: 16),
                  label: const Text('Retry Now', style: TextStyle(fontSize: 13)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFF59E0B),
                    foregroundColor: Colors.black,
                    minimumSize: const Size.fromHeight(36),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              TextButton(
                onPressed: onDiscard,
                child: const Text('Discard', style: TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
