import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';

const String _hiveBoxName = 'pending_print_jobs';

class PendingJobItem {
  final String jobId;
  final String shopId;
  final String shopName;
  final String filePath;
  final String fileName;
  final DateTime createdAt;

  PendingJobItem({
    required this.jobId,
    required this.shopId,
    required this.shopName,
    required this.filePath,
    required this.fileName,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'jobId': jobId,
      'shopId': shopId,
      'shopName': shopName,
      'filePath': filePath,
      'fileName': fileName,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  factory PendingJobItem.fromMap(Map<dynamic, dynamic> map) {
    return PendingJobItem(
      jobId: map['jobId'] as String,
      shopId: map['shopId'] as String,
      shopName: map['shopName'] as String? ?? 'Print Shop',
      filePath: map['filePath'] as String,
      fileName: map['fileName'] as String,
      createdAt: DateTime.parse(map['createdAt'] as String),
    );
  }
}

class PendingJobsNotifier extends StateNotifier<List<PendingJobItem>> {
  PendingJobsNotifier() : super([]) {
    _initHive();
  }

  Future<void> _initHive() async {
    try {
      await Hive.initFlutter();
      final box = await Hive.openBox(_hiveBoxName);
      _loadFromBox(box);
    } catch (_) {}
  }

  void _loadFromBox(Box box) {
    final List<PendingJobItem> list = [];
    for (var key in box.keys) {
      final data = box.get(key);
      if (data != null && data is Map) {
        try {
          list.add(PendingJobItem.fromMap(data));
        } catch (_) {}
      }
    }
    state = list;
  }

  Future<void> addPendingJob(PendingJobItem item) async {
    state = [...state, item];
    try {
      final box = await Hive.openBox(_hiveBoxName);
      await box.put(item.jobId, item.toMap());
    } catch (_) {}
  }

  Future<void> removePendingJob(String jobId) async {
    state = state.where((j) => j.jobId != jobId).toList();
    try {
      final box = await Hive.openBox(_hiveBoxName);
      await box.delete(jobId);
    } catch (_) {}
  }
}

final pendingJobsProvider = StateNotifierProvider<PendingJobsNotifier, List<PendingJobItem>>((ref) {
  return PendingJobsNotifier();
});
