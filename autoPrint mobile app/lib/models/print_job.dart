import 'print_options.dart';

class PrintJob {
  final String id;
  final String shopId;
  final String shopName;
  final String fileName;
  final String filePath;
  final String status; // 'queued', 'approved', 'processing', 'completed', 'failed', 'cancelled'
  final PrintOptions options;
  final DateTime createdAt;

  PrintJob({
    required this.id,
    required this.shopId,
    required this.shopName,
    required this.fileName,
    required this.filePath,
    required this.status,
    required this.options,
    required this.createdAt,
  });

  factory PrintJob.fromJson(Map<String, dynamic> json) {
    return PrintJob(
      id: json['id'] as String,
      shopId: json['shop_id'] as String? ?? '',
      shopName: json['shop_name'] as String? ?? 'Print Shop',
      fileName: json['file_name'] as String? ?? 'document.pdf',
      filePath: json['file_path'] as String? ?? '',
      status: json['status'] as String? ?? 'queued',
      options: PrintOptions.fromJson(json),
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'] as String)
          : DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'shop_id': shopId,
      'shop_name': shopName,
      'file_name': fileName,
      'file_path': filePath,
      'status': status,
      ...options.toJson(),
      'created_at': createdAt.toIso8601String(),
    };
  }
}
